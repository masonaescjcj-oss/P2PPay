'use strict';

// Staff panel API. Every route names the permission it needs (see security/roles.js);
// every decision is written to the audit log in the same transaction as the change.
const { bad, forbidden, notFound } = require('../errors');
const { ROLES, permsOf } = require('../security/roles');
const m = require('../money');

function adminRoutes(api, ctx) {
  const { db, market, funds, chain, chainOn, kyc, alerts, beta, auth, id } = ctx;
  const perm = auth.requirePerm;

  const noteOf = (req) => (req.body?.note ? String(req.body.note).slice(0, 500) : null);
  const logAction = (req, action, type, targetId) =>
    db.run('INSERT INTO admin_actions (admin_id, action, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      req.user.id, action, type, targetId, noteOf(req), Date.now(),
    ]);
  const audited = (req, action, type, targetId, fn) =>
    db.tx(async () => {
      const out = await fn();
      await logAction(req, action, type, targetId);
      return out;
    });
  const count = async (sql) => (await db.one(sql)).n;

  api.get('/admin/overview', perm(null), async (req, res) => {
    const sum = await db.one('SELECT COALESCE(SUM(available),0) a, COALESCE(SUM(locked),0) l FROM balances');
    const fees = (await db.one("SELECT COALESCE(SUM(available_delta),0) f FROM ledger WHERE kind = 'fee'")).f;
    res.json({
      perms: req.user.perms,
      users: await count('SELECT COUNT(*) n FROM users'),
      pendingDeposits: await count("SELECT COUNT(*) n FROM deposits WHERE status = 'pending'"),
      pendingWithdrawals: await count("SELECT COUNT(*) n FROM withdrawals WHERE status IN ('pending','failed')"),
      disputes: await count("SELECT COUNT(*) n FROM trades WHERE status = 'disputed'"),
      openTrades: await count("SELECT COUNT(*) n FROM trades WHERE status IN ('pending_payment','paid','disputed')"),
      pendingKyc: await count("SELECT COUNT(*) n FROM kyc_submissions WHERE status = 'pending'"),
      openAlerts: await alerts.openCount(),
      newFeedback: await count("SELECT COUNT(*) n FROM feedback WHERE status = 'new'"),
      openErrors: await count('SELECT COUNT(*) n FROM app_errors WHERE resolved_at IS NULL'),
      userBalances: m.fmtUsdt(sum.a + sum.l),
      fees: m.fmtUsdt(fees),
    });
  });

  // ---------- funds ----------
  api.get('/admin/deposits', perm('funds'), async (req, res) => res.json(await funds.allDeposits(req.query.status || null)));
  api.get('/admin/withdrawals', perm('funds'), async (req, res) => res.json(await funds.allWithdrawals(req.query.status || null)));
  for (const decision of ['approve', 'reject']) {
    api.post(`/admin/deposits/:id/${decision}`, perm('funds'), async (req, res) => {
      const did = id(req);
      res.json(await audited(req, `deposit_${decision}`, 'deposit', did, () =>
        funds.reviewDeposit(did, decision === 'approve', req.body, req.user.id)));
    });
    api.post(`/admin/withdrawals/:id/${decision}`, perm('funds'), async (req, res) => {
      const wid = id(req);
      // A failed on-chain attempt must be provably dead before it is refunded or settled by hand.
      if (chain) await chain.assertSettledFailure(wid);
      res.json(await audited(req, `withdrawal_${decision}`, 'withdrawal', wid, () =>
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
    const w = await db.one('SELECT user_id FROM withdrawals WHERE id = ?', [wid]);
    if (!w) throw notFound();
    if (w.user_id === req.user.id) throw forbidden('own_request');
    const out = await chain.sendWithdrawal(wid);
    await logAction(req, 'withdrawal_send', 'withdrawal', wid);
    res.json(out);
  });

  // ---------- disputes ----------
  api.get('/admin/trades', perm('disputes'), async (req, res) => res.json(await market.listTrades(req.query.status || null)));
  api.post('/admin/trades/:id/resolve', perm('disputes'), async (req, res) => {
    const tid = id(req);
    res.json(await audited(req, `resolve_${req.body.winner}`, 'trade', tid, () =>
      market.resolveDispute(tid, req.body.winner, req.body.note, req.user.id)));
  });

  // ---------- users ----------
  const userView = async (r) => ({
    id: r.id, username: r.username, displayName: r.display_name, phone: r.phone, phoneVerified: !!r.phone_verified_at,
    role: r.role, kycTier: r.kyc_tier, totpEnabled: !!r.totp_enabled_at, blocked: !!r.is_blocked, createdAt: r.created_at,
    available: m.fmtUsdt(r.available), locked: m.fmtUsdt(r.locked), ...(await market.stats(r.id)),
  });
  api.get('/admin/users', perm('users'), async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const rows = await db.query(
      `SELECT u.*, COALESCE(b.available,0) available, COALESCE(b.locked,0) locked
       FROM users u LEFT JOIN balances b ON b.user_id = u.id
       WHERE ? = '' OR u.username ILIKE ? OR u.display_name ILIKE ? OR u.phone ILIKE ?
       ORDER BY u.id DESC LIMIT 200`,
      [q, like, like, like]
    );
    const out = [];
    for (const r of rows) out.push(await userView(r));
    res.json(out);
  });
  api.post('/admin/users/:id/block', perm('users'), async (req, res) => {
    const uid = id(req);
    if (uid === req.user.id) throw bad('cannot_block_self');
    const target = await db.one('SELECT role FROM users WHERE id = ?', [uid]);
    if (!target) throw notFound();
    if (target.role !== 'user') throw forbidden('cannot_block_admin');
    await audited(req, req.body.blocked ? 'user_block' : 'user_unblock', 'user', uid, async () => {
      await db.run("UPDATE users SET is_blocked = ? WHERE id = ? AND role = 'user'", [req.body.blocked ? 1 : 0, uid]);
      if (req.body.blocked) await db.run('DELETE FROM sessions WHERE user_id = ?', [uid]);
    });
    res.json({ ok: true });
  });
  api.post('/admin/users/:id/tier', perm('kyc'), async (req, res) => {
    const uid = id(req);
    if (uid === req.user.id) throw forbidden('own_request');
    await audited(req, `tier_${Number(req.body.tier)}`, 'user', uid, () => kyc.setTier(uid, req.body.tier));
    res.json({ ok: true });
  });
  // Only full admins manage staff; nobody changes their own role.
  api.post('/admin/users/:id/role', perm('staff'), async (req, res) => {
    const uid = id(req);
    const role = String(req.body.role ?? '');
    if (!ROLES.includes(role)) throw bad('invalid_role');
    if (uid === req.user.id) throw forbidden('own_request');
    await audited(req, `role_${role}`, 'user', uid, async () => {
      if (!(await db.run('UPDATE users SET role = ? WHERE id = ?', [role, uid])).rowCount) throw notFound();
      await db.run('DELETE FROM sessions WHERE user_id = ?', [uid]); // new permissions from the next login
    });
    res.json({ ok: true, perms: permsOf(role) });
  });

  // ---------- identity verification ----------
  api.get('/admin/kyc', perm('kyc'), async (req, res) => res.json(await kyc.list(req.query.status || null)));
  api.get('/admin/kyc/:id/files/:kind', perm('kyc'), async (req, res) => {
    const f = await kyc.readFile(id(req), req.params.kind);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.end(f.data);
  });
  for (const decision of ['approve', 'reject']) {
    api.post(`/admin/kyc/:id/${decision}`, perm('kyc'), async (req, res) => {
      const kid = id(req);
      res.json(await audited(req, `kyc_${decision}`, 'kyc', kid, () =>
        kyc.review(kid, decision === 'approve', { tier: req.body.tier ?? 2, reason: req.body.reason }, req.user.id)));
    });
  }

  // ---------- alerts & audit ----------
  api.get('/admin/alerts', perm('alerts'), async (req, res) => res.json(await alerts.list(req.query.status || null)));
  api.post('/admin/alerts/:id/close', perm('alerts'), async (req, res) => {
    const aid = id(req);
    await audited(req, 'alert_close', 'alert', aid, async () => {
      if (!(await alerts.close(aid, req.user.id, req.body.note))) throw notFound();
    });
    res.json({ ok: true });
  });
  // ---------- closed beta ----------
  api.get('/admin/beta', perm('beta'), async (_req, res) => res.json(await beta.stats()));
  api.get('/admin/invites', perm('beta'), async (_req, res) => res.json(await beta.listInvites()));
  api.post('/admin/invites', perm('beta'), async (req, res) => {
    const inv = await db.tx(async () => {
      const out = await beta.createInvite(req.user.id, req.body);
      await logAction(req, 'invite_create', 'invite', out.id);
      return out;
    });
    res.status(201).json(inv);
  });
  api.post('/admin/invites/:id/revoke', perm('beta'), async (req, res) => {
    const iid = id(req);
    await audited(req, 'invite_revoke', 'invite', iid, () => beta.revokeInvite(iid));
    res.json({ ok: true });
  });
  api.get('/admin/feedback', perm('beta'), async (req, res) => res.json(await beta.listFeedback(req.query.status || null)));
  api.post('/admin/feedback/:id', perm('beta'), async (req, res) => {
    const fid = id(req);
    const action = req.body.reply !== undefined ? 'feedback_reply' : 'feedback_status';
    res.json(await audited(req, action, 'feedback', fid, () => beta.updateFeedback(fid, req.user.id, req.body)));
  });
  api.get('/admin/errors', perm('beta'), async (req, res) => res.json(await beta.listErrors(req.query.all !== '1')));
  api.post('/admin/errors/:id/resolve', perm('beta'), async (req, res) => {
    await beta.resolveError(id(req));
    res.json({ ok: true });
  });

  api.get('/admin/actions', perm('audit'), async (_req, res) => {
    const rows = await db.query(
      `SELECT a.*, u.username AS admin_username FROM admin_actions a JOIN users u ON u.id = a.admin_id
       ORDER BY a.id DESC LIMIT 200`
    );
    res.json(rows.map((r) => ({
      id: r.id, admin: r.admin_username, action: r.action, targetType: r.target_type, targetId: r.target_id,
      note: r.note, createdAt: r.created_at,
    })));
  });
}

module.exports = { adminRoutes };
