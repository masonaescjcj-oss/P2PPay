'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { createStorage } = require('./storage');
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
const { createBeta } = require('./beta');
const { accountRoutes } = require('./routes/account');
const { adminRoutes } = require('./routes/admin');
const m = require('./money');

// deps: tronClient (fake chain), sms (fake SMS sender), storage, log — for tests.
async function createApp(config, deps = {}) {
  const log = deps.log || console;
  if (config.nodeEnv === 'production') {
    // Container disks are ephemeral: production data must live in Supabase (Postgres + Storage).
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required in production');
    if (config.storage?.provider !== 'supabase') log.warn('[storage] KYC files on local disk; set STORAGE_PROVIDER=supabase');
  }
  const db = await openDb(config, { log });
  const wallet = createWallet(db);
  const box = createSecretBox(loadDataKey(config, log));
  const alerts = createAlerts(db, config);
  const storage = deps.storage || createStorage(config);
  const kyc = createKyc(db, config, { box, storage });
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
  const beta = createBeta(db, config, { box });
  const security = createSecurity(db, config, { box, sms: deps.sms || createSmsSender(config, { log }), alerts, log });

  await seedAdmin(db, config);

  const app = express();
  app.set('trust proxy', config.trustProxy ?? 'loopback');
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
  // Liveness + database check for the load balancer.
  api.get('/health', async (_req, res) => {
    await db.one('SELECT 1 AS ok');
    res.json({ ok: true, db: db.kind, chain: chain ? { leader: chain.isLeader() } : null });
  });
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
      beta: beta.publicConfig(),
      termsVersion: config.termsVersion,
      support: Object.fromEntries(Object.entries(config.support || {}).filter(([, v]) => v)),
      kycLimits: Object.fromEntries(Object.entries(config.kycLimits).map(([k, v]) => [k, { trade: m.fmtUsdt(v.trade), withdraw: m.fmtUsdt(v.withdraw) }])),
    });
  });

  const ctx = { db, config, wallet, market, funds, chain, chainOn, auth, security, kyc, alerts, beta, u, id };
  accountRoutes(api, ctx);

  // ---------- beta: feedback and error reports ----------
  api.get('/feedback', u, async (req, res) => res.json(await beta.myFeedback(req.user.id)));
  api.post('/feedback', u, rateLimit({ windowMs: 60 * 60_000, max: 10 }), async (req, res) =>
    res.status(201).json(await beta.submitFeedback(req.user.id, req.body, req))
  );
  // Browsers report their own crashes (signed in or not); grouped and counted, never shown to users.
  api.post('/client-errors', rateLimit({ windowMs: 10 * 60_000, max: 30 }), async (req, res) => {
    await beta.recordError('web', { ...req.body, userAgent: req.headers['user-agent'] }, req.user?.id ?? null);
    res.status(204).end();
  });

  // ---------- wallet ----------
  api.get('/wallet', u, async (req, res) => {
    const b = await wallet.balance(req.user.id);
    res.json({
      available: m.fmtUsdt(b.available),
      locked: m.fmtUsdt(b.locked),
      total: m.fmtUsdt(b.available + b.locked),
      ledger: (await wallet.history(req.user.id)).map((l) => ({
        id: l.id, kind: l.kind, available: m.fmtUsdt(l.available_delta), locked: m.fmtUsdt(l.locked_delta),
        refType: l.ref_type, refId: l.ref_id, createdAt: l.created_at,
      })),
      deposits: await funds.myDeposits(req.user.id),
      withdrawals: await funds.myWithdrawals(req.user.id),
    });
  });
  api.post('/deposits', u, async (req, res) => {
    // With per-user addresses, deposits are detected on chain; manual TxID claims are not needed.
    if (chainOn) throw bad('chain_deposits_only');
    res.status(201).json(await funds.requestDeposit(req.user.id, req.body));
  });
  api.get('/deposit-address', u, async (req, res) => {
    if (!chainOn) throw notFound();
    res.json({ address: await chain.depositAddress(req.user.id), network: 'TRC20', minDeposit: m.fmtUsdt(config.tron.minDepositMicro) });
  });
  api.post('/deposit-address/check', u, rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
    if (!chainOn) throw notFound();
    await chain.depositAddress(req.user.id);
    res.json({ credited: await chain.scanUser(req.user.id) });
  });
  // Withdrawals need a fresh second factor: authenticator code, or an SMS code sent here first.
  api.post('/withdrawals/code', u, rateLimit({ windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
    await security.sendWithdrawalCode(req.user.id, req);
    res.json({ ok: true });
  });
  api.post('/withdrawals', u, async (req, res) => {
    funds.validateWithdrawal(req.body);
    await security.checkWithdrawalCode(req.user.id, req.body.code, req);
    const w = await funds.requestWithdrawal(req.user.id, req.body);
    await security.event(req.user.id, 'withdrawal_requested', req);
    res.status(201).json(w);
  });

  // ---------- payment accounts ----------
  const accountView = (a) => ({ id: a.id, method: a.method, holderName: a.holder_name, account: a.account });
  api.get('/payment-accounts', u, async (req, res) => {
    res.json((await db.query('SELECT * FROM payment_accounts WHERE user_id = ? ORDER BY id', [req.user.id])).map(accountView));
  });
  api.post('/payment-accounts', u, async (req, res) => {
    const method = String(req.body.method ?? '');
    const holderName = String(req.body.holderName ?? '').trim().slice(0, 80);
    const account = String(req.body.account ?? '').trim().slice(0, 80);
    if (!config.paymentMethods.includes(method)) throw bad('invalid_payment_method');
    if (!holderName || !account) throw bad('invalid_payment_account');
    const row = await db.one(
      `INSERT INTO payment_accounts (user_id, method, holder_name, account, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, method) DO UPDATE SET holder_name = excluded.holder_name, account = excluded.account
       RETURNING *`,
      [req.user.id, method, holderName, account, Date.now()]
    );
    res.status(201).json(accountView(row));
  });
  api.post('/payment-accounts/:id/delete', u, async (req, res) => {
    const r = await db.run('DELETE FROM payment_accounts WHERE id = ? AND user_id = ?', [id(req), req.user.id]);
    if (!r.rowCount) throw notFound();
    res.json({ ok: true });
  });

  // ---------- offers ----------
  api.get('/offers', async (req, res) => {
    res.json(await market.listMarket({ side: req.query.side, paymentMethod: req.query.paymentMethod, fiat: req.query.fiat }));
  });
  api.get('/offers/mine', u, async (req, res) => res.json(await market.myOffers(req.user.id)));
  api.get('/offers/:id', async (req, res) => res.json(await market.offer(id(req))));
  api.post('/offers', u, async (req, res) => res.status(201).json(await market.createOffer(req.user.id, req.body)));
  api.post('/offers/:id/status', u, async (req, res) =>
    res.json(await market.setOfferStatus(req.user.id, id(req), req.body.status, isStaff(req)))
  );
  api.post('/offers/:id/trades', u, async (req, res) =>
    res.status(201).json(await market.openTrade(req.user.id, id(req), req.body))
  );

  // ---------- trades ----------
  api.get('/trades', u, async (req, res) => res.json(await market.myTrades(req.user.id)));
  api.get('/trades/:id', u, async (req, res) => res.json(await market.trade(req.user.id, id(req), isStaff(req))));
  for (const action of ['pay', 'release', 'cancel', 'dispute']) {
    api.post(`/trades/:id/${action}`, u, async (req, res) => res.json(await market.action(req.user.id, id(req), action, req.body)));
  }
  api.get('/trades/:id/messages', u, async (req, res) =>
    res.json(await market.messages(req.user.id, id(req), Number(req.query.after) || 0, isStaff(req)))
  );
  api.post('/trades/:id/messages', u, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) =>
    res.status(201).json(await market.postMessage(req.user.id, id(req), req.body.body, isStaff(req)))
  );

  adminRoutes(api, ctx);

  api.use((_req, _res, next) => next(notFound()));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ ...err.details, error: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.code === '23505') return res.status(409).json({ error: 'conflict' }); // unique violation from a race
    if (err.code === '40P01') return res.status(409).json({ error: 'try_again' }); // deadlock victim
    log.error(err);
    beta
      .recordError('server', { message: err.message, stack: err.stack, page: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}` }, req.user?.id ?? null)
      .catch(() => {});
    res.status(500).json({ error: 'server_error' });
  });

  app.use('/api', api);
  if (hasWeb) app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));

  const sweeper = setInterval(() => market.expireTrades().catch((e) => log.error('[market] expire', e.message)), 30_000);
  sweeper.unref();
  if (chain && deps.autoStartChain !== false) chain.start();
  app.locals.close = async () => {
    clearInterval(sweeper);
    await chain?.stop();
    await db.close();
  };
  app.locals.db = db;
  app.locals.chain = chain;
  // For tools that run in-process (the browser test build seeds sample traders with these).
  app.locals.services = { wallet, market, funds, security, beta };
  return app;
}

async function seedAdmin(db, config) {
  if (!config.adminUsername || !config.adminPassword) return;
  const existing = await db.one('SELECT id FROM users WHERE lower(username) = lower(?)', [config.adminUsername]);
  if (existing) {
    await db.run("UPDATE users SET role = 'admin' WHERE id = ?", [existing.id]);
    return;
  }
  await db.run(
    "INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?) ON CONFLICT DO NOTHING",
    [config.adminUsername, 'Admin', hashPassword(config.adminPassword), Date.now()]
  );
}

module.exports = { createApp };
