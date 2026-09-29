'use strict';

// Parallel requests against the same rows. On PGlite (default) statements interleave but transactions
// are serialized; with TEST_DATABASE_URL these run against a real PostgreSQL with true concurrency.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, ADDR } = require('./helpers');
const { createWallet } = require('../src/wallet');
const totp = require('../src/security/totp');

const statuses = (rs) => rs.map((r) => r.status).sort();

test('parallel trades on one offer never oversell it', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('race_seller');
  await s.fund(seller, '10', 101);
  await s.account(seller, 'cash');
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '7000', paymentMethods: ['cash'],
  });
  assert.equal(offer.status, 201, JSON.stringify(offer.data));
  const buyers = [];
  for (let i = 0; i < 6; i++) buyers.push(await s.user(`race_buyer${i}`));

  const rs = await Promise.all(buyers.map((b) => b.post(`/offers/${offer.data.id}/trades`, { amount: '2' })));
  assert.equal(rs.filter((r) => r.status === 201).length, 5, JSON.stringify(rs.map((r) => r.data)));
  assert.equal((await seller.get(`/offers/${offer.data.id}`)).data.remaining, '0');
  const w = await s.balance(seller);
  assert.equal(w.available, '0');
  assert.equal(w.locked, '10');
});

test('release and cancel racing on one trade: exactly one wins, no money is created', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('rel_seller');
  const buyer = await s.user('rel_buyer');
  await s.fund(seller, '20', 102);
  await s.account(seller, 'cash');
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '20', minFiat: '70', maxFiat: '7000', paymentMethods: ['cash'],
  });
  const trade = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '10' });
  assert.equal((await buyer.post(`/trades/${trade.data.id}/pay`)).data.status, 'paid');

  const [rel, can] = await Promise.all([
    seller.post(`/trades/${trade.data.id}/release`),
    buyer.post(`/trades/${trade.data.id}/cancel`),
  ]);
  assert.equal([rel, can].filter((r) => r.status === 200).length, 1, JSON.stringify([rel.data, can.data]));
  const ov = (await s.admin.get('/admin/overview')).data;
  assert.equal(Number(ov.userBalances) + Number(ov.fees), 20);
});

test('the same username registered in parallel: one account', async (t) => {
  const s = await setup();
  t.after(s.close);
  const rs = await Promise.all(
    ['Twin_Name', 'twin_name', 'TWIN_NAME', 'twin_Name'].map((username) =>
      s.client().post('/auth/register', { username, password: 'password123', acceptTerms: true }))
  );
  assert.deepEqual(statuses(rs), [201, 409, 409, 409]);
});

test('parallel balance locks cannot overdraw', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('race_wallet', { verified: false });
  const me = (await c.get('/me')).data;
  const wallet = createWallet(s.db);
  await wallet.credit(me.id, 10_000_000, 'test');
  const rs = await Promise.allSettled(Array.from({ length: 10 }, () => wallet.lock(me.id, 3_000_000, 'test')));
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 3);
  assert.ok(rs.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'insufficient_balance'));
  assert.deepEqual(await wallet.balance(me.id), { available: 1_000_000, locked: 9_000_000 });
});

test('one authenticator code used for parallel withdrawals is accepted once', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('race_wd');
  await s.fund(c, '100', 103);
  const secret = await s.enableTotp(c);
  const code = totp.totp(secret, Date.now() + 30_000); // next step: newer than the one used to enable
  const rs = await Promise.all(Array.from({ length: 4 }, () => c.post('/withdrawals', { amount: '10', address: ADDR, code })));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(rs.map((r) => r.data)));
  assert.equal((await s.balance(c)).locked, '11');
});

test('parallel SMS code guesses are capped at the attempt limit', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('race_otp', { verified: false });
  const phone = '+93700009999';
  assert.equal((await c.post('/me/phone', { phone })).status, 200);
  const real = s.sms.last(phone);
  const wrong = real === '000000' ? '111111' : '000000';
  const rs = await Promise.all(Array.from({ length: 8 }, () => c.post('/me/phone/verify', { code: wrong })));
  assert.equal(rs.filter((r) => r.data.error === 'invalid_code').length, 5);
  assert.equal(rs.filter((r) => r.data.error === 'code_expired').length, 3);
  // The budget is spent: even the right code no longer works.
  assert.equal((await c.post('/me/phone/verify', { code: real })).data.error, 'code_expired');
});
