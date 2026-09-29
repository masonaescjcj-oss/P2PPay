'use strict';

// Staff panel API. Every route names the permission it needs (see security/roles.js);
// every decision is written to the audit log in the same transaction as the change.
const { bad, forbidden, notFound } = require('../errors');
const { ROLES, permsOf } = require('../security/roles');
const m = require('../money');

function adminRoutes(api, ctx) {
  const { db, market, funds, chain, chainOn, kyc, alerts, auth, id } = ctx;
  const perm = auth.requirePerm;

  const insertAction = db.prepare(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const noteOf = (req) => (req.body?.note ? String(req.body.note).slice(0, 500) : null);
  const audited = (req, action, type, targetId, fn) =>
    db.tx(() => {
      const out = fn();
      insertAction.run(req.user.id, action, type, targetId, noteOf(req), Date.now());
      return out;
    });

  api.get('/admin/overview', perm(null), (req, res) => {
    const sum = db.prepare('SELECT COALESCE(SUM(available),0) a, COALESCE(SUM(locked),0) l FROM balances').get();
    const fees = db.prepare("SELECT COALESCE(SUM(available_delta),0) f FROM ledger WHERE kind = 'fee'").get().f;
    const count = (sql) => db.prepare(sql).get().n;
    res.json({
      perms: req.user.perms,
      users: count('SELECT COUNT(*) n FROM users'),
      pendingDeposits: count("SELECT COUNT(*) n FROM deposits WHERE status = 'pending'"),
      pendingWithdrawals: count("SELECT COUNT(*) n FROM withdrawals WHERE status IN ('pending','failed')"),
      disputes: count("SELECT COUNT(*) n FROM trades WHERE status = 'disputed'"),
      openTrades: count("SELECT COUNT(*) n FROM trades WHERE status IN ('pending_payment','paid','disputed')"),
      pendingKyc: count("SELECT COUNT(*) n FROM kyc_submissions WHERE status = 'pending'"),
      openAlerts: alerts.openCount(),
      userBalances: m.fmtUsdt(sum.a + sum.l),
      fees: m.fmtUsdt(fees),
    });
  });

  // ---------- funds ----------
  api.get('/admin/deposits', perm('funds'), (req, res) => res.json(funds.allDeposits(req.query.status || null)));
  api.get('/admin/withdrawals', perm('funds'), (req, res) => res.json(funds.allWithdrawals(req.query.status || null)));
  for (const decision of ['approve', 'reject']) {
    api.post(`/admin/deposits/:id/${decision}`, perm('funds'), (req, res) => {
      const did = id(req);
      res.json(audited(req, `deposit_${decision}`, 'deposit', did, () =>
        funds.reviewDeposit(did, decision === 'approve', req.body, req.user.id)));
    });
    api.post(`/admin/withdrawals/:id/${decision}`, perm('funds'), async (req, res) => {
      const wid = id(req);
      // A failed on-chain attempt must be provably dead before it is refunded or settled by hand.
      if (chain) await chain.assertSettledFailure(wid);
      res.json(audited(req, `withdrawal_${decision}`, 'withdrawal', wid, () =>
        funds.reviewWithdrawal(wid, decision === 'approve', req.body, req.user.id)));
    });
  }
  api.get('/admin/chain', perm('funds'), async (_req, res) => {
    if (!chainOn) return res.json({ network: 'off' });
    res.json(await chain.status());
  });
  api.post('/admin/withdrawals/:id/send', perm('funds'), async (req, res) => {
    if (!chainOn) throw bad('chain_off');
    const wid = id(req);
    const w = db.prepare('SELECT user_id FROM withdrawals WHERE id = ?').get(wid);
    if (!w) throw notFound();
    if (w.user_id === req.user.id) throw forbidden('own_request');
    const out = await chain.sendWithdrawal(wid);
    insertAction.run(req.user.id, 'withdrawal_send', 'withdrawal', wid, noteOf(req), Date.now());
    res.json(out);
  });

  // ---------- disputes ----------
  api.get('/admin/trades', perm('disputes'), (req, res) => res.json(market.listTrades(req.query.status || null)));
  api.post('/admin/trades/:id/resolve', perm('disputes'), (req, res) => {
    const tid = id(req);
    res.json(audited(req, `resolve_${req.body.winner}`, 'trade', tid, () =>
      market.resolveDispute(tid, req.body.winner, req.body.note, req.user.id)));
  });

  // ---------- users ----------
  const userView = (r) => ({
    id: r.id, username: r.username, displayName: r.display_name, phone: r.phone, phoneVerified: !!r.phone_verified_at,
    role: r.role, kycTier: r.kyc_tier, totpEnabled: !!r.totp_enabled_at, blocked: !!r.is_blocked, createdAt: r.created_at,
    available: m.fmtUsdt(r.available), locked: m.fmtUsdt(r.locked), ...market.stats(r.id),
  });
  api.get('/admin/users', perm('users'), (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const rows = db
      .prepare(
        `SELECT u.*, COALESCE(b.available,0) available, COALESCE(b.locked,0) locked
         FROM users u LEFT JOIN balances b ON b.user_id = u.id
         WHERE ? = '' OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\'
         ORDER BY u.id DESC LIMIT 200`
      )
      .all(q, like, like, like);
    res.json(rows.map(userView));
  });
  api.post('/admin/users/:id/block', perm('users'), (req, res) => {
    const uid = id(req);
    if (uid === req.user.id) throw bad('cannot_block_self');
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(uid);
    if (!target) throw notFound();
    if (target.role !== 'user') throw forbidden('cannot_block_admin');
    audited(req, req.body.blocked ? 'user_block' : 'user_unblock', 'user', uid, () => {
      db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(req.body.blocked ? 1 : 0, uid);
      if (req.body.blocked) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    });
    res.json({ ok: true });
  });
  api.post('/admin/users/:id/tier', perm('kyc'), (req, res) => {
    const uid = id(req);
    if (uid === req.user.id) throw forbidden('own_request');
    audited(req, `tier_${Number(req.body.tier)}`, 'user', uid, () => kyc.setTier(uid, req.body.tier));
    res.json({ ok: true });
  });
  // Only full admins manage staff; nobody changes their own role.
  api.post('/admin/users/:id/role', perm('staff'), (req, res) => {
    const uid = id(req);
    const role = String(req.body.role ?? '');
    if (!ROLES.includes(role)) throw bad('invalid_role');
    if (uid === req.user.id) throw forbidden('own_request');
    audited(req, `role_${role}`, 'user', uid, () => {
      if (!db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, uid).changes) throw notFound();
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid); // new permissions from the next login
    });
    res.json({ ok: true, perms: permsOf(role) });
  });

  // ---------- identity verification ----------
  api.get('/admin/kyc', perm('kyc'), (req, res) => res.json(kyc.list(req.query.status || null)));
  api.get('/admin/kyc/:id/files/:kind', perm('kyc'), (req, res) => {
    const f = kyc.readFile(id(req), req.params.kind);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.end(f.data);
  });
  for (const decision of ['approve', 'reject']) {
    api.post(`/admin/kyc/:id/${decision}`, perm('kyc'), (req, res) => {
      const kid = id(req);
      res.json(audited(req, `kyc_${decision}`, 'kyc', kid, () =>
        kyc.review(kid, decision === 'approve', { tier: req.body.tier ?? 2, reason: req.body.reason }, req.user.id)));
    });
  }

  // ---------- alerts & audit ----------
  api.get('/admin/alerts', perm('alerts'), (req, res) => res.json(alerts.list(req.query.status || null)));
  api.post('/admin/alerts/:id/close', perm('alerts'), (req, res) => {
    const aid = id(req);
    audited(req, 'alert_close', 'alert', aid, () => {
      if (!alerts.close(aid, req.user.id, req.body.note)) throw notFound();
    });
    res.json({ ok: true });
  });
  api.get('/admin/actions', perm('audit'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT a.*, u.username AS admin_username FROM admin_actions a JOIN users u ON u.id = a.admin_id
         ORDER BY a.id DESC LIMIT 200`
      )
      .all();
    res.json(rows.map((r) => ({
      id: r.id, admin: r.admin_username, action: r.action, targetType: r.target_type, targetId: r.target_id,
      note: r.note, createdAt: r.created_at,
    })));
  });

}

module.exports = { adminRoutes };
