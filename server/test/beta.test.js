'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const baseConfig = require('../src/config');

const register = (s, username, inviteCode) => s.client().post('/auth/register', { username, password: 'password123', inviteCode });

test('invite-only sign-up: codes, usage limit, revocation, a failed sign-up keeps its slot', async (t) => {
  const s = await setup({ beta: { ...baseConfig.beta, inviteOnly: true } });
  t.after(s.close);
  assert.equal((await s.client().get('/config')).data.beta.inviteOnly, true);
  assert.equal((await register(s, 'noinvite')).data.error, 'invite_required');
  assert.equal((await register(s, 'badinvite', 'AAAA-BBBB')).data.error, 'invalid_invite');

  const inv = await s.admin.post('/admin/invites', { maxUses: 2, label: 'Kabul testers' });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  assert.match(inv.data.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const typed = inv.data.code.toLowerCase().replace('-', ' '); // as a user might type it

  assert.equal((await register(s, 'tester1', typed)).status, 201);
  assert.equal((await register(s, 'Tester1', inv.data.code)).data.error, 'username_taken'); // slot not used up
  assert.equal((await register(s, 'tester2', inv.data.code)).status, 201);
  assert.equal((await register(s, 'tester3', inv.data.code)).data.error, 'invalid_invite'); // full

  const list = (await s.admin.get('/admin/invites')).data;
  assert.equal(list[0].uses, 2);
  assert.equal(list[0].active, false);
  assert.equal(list[0].code, undefined); // never shown again
  assert.equal(list[0].hint, inv.data.code.slice(-4));

  const inv2 = (await s.admin.post('/admin/invites', { maxUses: 5 })).data;
  assert.equal((await s.admin.post(`/admin/invites/${inv2.id}/revoke`)).status, 200);
  assert.equal((await register(s, 'tester4', inv2.code)).data.error, 'invalid_invite');

  // one slot, three people at once → one account
  const inv3 = (await s.admin.post('/admin/invites', { maxUses: 1 })).data;
  const rs = await Promise.all(['racer1', 'racer2', 'racer3'].map((n) => register(s, n, inv3.code)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 400, 400]);

  const log = (await s.admin.get('/admin/actions')).data.map((a) => a.action);
  assert.ok(log.includes('invite_create') && log.includes('invite_revoke'));
  const plain = await s.user('plainuser', { verified: false }).catch((e) => e);
  assert.ok(plain instanceof Error); // the normal helper cannot sign up without a code
});

test('beta caps per offer and per trade', async (t) => {
  const s = await setup({ beta: { ...baseConfig.beta, maxTradeMicro: 10_000_000, maxOfferMicro: 50_000_000 } });
  t.after(s.close);
  const cfg = (await s.client().get('/config')).data.beta;
  assert.deepEqual(cfg, { inviteOnly: false, maxTrade: '10', maxOffer: '50', label: null });
  const seller = await s.user('capseller');
  const buyer = await s.user('capbuyer');
  await s.fund(seller, '100', 201);
  await s.account(seller, 'cash');
  const offer = (total) => seller.post('/offers', { side: 'sell', price: '70', total, minFiat: '70', maxFiat: '7000', paymentMethods: ['cash'] });
  const big = await offer('60');
  assert.equal(big.status, 400);
  assert.deepEqual(big.data, { error: 'beta_offer_limit', max: '50' });
  const o = await offer('50');
  assert.equal(o.status, 201);
  const tooMuch = await buyer.post(`/offers/${o.data.id}/trades`, { amount: '11' });
  assert.deepEqual(tooMuch.data, { error: 'beta_trade_limit', max: '10' });
  assert.equal((await buyer.post(`/offers/${o.data.id}/trades`, { amount: '10' })).status, 201);
});

test('feedback: tester sends, staff replies, tester sees the reply', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('feedbacker', { verified: false });
  assert.equal((await c.post('/feedback', { kind: 'nope', message: 'hello there' })).data.error, 'invalid_feedback');
  assert.equal((await c.post('/feedback', { kind: 'bug', message: 'hi' })).data.error, 'invalid_feedback');
  const f = await c.post('/feedback', { kind: 'bug', message: 'دکمهٔ پرداخت کردم کار نمی‌کند', page: '/trades/5' });
  assert.equal(f.status, 201, JSON.stringify(f.data));
  assert.equal(f.data.status, 'new');

  assert.equal((await c.get('/admin/feedback')).status, 403);
  const list = (await s.admin.get('/admin/feedback?status=new')).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].username, 'feedbacker');
  assert.equal(list[0].page, '/trades/5');
  assert.equal((await s.admin.get('/admin/overview')).data.newFeedback, 1);

  const r = await s.admin.post(`/admin/feedback/${f.data.id}`, { status: 'done', reply: 'درست شد، ممنون!' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const mine = (await c.get('/feedback')).data;
  assert.equal(mine[0].status, 'done');
  assert.equal(mine[0].reply, 'درست شد، ممنون!');
  assert.equal(mine[0].username, undefined); // the user view carries no staff fields
  assert.ok((await s.admin.get('/admin/actions')).data.some((a) => a.action === 'feedback_reply'));
});

test('error reports are grouped, counted, resolved and reopened', async (t) => {
  const s = await setup();
  t.after(s.close);
  const anon = s.client();
  const e = { message: 'TypeError: x is undefined (line 12)', stack: 'TypeError\n    at Trade (index-abc.js:1:200)', page: '/trades/9' };
  assert.equal((await anon.post('/client-errors', e)).status, 204);
  assert.equal((await anon.post('/client-errors', { ...e, message: 'TypeError: x is undefined (line 13)' })).status, 204); // numbers ignored
  await anon.post('/client-errors', { message: 'Other failure' });
  let errs = (await s.admin.get('/admin/errors')).data;
  assert.equal(errs.length, 2);
  const te = errs.find((x) => x.message.startsWith('TypeError'));
  assert.equal(te.count, 2);
  assert.equal(te.source, 'web');
  assert.equal((await s.admin.post(`/admin/errors/${te.id}/resolve`)).status, 200);
  assert.equal((await s.admin.get('/admin/errors')).data.length, 1);
  await anon.post('/client-errors', e); // it came back
  errs = (await s.admin.get('/admin/errors')).data;
  assert.equal(errs.find((x) => x.id === te.id).count, 3);
});

test('beta metrics', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('mseller');
  const buyer = await s.user('mbuyer');
  await s.fund(seller, '50', 202);
  await s.account(seller, 'cash');
  const o = (await seller.post('/offers', { side: 'sell', price: '70', total: '50', minFiat: '70', maxFiat: '7000', paymentMethods: ['cash'] })).data;
  const tr = (await buyer.post(`/offers/${o.id}/trades`, { amount: '20' })).data;
  await buyer.post(`/trades/${tr.id}/pay`);
  await seller.post(`/trades/${tr.id}/release`);
  const tr2 = (await buyer.post(`/offers/${o.id}/trades`, { amount: '5' })).data;
  await buyer.post(`/trades/${tr2.id}/cancel`);

  const st = (await s.admin.get('/admin/beta')).data;
  assert.equal(st.users.total, 2);
  assert.equal(st.users.phoneVerified, 2);
  assert.equal(st.users.activeTraders7d, 2);
  assert.equal(st.trades.completed, 1);
  assert.equal(st.trades.cancelled, 1);
  assert.equal(st.trades.completionRate, 50);
  assert.equal(st.trades.volume, '20');
  assert.equal(st.trades.fiat, '1400');
  assert.equal(st.trades.medianMinutes, 0);
  assert.equal(st.daily.length, 14);
  assert.equal(st.daily.at(-1).completed, 1);
  assert.equal(st.daily.at(-1).signups, 2);
  assert.equal((await buyer.get('/admin/beta')).status, 403);
});

test('every table has row level security and no policies', async (t) => {
  const s = await setup();
  t.after(s.close);
  const rows = await s.db.query(
    `SELECT c.relname, c.relrowsecurity,
            (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname = 'app' AND p.tablename = c.relname) policies
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r'`
  );
  assert.ok(rows.length >= 23);
  assert.deepEqual(rows.filter((r) => !r.relrowsecurity || r.policies > 0).map((r) => r.relname), []);
});

test('an unexpected server error is recorded with its route, and the client only sees server_error', async (t) => {
  const s = await setup({}, { log: { log() {}, info() {}, warn() {}, error() {} } });
  t.after(s.close);
  const query = s.db.query;
  s.db.query = async () => { throw new Error('boom 42'); };
  const r = await s.client().get('/offers');
  s.db.query = query;
  assert.equal(r.status, 500);
  assert.deepEqual(r.data, { error: 'server_error' });
  await new Promise((res) => setTimeout(res, 50));
  const errs = (await s.admin.get('/admin/errors')).data;
  assert.equal(errs.length, 1);
  assert.equal(errs[0].source, 'server');
  assert.equal(errs[0].message, 'boom 42');
  assert.equal(errs[0].page, 'GET /api/offers');
});
