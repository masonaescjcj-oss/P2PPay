'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { open } = require('./db');
const { createWallet } = require('./wallet');
const { createMarket } = require('./market');
const { createFunds } = require('./funds');
const { createChain } = require('./chain');
const { createTronClient } = require('./tron/client');
const { hashPassword, createAuth, rateLimit } = require('./auth');
const { ApiError, bad, notFound } = require('./errors');
const { createSecretBox, loadDataKey } = require('./security/secretbox');
const { createSmsSender } = require('./security/sms');
const { createSecurity } = require('./security/service');
const { createKyc } = require('./kyc');
const { createAlerts } = require('./alerts');
const { accountRoutes } = require('./routes/account');
const { adminRoutes } = require('./routes/admin');
const m = require('./money');

// deps: tronClient (fake chain), sms (fake SMS sender), log — for tests.
function createApp(config, deps = {}) {
  const log = deps.log || console;
  const db = open(config.dbPath);
  const wallet = createWallet(db);
  const box = createSecretBox(loadDataKey(config, log));
  const alerts = createAlerts(db, config);
  const kyc = createKyc(db, config, { box });
  const market = createMarket(db, wallet, config, {
    assertCanPostOffer: kyc.assertCanPostOffer,
    assertTrade: kyc.assertTrade,
    onTradeOpened: alerts.onTradeOpened,
    onBuyerCancelled: alerts.onBuyerCancelled,
    onDispute: alerts.onDispute,
  });
  const chainOn = config.tron && config.tron.network !== 'off';
  const chain = chainOn
    ? createChain(db, wallet, config, {
      client: deps.tronClient || createTronClient({ apiUrl: config.tron.apiUrl, apiKey: config.tron.apiKey }),
      log,
    })
    : null;
  const funds = createFunds(db, wallet, config, {
    isBlockedAddress: chain ? chain.isPlatformAddress : null,
    beforeWithdraw: kyc.assertWithdraw,
    onWithdrawal: alerts.onWithdrawalRequested,
  });
  const auth = createAuth(db, config);
  const security = createSecurity(db, config, { box, sms: deps.sms || createSmsSender(config, { log }), alerts, log });

  seedAdmin(db, config);

  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
  // CSRF: state-changing requests must be JSON (cannot be sent cross-site by a plain form), or an image
  // upload carrying a custom header (which a cross-site form cannot set) — on top of SameSite=Strict cookies.
  api.use((req, _res, next) => {
    if (req.method === 'GET' || req.is('application/json')) return next();
    if (/^\/kyc\/submission\/\d+\/files\//.test(req.path) && req.get('x-p2ppay-upload') === '1' && req.is('image/*')) return next();
    next(bad('json_required'));
  });
  api.use(auth.session);

  const u = auth.requireUser;
  const id = (req) => {
    const n = Number.parseInt(req.params.id, 10);
    if (!(n > 0)) throw notFound();
    return n;
  };
  // Staff with the disputes permission (and 2FA when required) may read and join any trade's chat.
  const isStaff = (req) =>
    !!req.user?.perms.includes('disputes') && (!config.requireStaff2fa || req.user.totpEnabled);

  // ---------- public ----------
  api.get('/config', (_req, res) => {
    res.json({
      fiat: config.fiat,
      network: config.network,
      chain: chainOn
        ? { network: config.tron.network, explorer: config.tron.explorer, minDeposit: m.fmtUsdt(config.tron.minDepositMicro) }
        : null,
      depositAddress: chainOn ? null : config.depositAddress,
      tradeFeeBps: config.tradeFeeBps,
      withdrawFee: m.fmtUsdt(config.withdrawFeeMicro),
      minWithdraw: m.fmtUsdt(config.minWithdrawMicro),
      paymentMethods: config.paymentMethods,
      kycLimits: Object.fromEntries(Object.entries(config.kycLimits).map(([k, v]) => [k, { trade: m.fmtUsdt(v.trade), withdraw: m.fmtUsdt(v.withdraw) }])),
    });
  });

  const ctx = { db, config, wallet, market, funds, chain, chainOn, auth, security, kyc, alerts, u, id };
  accountRoutes(api, ctx);

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
  api.post('/deposits', u, (req, res) => {
    // With per-user addresses, deposits are detected on chain; manual TxID claims are not needed.
    if (chainOn) throw bad('chain_deposits_only');
    res.status(201).json(funds.requestDeposit(req.user.id, req.body));
  });
  api.get('/deposit-address', u, (req, res) => {
    if (!chainOn) throw notFound();
    res.json({ address: chain.depositAddress(req.user.id), network: 'TRC20', minDeposit: m.fmtUsdt(config.tron.minDepositMicro) });
  });
  api.post('/deposit-address/check', u, rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
    if (!chainOn) throw notFound();
    chain.depositAddress(req.user.id);
    res.json({ credited: await chain.scanUser(req.user.id) });
  });
  // Withdrawals need a fresh second factor: authenticator code, or an SMS code sent here first.
  api.post('/withdrawals/code', u, rateLimit({ windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
    await security.sendWithdrawalCode(req.user.id, req);
    res.json({ ok: true });
  });
  api.post('/withdrawals', u, (req, res) => {
    funds.validateWithdrawal(req.body);
    security.checkWithdrawalCode(req.user.id, req.body.code, req);
    const w = funds.requestWithdrawal(req.user.id, req.body);
    security.event(req.user.id, 'withdrawal_requested', req);
    res.status(201).json(w);
  });

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
    res.json(market.setOfferStatus(req.user.id, id(req), req.body.status, isStaff(req)))
  );
  api.post('/offers/:id/trades', u, (req, res) =>
    res.status(201).json(market.openTrade(req.user.id, id(req), req.body))
  );

  // ---------- trades ----------
  api.get('/trades', u, (req, res) => res.json(market.myTrades(req.user.id)));
  api.get('/trades/:id', u, (req, res) => res.json(market.trade(req.user.id, id(req), isStaff(req))));
  for (const action of ['pay', 'release', 'cancel', 'dispute']) {
    api.post(`/trades/:id/${action}`, u, (req, res) => res.json(market.action(req.user.id, id(req), action, req.body)));
  }
  api.get('/trades/:id/messages', u, (req, res) =>
    res.json(market.messages(req.user.id, id(req), Number(req.query.after) || 0, isStaff(req)))
  );
  api.post('/trades/:id/messages', u, rateLimit({ windowMs: 60_000, max: 30 }), (req, res) =>
    res.status(201).json(market.postMessage(req.user.id, id(req), req.body.body, isStaff(req)))
  );

  adminRoutes(api, ctx);

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
  if (chain && deps.autoStartChain !== false) chain.start();
  app.locals.close = () => {
    clearInterval(sweeper);
    chain?.stop();
    db.close();
  };
  app.locals.db = db;
  app.locals.chain = chain;
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
