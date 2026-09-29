'use strict';

// KYC tiers and rolling 24h limits, plus identity-document submissions reviewed by staff.
//   tier 0: registered — may deposit, cannot trade or withdraw
//   tier 1: phone verified
//   tier 2: identity document (tazkira / passport) + selfie approved
//   tier 3: enhanced / merchant, granted by staff
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { bad, forbidden, notFound, conflict } = require('./errors');
const m = require('./money');

const DAY = 86_400_000;
const MAX_FILE = 5 * 1024 * 1024;
const KINDS = ['front', 'back', 'selfie'];

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

function createKyc(db, config, { box }) {
  const now = () => Date.now();
  const tierOf = (userId) => db.prepare('SELECT kyc_tier FROM users WHERE id = ?').get(userId)?.kyc_tier ?? 0;
  const limitsOf = (tier) => config.kycLimits[tier] || config.kycLimits[0];

  const tradeVolume = (userId) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) s FROM trades
         WHERE (buyer_id = ? OR seller_id = ?) AND status != 'cancelled' AND created_at > ?`
      )
      .get(userId, userId, now() - DAY).s;
  const withdrawVolume = (userId) =>
    db
      .prepare("SELECT COALESCE(SUM(amount), 0) s FROM withdrawals WHERE user_id = ? AND status IN ('pending','sending','sent') AND created_at > ?")
      .get(userId, now() - DAY).s;

  function status(userId) {
    const tier = tierOf(userId);
    const lim = limitsOf(tier);
    const sub = db.prepare('SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
    return {
      tier,
      limits: { trade: m.fmtUsdt(lim.trade), withdraw: m.fmtUsdt(lim.withdraw) },
      used: { trade: m.fmtUsdt(tradeVolume(userId)), withdraw: m.fmtUsdt(withdrawVolume(userId)) },
      tiers: Object.fromEntries(Object.entries(config.kycLimits).map(([k, v]) => [k, { trade: m.fmtUsdt(v.trade), withdraw: m.fmtUsdt(v.withdraw) }])),
      submission: sub ? submissionView(sub) : null,
    };
  }

  // ---------- enforcement ----------
  function assertCanPostOffer(userId) {
    if (tierOf(userId) < 1) throw forbidden('kyc_required');
  }

  // actorId opened the trade; both sides must stay within their own 24h limit.
  function assertTrade({ actorId, buyerId, sellerId, amount }) {
    for (const uid of [buyerId, sellerId]) {
      const lim = limitsOf(tierOf(uid)).trade;
      if (lim === 0) throw forbidden(uid === actorId ? 'kyc_required' : 'counterparty_limit');
      if (tradeVolume(uid) + amount > lim) throw conflict(uid === actorId ? 'limit_exceeded' : 'counterparty_limit');
    }
  }

  function assertWithdraw(userId, amount) {
    const lim = limitsOf(tierOf(userId)).withdraw;
    if (lim === 0) throw forbidden('kyc_required');
    if (withdrawVolume(userId) + amount > lim) throw conflict('limit_exceeded');
  }

  // ---------- submissions ----------
  function submissionView(s, withFiles = false) {
    const v = {
      id: s.id, userId: s.user_id, docType: s.doc_type, fullName: s.full_name, docNumber: s.doc_number, status: s.status,
      tierGranted: s.tier_granted, reason: s.reason, createdAt: s.created_at, submittedAt: s.submitted_at, reviewedAt: s.reviewed_at,
      files: db.prepare('SELECT kind, mime, size FROM kyc_files WHERE submission_id = ?').all(s.id).map((f) => ({ ...f })),
    };
    if (!withFiles) delete v.userId;
    return v;
  }

  function startSubmission(userId, input) {
    if (tierOf(userId) < 1) throw forbidden('phone_first');
    const open = db.prepare("SELECT * FROM kyc_submissions WHERE user_id = ? AND status IN ('draft','pending') ORDER BY id DESC LIMIT 1").get(userId);
    if (open?.status === 'pending') throw conflict('kyc_pending');
    const docType = input.docType;
    if (!['tazkira', 'passport'].includes(docType)) throw bad('invalid_doc_type');
    const fullName = String(input.fullName ?? '').trim().slice(0, 100);
    const docNumber = String(input.docNumber ?? '').trim().slice(0, 40);
    if (fullName.length < 3) throw bad('invalid_full_name');
    if (!/^[\p{L}\p{N} /-]{4,40}$/u.test(docNumber)) throw bad('invalid_doc_number');
    if (open) {
      db.prepare('UPDATE kyc_submissions SET doc_type = ?, full_name = ?, doc_number = ? WHERE id = ?').run(docType, fullName, docNumber, open.id);
      return submissionView(db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(open.id));
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO kyc_submissions (user_id, doc_type, full_name, doc_number, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, docType, fullName, docNumber, now());
    return submissionView(db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(lastInsertRowid));
  }

  function ownDraft(userId, id) {
    const s = db.prepare('SELECT * FROM kyc_submissions WHERE id = ? AND user_id = ?').get(id, userId);
    if (!s) throw notFound();
    if (s.status !== 'draft') throw conflict('kyc_not_editable');
    return s;
  }

  function addFile(userId, id, kind, buf) {
    const s = ownDraft(userId, id);
    if (!KINDS.includes(kind)) throw bad('invalid_file_kind');
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw bad('empty_file');
    if (buf.length > MAX_FILE) throw bad('file_too_large');
    const mime = sniffImage(buf);
    if (!mime) throw bad('invalid_image');
    fs.mkdirSync(config.kycDir, { recursive: true, mode: 0o700 });
    const name = crypto.randomBytes(16).toString('hex') + '.bin';
    fs.writeFileSync(path.join(config.kycDir, name), box.seal(buf), { mode: 0o600 });
    const old = db.prepare('SELECT path FROM kyc_files WHERE submission_id = ? AND kind = ?').get(s.id, kind);
    db.prepare(
      `INSERT INTO kyc_files (submission_id, kind, path, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (submission_id, kind) DO UPDATE SET path = excluded.path, mime = excluded.mime, size = excluded.size,
         sha256 = excluded.sha256, created_at = excluded.created_at`
    ).run(s.id, kind, name, mime, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), now());
    if (old) fs.rmSync(path.join(config.kycDir, old.path), { force: true });
    return submissionView(db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(s.id));
  }

  function submit(userId, id) {
    const s = ownDraft(userId, id);
    const kinds = db.prepare('SELECT kind FROM kyc_files WHERE submission_id = ?').all(s.id).map((f) => f.kind);
    if (!kinds.includes('front') || !kinds.includes('selfie')) throw bad('kyc_files_missing');
    db.prepare("UPDATE kyc_submissions SET status = 'pending', submitted_at = ? WHERE id = ?").run(now(), s.id);
    return submissionView(db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(s.id));
  }

  // ---------- staff review ----------
  function list(status) {
    return db
      .prepare(
        `SELECT k.*, u.username, u.display_name, u.kyc_tier FROM kyc_submissions k JOIN users u ON u.id = k.user_id
         WHERE (? IS NULL AND k.status != 'draft') OR k.status = ? ORDER BY k.id DESC LIMIT 200`
      )
      .all(status ?? null, status ?? null)
      .map((r) => ({ ...submissionView(r, true), username: r.username, displayName: r.display_name, currentTier: r.kyc_tier }));
  }

  function readFile(id, kind) {
    const f = db.prepare('SELECT * FROM kyc_files WHERE submission_id = ? AND kind = ?').get(id, kind);
    if (!f) throw notFound();
    return { mime: f.mime, data: box.open(fs.readFileSync(path.join(config.kycDir, f.path))) };
  }

  function review(id, approve, { tier = 2, reason = '' } = {}, reviewerId) {
    return db.tx(() => {
      const s = db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(id);
      if (!s) throw notFound();
      if (s.user_id === reviewerId) throw forbidden('own_request');
      if (s.status !== 'pending') throw conflict('already_reviewed');
      const t = Number(tier);
      if (approve && ![2, 3].includes(t)) throw bad('invalid_tier');
      const why = String(reason ?? '').trim().slice(0, 500);
      if (!approve && !why) throw bad('reason_required');
      db.prepare('UPDATE kyc_submissions SET status = ?, tier_granted = ?, reason = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?')
        .run(approve ? 'approved' : 'rejected', approve ? t : null, why || null, reviewerId, now(), s.id);
      if (approve) db.prepare('UPDATE users SET kyc_tier = MAX(kyc_tier, ?) WHERE id = ?').run(t, s.user_id);
      return submissionView(db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(s.id), true);
    });
  }

  function setTier(userId, tier) {
    const t = Number(tier);
    if (![0, 1, 2, 3].includes(t)) throw bad('invalid_tier');
    if (!db.prepare('UPDATE users SET kyc_tier = ? WHERE id = ?').run(t, userId).changes) throw notFound();
  }

  return { status, assertCanPostOffer, assertTrade, assertWithdraw, startSubmission, addFile, submit, list, readFile, review, setTier, tierOf };
}

module.exports = { createKyc, sniffImage };
