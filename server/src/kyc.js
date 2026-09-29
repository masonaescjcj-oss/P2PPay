'use strict';

// KYC tiers and rolling 24h limits, plus identity-document submissions reviewed by staff.
//   tier 0: registered — may deposit, cannot trade or withdraw
//   tier 1: phone verified
//   tier 2: identity document (tazkira / passport) + selfie approved
//   tier 3: enhanced / merchant, granted by staff
const crypto = require('node:crypto');
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

function createKyc(db, config, { box, storage, notify = async () => {} }) {
  const now = () => Date.now();
  const tierOf = async (userId) => (await db.one('SELECT kyc_tier FROM users WHERE id = ?', [userId]))?.kyc_tier ?? 0;
  const limitsOf = (tier) => config.kycLimits[tier] || config.kycLimits[0];

  const tradeVolume = async (userId) =>
    (
      await db.one(
        `SELECT COALESCE(SUM(amount), 0) s FROM trades
         WHERE (buyer_id = ? OR seller_id = ?) AND status != 'cancelled' AND created_at > ?`,
        [userId, userId, now() - DAY]
      )
    ).s;
  const withdrawVolume = async (userId) =>
    (
      await db.one(
        "SELECT COALESCE(SUM(amount), 0) s FROM withdrawals WHERE user_id = ? AND status IN ('pending','sending','sent') AND created_at > ?",
        [userId, now() - DAY]
      )
    ).s;

  async function status(userId) {
    const tier = await tierOf(userId);
    const lim = limitsOf(tier);
    const sub = await db.one('SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    return {
      tier,
      limits: { trade: m.fmtUsdt(lim.trade), withdraw: m.fmtUsdt(lim.withdraw) },
      used: { trade: m.fmtUsdt(await tradeVolume(userId)), withdraw: m.fmtUsdt(await withdrawVolume(userId)) },
      tiers: Object.fromEntries(Object.entries(config.kycLimits).map(([k, v]) => [k, { trade: m.fmtUsdt(v.trade), withdraw: m.fmtUsdt(v.withdraw) }])),
      submission: sub ? await submissionView(sub) : null,
    };
  }

  // ---------- enforcement ----------
  async function assertCanPostOffer(userId) {
    if ((await tierOf(userId)) < 1) throw forbidden('kyc_required');
  }

  // actorId opened the trade; both sides must stay within their own 24h limit. Runs inside the
  // trade transaction; per-user advisory locks (taken in id order) stop parallel trades racing the limit.
  async function assertTrade({ actorId, buyerId, sellerId, amount }) {
    for (const uid of [buyerId, sellerId].sort((a, b) => a - b)) await db.run('SELECT pg_advisory_xact_lock(?, ?)', [9002, uid]);
    for (const uid of [buyerId, sellerId]) {
      const lim = limitsOf(await tierOf(uid)).trade;
      if (lim === 0) throw forbidden(uid === actorId ? 'kyc_required' : 'counterparty_limit');
      if ((await tradeVolume(uid)) + amount > lim) throw conflict(uid === actorId ? 'limit_exceeded' : 'counterparty_limit');
    }
  }

  async function assertWithdraw(userId, amount) {
    const lim = limitsOf(await tierOf(userId)).withdraw;
    if (lim === 0) throw forbidden('kyc_required');
    if ((await withdrawVolume(userId)) + amount > lim) throw conflict('limit_exceeded');
  }

  // ---------- submissions ----------
  const getSub = (id) => db.one('SELECT * FROM kyc_submissions WHERE id = ?', [id]);

  async function submissionView(s, withFiles = false) {
    const v = {
      id: s.id, userId: s.user_id, docType: s.doc_type, fullName: s.full_name, docNumber: s.doc_number, status: s.status,
      tierGranted: s.tier_granted, reason: s.reason, createdAt: s.created_at, submittedAt: s.submitted_at, reviewedAt: s.reviewed_at,
      files: await db.query('SELECT kind, mime, size FROM kyc_files WHERE submission_id = ? ORDER BY kind', [s.id]),
    };
    if (!withFiles) delete v.userId;
    return v;
  }

  async function startSubmission(userId, input) {
    if ((await tierOf(userId)) < 1) throw forbidden('phone_first');
    const open = await db.one("SELECT * FROM kyc_submissions WHERE user_id = ? AND status IN ('draft','pending') ORDER BY id DESC LIMIT 1", [userId]);
    if (open?.status === 'pending') throw conflict('kyc_pending');
    const docType = input.docType;
    if (!['tazkira', 'passport'].includes(docType)) throw bad('invalid_doc_type');
    const fullName = String(input.fullName ?? '').trim().slice(0, 100);
    const docNumber = String(input.docNumber ?? '').trim().slice(0, 40);
    if (fullName.length < 3) throw bad('invalid_full_name');
    if (!/^[\p{L}\p{N} /-]{4,40}$/u.test(docNumber)) throw bad('invalid_doc_number');
    if (open) {
      return submissionView(await db.one('UPDATE kyc_submissions SET doc_type = ?, full_name = ?, doc_number = ? WHERE id = ? RETURNING *', [docType, fullName, docNumber, open.id]));
    }
    return submissionView(
      await db.one('INSERT INTO kyc_submissions (user_id, doc_type, full_name, doc_number, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *', [userId, docType, fullName, docNumber, now()])
    );
  }

  async function ownDraft(userId, id) {
    const s = await db.one('SELECT * FROM kyc_submissions WHERE id = ? AND user_id = ?', [id, userId]);
    if (!s) throw notFound();
    if (s.status !== 'draft') throw conflict('kyc_not_editable');
    return s;
  }

  async function addFile(userId, id, kind, buf) {
    const s = await ownDraft(userId, id);
    if (!KINDS.includes(kind)) throw bad('invalid_file_kind');
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw bad('empty_file');
    if (buf.length > MAX_FILE) throw bad('file_too_large');
    const mime = sniffImage(buf);
    if (!mime) throw bad('invalid_image');
    const name = `${s.user_id}/${crypto.randomBytes(16).toString('hex')}.bin`;
    await storage.put(name, box.seal(buf));
    const old = await db.one('SELECT path FROM kyc_files WHERE submission_id = ? AND kind = ?', [s.id, kind]);
    await db.run(
      `INSERT INTO kyc_files (submission_id, kind, path, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (submission_id, kind) DO UPDATE SET path = excluded.path, mime = excluded.mime, size = excluded.size,
         sha256 = excluded.sha256, created_at = excluded.created_at`,
      [s.id, kind, name, mime, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), now()]
    );
    if (old) await storage.remove(old.path).catch(() => {});
    return submissionView(await getSub(s.id));
  }

  async function submit(userId, id) {
    const s = await ownDraft(userId, id);
    const kinds = (await db.query('SELECT kind FROM kyc_files WHERE submission_id = ?', [s.id])).map((f) => f.kind);
    if (!kinds.includes('front') || !kinds.includes('selfie')) throw bad('kyc_files_missing');
    return submissionView(await db.one("UPDATE kyc_submissions SET status = 'pending', submitted_at = ? WHERE id = ? RETURNING *", [now(), s.id]));
  }

  // ---------- staff review ----------
  async function list(status) {
    const rows = await db.query(
      `SELECT k.*, u.username, u.display_name, u.kyc_tier FROM kyc_submissions k JOIN users u ON u.id = k.user_id
       WHERE (?::text IS NULL AND k.status != 'draft') OR k.status = ? ORDER BY k.id DESC LIMIT 200`,
      [status ?? null, status ?? null]
    );
    return Promise.all(rows.map(async (r) => ({ ...(await submissionView(r, true)), username: r.username, displayName: r.display_name, currentTier: r.kyc_tier })));
  }

  async function readFile(id, kind) {
    const f = await db.one('SELECT * FROM kyc_files WHERE submission_id = ? AND kind = ?', [id, kind]);
    if (!f) throw notFound();
    return { mime: f.mime, data: box.open(await storage.get(f.path)) };
  }

  function review(id, approve, { tier = 2, reason = '' } = {}, reviewerId) {
    return db.tx(async () => {
      const s = await db.one('SELECT * FROM kyc_submissions WHERE id = ? FOR UPDATE', [id]);
      if (!s) throw notFound();
      if (s.user_id === reviewerId) throw forbidden('own_request');
      if (s.status !== 'pending') throw conflict('already_reviewed');
      const t = Number(tier);
      if (approve && ![2, 3].includes(t)) throw bad('invalid_tier');
      const why = String(reason ?? '').trim().slice(0, 500);
      if (!approve && !why) throw bad('reason_required');
      const row = await db.one(
        'UPDATE kyc_submissions SET status = ?, tier_granted = ?, reason = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ? RETURNING *',
        [approve ? 'approved' : 'rejected', approve ? t : null, why || null, reviewerId, now(), s.id]
      );
      if (approve) await db.run('UPDATE users SET kyc_tier = GREATEST(kyc_tier, ?) WHERE id = ?', [t, s.user_id]);
      await notify(s.user_id, approve ? 'kyc_approved' : 'kyc_rejected', approve ? { tier: t } : {});
      return submissionView(row, true);
    });
  }

  async function setTier(userId, tier) {
    const t = Number(tier);
    if (![0, 1, 2, 3].includes(t)) throw bad('invalid_tier');
    if (!(await db.run('UPDATE users SET kyc_tier = ? WHERE id = ?', [t, userId])).rowCount) throw notFound();
  }

  return { status, assertCanPostOffer, assertTrade, assertWithdraw, startSubmission, addFile, submit, list, readFile, review, setTier, tierOf };
}

module.exports = { createKyc, sniffImage };
