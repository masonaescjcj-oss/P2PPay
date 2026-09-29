'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { open } = require('./db');
const { createWallet } = require('./wallet');
const { createMarket } = require('./market');
const { createFunds } = require('./funds');
const { hashPassword, verifyPassword, createAuth, rateLimit } = require('./auth');
const { ApiError, bad, conflict, notFound } = require('./errors');
const m = require('./money');

function createApp(config) {
  const db = open(config.dbPath);
  const wallet = createWallet(db);
  const market = createMarket(db, wallet, config);
  const funds = createFunds(db, wallet, config);
  const auth = createAuth(db, config);

  seedAdmin(db, config);

  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:"
    );
    next();
  });
  // The built React app (web/dist) is served from the same origin as the API.
  const webDist = config.webDist || path.join(__dirname, '..', '..', 'web', 'dist');
  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) app.use(express.static(webDist));

  const api = express.Router();
  api.use(express.json({ limit: '32kb' }));
  // CSRF: state-changing requests must be JSON (cannot be sent cross-site by a plain form),
  // on top of SameSite=Strict session cookies.
  api.use((req, _res, next) => {
    if (req.method !== 'GET' && !req.is('application/json')) return next(bad('json_required'));
    next();
  });
  api.use(auth.session);

  const u = auth.requireUser;
  const admin = auth.requireAdmin;
  const id = (req) => {
    const n = Number.parseInt(req.params.id, 10);
    if (!(n > 0)) throw notFound();
    return n;
  };
  const isAdmin = (req) => req.user?.role === 'admin';

  // ---------- public ----------
  api.get('/config', (_req, res) => {
    res.json({
      fiat: config.fiat,
      network: config.network,
      depositAddress: config.depositAddress,
      tradeFeeBps: config.tradeFeeBps,
      withdrawFee: m.fmtUsdt(config.withdrawFeeMicro),
      minWithdraw: m.fmtUsdt(config.minWithdrawMicro),
      paymentMethods: config.paymentMethods,
    });
  });

  // ---------- auth ----------
  const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 20 });

  api.post('/auth/register', authLimit, (req, res) => {
    const username = String(req.body.username ?? '').trim();
    const password = String(req.body.password ?? '');
    const displayName = String(req.body.displayName ?? '').trim().slice(0, 40) || username;
    const phone = String(req.body.phone ?? '').trim().slice(0, 20) || null;
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw bad('invalid_username');
    if (password.length < 8 || password.length > 200) throw bad('weak_password');
    if (phone && !/^\+?[0-9 ]{7,20}$/.test(phone)) throw bad('invalid_phone');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('username_taken');
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO users (username, phone, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(username, phone, displayName, hashPassword(password), Date.now());
    auth.login(res, Number(lastInsertRowid));
    res.status(201).json({ id: Number(lastInsertRowid), username, displayName, role: 'user' });
  });

  api.post('/auth/login', authLimit, (req, res) => {
    const username = String(req.body.username ?? '').trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash))
      throw new ApiError(401, 'invalid_credentials');
    if (user.is_blocked) throw new ApiError(403, 'account_blocked');
    auth.login(res, user.id);
    res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
  });

  api.post('/auth/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  api.get('/me', u, (req, res) => {
    res.json({ ...req.user, ...market.stats(req.user.id) });
  });

  // ---------- wallet ----------
  api.get('/wallet', u, (req, res) => {
    const b = wallet.balance(req.user.id);
    res.json({
      available: m.fmtUsdt(b.available),
      locked: m.fmtUsdt(b.locked),
      total: m.fmtUsdt(b.available + b.locked),
      ledger: wallet.history(req.user.id).map((l) => ({
        id: l.id, kind: l.kind, available: m.fmtUsdt(l.available_delta), locked: m.fmtUsdt(l.locked_delta),
        refType: l.ref_type, refId: l.ref_id, createdAt: l.created_at,
      })),
      deposits: funds.myDeposits(req.user.id),
      withdrawals: funds.myWithdrawals(req.user.id),
    });
  });
  api.post('/deposits', u, (req, res) => res.status(201).json(funds.requestDeposit(req.user.id, req.body)));
  api.post('/withdrawals', u, (req, res) => res.status(201).json(funds.requestWithdrawal(req.user.id, req.body)));

  // ---------- payment accounts ----------
  const accountView = (a) => ({ id: a.id, method: a.method, holderName: a.holder_name, account: a.account });
  api.get('/payment-accounts', u, (req, res) => {
    res.json(db.prepare('SELECT * FROM payment_accounts WHERE user_id = ? ORDER BY id').all(req.user.id).map(accountView));
  });
  api.post('/payment-accounts', u, (req, res) => {
    const method = String(req.body.method ?? '');
    const holderName = String(req.body.holderName ?? '').trim().slice(0, 80);
    const account = String(req.body.account ?? '').trim().slice(0, 80);
    if (!config.paymentMethods.includes(method)) throw bad('invalid_payment_method');
    if (!holderName || !account) throw bad('invalid_payment_account');
    db.prepare(
      `INSERT INTO payment_accounts (user_id, method, holder_name, account, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, method) DO UPDATE SET holder_name = excluded.holder_name, account = excluded.account`
    ).run(req.user.id, method, holderName, account, Date.now());
    const row = db.prepare('SELECT * FROM payment_accounts WHERE user_id = ? AND method = ?').get(req.user.id, method);
    res.status(201).json(accountView(row));
  });
  api.post('/payment-accounts/:id/delete', u, (req, res) => {
    const r = db.prepare('DELETE FROM payment_accounts WHERE id = ? AND user_id = ?').run(id(req), req.user.id);
    if (!r.changes) throw notFound();
    res.json({ ok: true });
  });

  // ---------- offers ----------
  api.get('/offers', (req, res) => {
    res.json(market.listMarket({ side: req.query.side, paymentMethod: req.query.paymentMethod, fiat: req.query.fiat }));
  });
  api.get('/offers/mine', u, (req, res) => res.json(market.myOffers(req.user.id)));
  api.get('/offers/:id', (req, res) => res.json(market.offer(id(req))));
  api.post('/offers', u, (req, res) => res.status(201).json(market.createOffer(req.user.id, req.body)));
  api.post('/offers/:id/status', u, (req, res) =>
    res.json(market.setOfferStatus(req.user.id, id(req), req.body.status, isAdmin(req)))
  );
  api.post('/offers/:id/trades', u, (req, res) =>
    res.status(201).json(market.openTrade(req.user.id, id(req), req.body))
  );

  // ---------- trades ----------
  api.get('/trades', u, (req, res) => res.json(market.myTrades(req.user.id)));
  api.get('/trades/:id', u, (req, res) => res.json(market.trade(req.user.id, id(req), isAdmin(req))));
  for (const action of ['pay', 'release', 'cancel', 'dispute']) {
    api.post(`/trades/:id/${action}`, u, (req, res) => res.json(market.action(req.user.id, id(req), action, req.body)));
  }
  api.get('/trades/:id/messages', u, (req, res) =>
    res.json(market.messages(req.user.id, id(req), Number(req.query.after) || 0, isAdmin(req)))
  );
  api.post('/trades/:id/messages', u, rateLimit({ windowMs: 60_000, max: 30 }), (req, res) =>
    res.status(201).json(market.postMessage(req.user.id, id(req), req.body.body, isAdmin(req)))
  );

  // ---------- admin ----------
  api.get('/admin/overview', admin, (_req, res) => {
    const sum = db.prepare('SELECT COALESCE(SUM(available),0) a, COALESCE(SUM(locked),0) l FROM balances').get();
    const fees = db.prepare("SELECT COALESCE(SUM(available_delta),0) f FROM ledger WHERE kind = 'fee'").get().f;
    const count = (sql) => db.prepare(sql).get().n;
    res.json({
      users: count('SELECT COUNT(*) n FROM users'),
      pendingDeposits: count("SELECT COUNT(*) n FROM deposits WHERE status = 'pending'"),
      pendingWithdrawals: count("SELECT COUNT(*) n FROM withdrawals WHERE status = 'pending'"),
      disputes: count("SELECT COUNT(*) n FROM trades WHERE status = 'disputed'"),
      openTrades: count("SELECT COUNT(*) n FROM trades WHERE status IN ('pending_payment','paid','disputed')"),
      userBalances: m.fmtUsdt(sum.a + sum.l),
      fees: m.fmtUsdt(fees),
    });
  });
  api.get('/admin/deposits', admin, (req, res) => res.json(funds.allDeposits(req.query.status || null)));
  for (const decision of ['approve', 'reject']) {
    api.post(`/admin/deposits/:id/${decision}`, admin, (req, res) =>
      res.json(funds.reviewDeposit(id(req), decision === 'approve', req.body))
    );
    api.post(`/admin/withdrawals/:id/${decision}`, admin, (req, res) =>
      res.json(funds.reviewWithdrawal(id(req), decision === 'approve', req.body))
    );
  }
  api.get('/admin/withdrawals', admin, (req, res) => res.json(funds.allWithdrawals(req.query.status || null)));
  api.get('/admin/trades', admin, (req, res) => res.json(market.listTrades(req.query.status || null)));
  api.post('/admin/trades/:id/resolve', admin, (req, res) =>
    res.json(market.resolveDispute(id(req), req.body.winner, req.body.note))
  );
  api.get('/admin/users', admin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.phone, u.role, u.is_blocked, u.created_at,
           COALESCE(b.available,0) available, COALESCE(b.locked,0) locked
         FROM users u LEFT JOIN balances b ON b.user_id = u.id ORDER BY u.id DESC LIMIT 500`
      )
      .all();
    res.json(rows.map((r) => ({
      id: r.id, username: r.username, displayName: r.display_name, phone: r.phone, role: r.role,
      blocked: !!r.is_blocked, createdAt: r.created_at, available: m.fmtUsdt(r.available), locked: m.fmtUsdt(r.locked),
    })));
  });
  api.post('/admin/users/:id/block', admin, (req, res) => {
    const uid = id(req);
    if (uid === req.user.id) throw bad('cannot_block_self');
    db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(req.body.blocked ? 1 : 0, uid);
    if (req.body.blocked) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    res.json({ ok: true });
  });

  api.use((_req, _res, next) => next(notFound()));
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  app.use('/api', api);
  if (hasWeb) app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));

  const sweeper = setInterval(() => market.expireTrades(), 30_000);
  sweeper.unref();
  app.locals.close = () => {
    clearInterval(sweeper);
    db.close();
  };
  app.locals.db = db;
  return app;
}

function seedAdmin(db, config) {
  if (!config.adminUsername || !config.adminPassword) return;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(config.adminUsername);
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)"
  ).run(config.adminUsername, 'Admin', hashPassword(config.adminPassword), Date.now());
}

module.exports = { createApp };
