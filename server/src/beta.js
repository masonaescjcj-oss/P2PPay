'use strict';

// Closed beta: invite codes, tester feedback (with staff replies), grouped error reports, beta metrics.
const crypto = require('node:crypto');
const { bad, conflict, notFound } = require('./errors');
const m = require('./money');

const DAY = 86_400_000;
const KINDS = ['bug', 'idea', 'question', 'other'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const clip = (v, n) => (v == null ? null : String(v).slice(0, n) || null);

// XXXX-XXXX, upper case; users may type it with spaces, dashes or in lower case.
const normalizeInvite = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function newInviteCode() {
  const bytes = crypto.randomBytes(8);
  const c = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

function createBeta(db, config, { box, notify = async () => {} }) {
  const now = () => Date.now();
  const inviteHash = (code) => box.mac(`invite:${normalizeInvite(code)}`);

  // ---------- invites ----------
  async function createInvite(staffId, input = {}) {
    const maxUses = Number.parseInt(input.maxUses ?? 1, 10);
    if (!(maxUses >= 1 && maxUses <= 1000)) throw bad('invalid_amount');
    const days = input.expiresInDays === undefined || input.expiresInDays === '' ? null : Number(input.expiresInDays);
    if (days !== null && !(days > 0 && days <= 365)) throw bad('invalid_amount');
    const code = newInviteCode();
    const row = await db.one(
      `INSERT INTO invites (code_hash, hint, label, max_uses, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [inviteHash(code), code.slice(-4), clip(input.label?.trim(), 80), maxUses, days ? now() + days * DAY : null, staffId, now()]
    );
    return { ...inviteView(row), code }; // the only time the code is returned
  }

  const inviteView = (r) => ({
    id: r.id, hint: r.hint, label: r.label, maxUses: r.max_uses, uses: r.uses, expiresAt: r.expires_at,
    revoked: !!r.revoked_at, createdBy: r.created_by_username, createdAt: r.created_at,
    active: !r.revoked_at && r.uses < r.max_uses && (!r.expires_at || r.expires_at > now()),
  });

  async function listInvites() {
    const rows = await db.query(
      `SELECT i.*, u.username AS created_by_username FROM invites i JOIN users u ON u.id = i.created_by
       ORDER BY i.id DESC LIMIT 200`
    );
    return rows.map(inviteView);
  }

  async function revokeInvite(id) {
    const r = await db.run('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now(), id]);
    if (!r.rowCount) throw notFound();
  }

  // Uses one slot of an invite (call inside the sign-up transaction, so a failed sign-up gives it back).
  async function consumeInvite(code) {
    if (normalizeInvite(code).length !== 8) throw bad('invalid_invite');
    const row = await db.one(
      `UPDATE invites SET uses = uses + 1
       WHERE code_hash = ? AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)
       RETURNING id`,
      [inviteHash(code), now()]
    );
    if (!row) throw bad('invalid_invite');
    return row.id;
  }

  // ---------- feedback ----------
  const feedbackView = (r) => ({
    id: r.id, kind: r.kind, message: r.message, page: r.page, status: r.status, reply: r.reply,
    repliedAt: r.replied_at, createdAt: r.created_at,
    ...(r.username !== undefined ? { userId: r.user_id, username: r.username, userAgent: r.user_agent, repliedBy: r.replied_by_username } : {}),
  });

  async function submitFeedback(userId, input, req) {
    const kind = String(input.kind ?? '');
    if (!KINDS.includes(kind)) throw bad('invalid_feedback');
    const message = String(input.message ?? '').trim();
    if (message.length < 5 || message.length > 2000) throw bad('invalid_feedback');
    const recent = await db.one('SELECT COUNT(*) n FROM feedback WHERE user_id = ? AND created_at > ?', [userId, now() - DAY]);
    if (recent.n >= 20) throw conflict('too_many_requests');
    const row = await db.one(
      'INSERT INTO feedback (user_id, kind, message, page, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
      [userId, kind, message, clip(input.page, 200), clip(req?.headers?.['user-agent'], 200), now()]
    );
    return feedbackView(row);
  }

  const myFeedback = async (userId) =>
    (await db.query('SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 50', [userId])).map(feedbackView);

  async function listFeedback(status) {
    const rows = await db.query(
      `SELECT f.*, u.username, r.username AS replied_by_username FROM feedback f JOIN users u ON u.id = f.user_id
       LEFT JOIN users r ON r.id = f.replied_by WHERE (?::text IS NULL OR f.status = ?) ORDER BY f.id DESC LIMIT 200`,
      [status ?? null, status ?? null]
    );
    return rows.map(feedbackView);
  }

  async function updateFeedback(id, staffId, input) {
    const status = input.status === undefined ? null : String(input.status);
    if (status !== null && !['new', 'seen', 'done'].includes(status)) throw bad('invalid_status');
    const reply = input.reply === undefined ? null : String(input.reply).trim().slice(0, 2000);
    const row = await db.one(
      `UPDATE feedback SET status = COALESCE(?, status),
         reply = CASE WHEN ?::text IS NULL THEN reply ELSE NULLIF(?, '') END,
         replied_by = CASE WHEN ?::text IS NULL THEN replied_by ELSE ? END,
         replied_at = CASE WHEN ?::text IS NULL THEN replied_at ELSE ? END
       WHERE id = ? RETURNING *`,
      [status, reply, reply, reply, staffId, reply, now(), id]
    );
    if (!row) throw notFound();
    if (reply) await notify(row.user_id, 'feedback_reply', {});
    return feedbackView(row);
  }

  // ---------- error reports ----------
  // Same error (message + first stack frame + source) → one row with a counter; a resolved error that
  // comes back is reopened.
  async function recordError(source, input, userId = null) {
    const message = clip(input.message, 500) || 'unknown';
    const stack = clip(input.stack, 4000);
    const frame = (stack || '').split('\n').find((l) => /\bat\b|@/.test(l))?.trim().replace(/\?[^:)]*/g, '') || '';
    const fingerprint = crypto.createHash('sha256').update(`${source}\n${message.replace(/\d+/g, 'N')}\n${frame}`).digest('hex');
    const t = now();
    await db.run(
      `INSERT INTO app_errors (fingerprint, source, message, stack, page, user_agent, user_id, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (fingerprint) DO UPDATE SET count = app_errors.count + 1, last_seen = excluded.last_seen,
         page = excluded.page, user_agent = excluded.user_agent,
         user_id = COALESCE(excluded.user_id, app_errors.user_id), resolved_at = NULL`,
      [fingerprint, source, message, stack, clip(input.page, 200), clip(input.userAgent, 200), userId, t, t]
    );
  }

  async function listErrors(open = true) {
    const rows = await db.query(
      `SELECT e.*, u.username FROM app_errors e LEFT JOIN users u ON u.id = e.user_id
       WHERE (? = false OR e.resolved_at IS NULL) ORDER BY e.last_seen DESC LIMIT 200`,
      [open]
    );
    return rows.map((r) => ({
      id: r.id, source: r.source, message: r.message, stack: r.stack, page: r.page, userAgent: r.user_agent,
      username: r.username, count: r.count, firstSeen: r.first_seen, lastSeen: r.last_seen, resolved: !!r.resolved_at,
    }));
  }

  async function resolveError(id) {
    const r = await db.run('UPDATE app_errors SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL', [now(), id]);
    if (!r.rowCount) throw notFound();
  }

  // ---------- metrics ----------
  async function stats() {
    const t = now();
    const users = await db.one(
      `SELECT COUNT(*) FILTER (WHERE role = 'user') total,
              COUNT(*) FILTER (WHERE role = 'user' AND kyc_tier >= 1) tier1,
              COUNT(*) FILTER (WHERE role = 'user' AND kyc_tier >= 2) tier2,
              COUNT(*) FILTER (WHERE role = 'user' AND created_at > ?) new7d
       FROM users`,
      [t - 7 * DAY]
    );
    const trades = await db.one(
      `SELECT COUNT(*) total,
              COUNT(*) FILTER (WHERE status = 'completed') completed,
              COUNT(*) FILTER (WHERE status = 'cancelled') cancelled,
              COUNT(*) FILTER (WHERE status IN ('pending_payment','paid','disputed')) open,
              COUNT(*) FILTER (WHERE dispute_reason IS NOT NULL) disputed,
              COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) volume,
              COALESCE(SUM(fiat) FILTER (WHERE status = 'completed'), 0) fiat,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY closed_at - created_at) FILTER (WHERE status = 'completed') median_ms
       FROM trades`
    );
    const active = await db.one(
      `SELECT COUNT(DISTINCT uid) n FROM (
         SELECT buyer_id uid FROM trades WHERE created_at > ? UNION ALL SELECT seller_id FROM trades WHERE created_at > ?) x`,
      [t - 7 * DAY, t - 7 * DAY]
    );
    const invites = await db.one(
      'SELECT COALESCE(SUM(uses), 0) used, COALESCE(SUM(max_uses) FILTER (WHERE revoked_at IS NULL), 0) capacity FROM invites'
    );
    const fb = await db.one("SELECT COUNT(*) FILTER (WHERE status = 'new') open, COUNT(*) total FROM feedback");
    const errs = await db.one('SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL) open, COALESCE(SUM(count), 0) events FROM app_errors');
    const days = await db.query(
      `SELECT d::date AS day,
         (SELECT COUNT(*) FROM users WHERE role = 'user' AND created_at >= extract(epoch FROM d) * 1000 AND created_at < extract(epoch FROM d + interval '1 day') * 1000) signups,
         (SELECT COUNT(*) FROM trades WHERE status = 'completed' AND closed_at >= extract(epoch FROM d) * 1000 AND closed_at < extract(epoch FROM d + interval '1 day') * 1000) completed
       FROM generate_series(date_trunc('day', to_timestamp(? / 1000.0) AT TIME ZONE 'UTC') - interval '13 days',
                            date_trunc('day', to_timestamp(? / 1000.0) AT TIME ZONE 'UTC'), interval '1 day') d
       ORDER BY d`,
      [t, t]
    );
    const closed = trades.completed + trades.cancelled;
    return {
      beta: publicConfig(),
      users: { total: users.total, phoneVerified: users.tier1, idVerified: users.tier2, new7d: users.new7d, activeTraders7d: active.n },
      trades: {
        total: trades.total, completed: trades.completed, cancelled: trades.cancelled, open: trades.open, disputed: trades.disputed,
        completionRate: closed ? Math.round((trades.completed / closed) * 100) : null,
        disputeRate: trades.total ? Math.round((trades.disputed / trades.total) * 1000) / 10 : null,
        volume: m.fmtUsdt(trades.volume), fiat: m.fmtAfn(trades.fiat),
        medianMinutes: trades.median_ms == null ? null : Math.round(trades.median_ms / 60_000),
      },
      invites: { used: invites.used, capacity: invites.capacity },
      feedback: { open: fb.open, total: fb.total },
      errors: { open: errs.open, events: errs.events },
      daily: days.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), signups: d.signups, completed: d.completed })),
    };
  }

  // What the web app shows about the beta (banner, sign-up form, limits).
  function publicConfig() {
    const b = config.beta || {};
    return {
      inviteOnly: !!b.inviteOnly,
      maxTrade: b.maxTradeMicro ? m.fmtUsdt(b.maxTradeMicro) : null,
      maxOffer: b.maxOfferMicro ? m.fmtUsdt(b.maxOfferMicro) : null,
      label: b.label || null,
    };
  }

  return {
    normalizeInvite, createInvite, listInvites, revokeInvite, consumeInvite,
    submitFeedback, myFeedback, listFeedback, updateFeedback,
    recordError, listErrors, resolveError, stats, publicConfig,
  };
}

module.exports = { createBeta, normalizeInvite, newInviteCode };
