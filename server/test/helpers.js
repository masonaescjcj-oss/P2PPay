'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const baseConfig = require('../src/config');
const totp = require('../src/security/totp');

const TXID = (n) => n.toString(16).padStart(64, 'a');
const ADDR = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
let phoneSeq = 0;
let dbSeq = 0;
const quietLog = { log() {}, info() {}, warn() {}, error: console.error };

// A fake SMS gateway: remembers the last code sent to each number.
function fakeSms() {
  const sent = [];
  const send = async (to, text) => sent.push({ to, text, code: text.match(/\d{6}/)?.[0] });
  send.sent = sent;
  send.last = (to) => [...sent].reverse().find((m) => m.to === to)?.code;
  return send;
}

// TEST_DATABASE_URL=postgres://…/postgres runs the suite against a real PostgreSQL server
// (a fresh database per test); otherwise each test gets an in-memory PGlite.
async function freshDatabase() {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return { url: '', drop: async () => {} };
  const { Client } = require('pg');
  const name = `p2ppay_test_${process.pid}_${++dbSeq}_${Date.now().toString(36)}`;
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      const d = new Client({ connectionString: admin });
      await d.connect();
      await d.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await d.end();
    },
  };
}

async function setup(overrides = {}, deps = {}) {
  const kycDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2ppay-kyc-'));
  const database = await freshDatabase();
  const config = {
    ...baseConfig, databaseUrl: database.url, pgliteDir: ':memory:', dataKey: '', storage: { provider: 'local' },
    adminUsername: 'admin', adminPassword: 'adminpass123', tradeFeeBps: 10,
    otpResendMs: 0, kycDir, ...overrides,
  };
  const sms = deps.sms || fakeSms();
  const app = await createApp(config, { ...deps, sms, log: deps.log || quietLog });
  const db = app.locals.db;
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  function client() {
    let cookie = '';
    const call = async (method, p, body, headers = {}) => {
      const raw = Buffer.isBuffer(body);
      const res = await fetch(base + p, {
        method,
        headers: { 'content-type': 'application/json', cookie, ...headers },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const type = res.headers.get('content-type') || '';
      return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
    };
    return {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      upload: (p, buf, type = 'image/png') => call('POST', p, buf, { 'content-type': type, 'x-p2ppay-upload': '1' }),
    };
  }

  // Phone verification through the fake SMS gateway (KYC tier 1).
  async function verifyPhone(c, phone = `+9370${String(++phoneSeq).padStart(7, '0')}`) {
    assert.equal((await c.post('/me/phone', { phone })).status, 200);
    const r = await c.post('/me/phone/verify', { code: sms.last(phone) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return phone;
  }

  async function user(name, { verified = true } = {}) {
    const c = client();
    const r = await c.post('/auth/register', { username: name, password: 'password123' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    if (verified) c.phone = await verifyPhone(c);
    return c;
  }

  // Turns on the authenticator app; returns the base32 secret (codes via totp.totp(secret)).
  async function enableTotp(c, now = Date.now()) {
    const { secret } = (await c.post('/me/totp/setup')).data;
    const code = totp.totp(secret, now);
    const r = await c.post('/me/totp/enable', { code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    c.totpSecret = secret;
    c.enableCode = code;
    c.backupCodes = r.data.backupCodes;
    return secret;
  }

  // Staff must use 2FA; the seeded admin enables it on first login.
  const admin = client();
  assert.equal((await admin.post('/auth/login', { username: 'admin', password: 'adminpass123' })).status, 200);
  await enableTotp(admin);

  async function fund(c, amount, n) {
    const d = await c.post('/deposits', { amount, txid: TXID(n) });
    assert.equal(d.status, 201, JSON.stringify(d.data));
    const a = await admin.post(`/admin/deposits/${d.data.id}/approve`, {});
    assert.equal(a.status, 200, JSON.stringify(a.data));
  }

  async function account(c, method) {
    const r = await c.post('/payment-accounts', { method, holderName: 'Test Holder', account: `0700-${method}` });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }

  // Requests a withdrawal with a fresh SMS code (or authenticator code when the user has one).
  async function withdraw(c, body) {
    let code;
    if (c.totpSecret) {
      code = totp.totp(c.totpSecret);
    } else {
      await c.post('/withdrawals/code');
      code = sms.last(c.phone);
    }
    return c.post('/withdrawals', { ...body, code });
  }

  const balance = async (c) => (await c.get('/wallet')).data;
  const close = async () => {
    await new Promise((r) => server.close(r));
    await app.locals.close();
    await database.drop();
    fs.rmSync(kycDir, { recursive: true, force: true });
  };
  return { app, db, config, base, admin, user, client, fund, account, balance, close, sms, verifyPhone, enableTotp, withdraw };
}

module.exports = { setup, fakeSms, TXID, ADDR };
