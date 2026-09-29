'use strict';

const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const baseConfig = require('../src/config');

const TXID = (n) => n.toString(16).padStart(64, 'a');
const ADDR = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';

async function setup(overrides = {}, deps = {}) {
  const config = {
    ...baseConfig, dbPath: ':memory:', adminUsername: 'admin', adminPassword: 'adminpass123', tradeFeeBps: 10,
    ...overrides,
  };
  const app = createApp(config, deps);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  function client() {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
    return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b) };
  }

  async function user(name) {
    const c = client();
    const r = await c.post('/auth/register', { username: name, password: 'password123' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return c;
  }

  const admin = client();
  assert.equal((await admin.post('/auth/login', { username: 'admin', password: 'adminpass123' })).status, 200);

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

  const balance = async (c) => (await c.get('/wallet')).data;
  const close = () => { server.close(); app.locals.close(); };
  return { app, config, base, admin, user, client, fund, account, balance, close };
}


module.exports = { setup, TXID, ADDR };
