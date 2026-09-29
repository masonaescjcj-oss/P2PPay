'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, TXID, ADDR } = require('./helpers');

test('sell offer: buyer pays, seller releases, fee and escrow are correct', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('seller1');
  const buyer = await s.user('buyer1');
  await s.fund(seller, '100', 1);
  const noAcct = await seller.post('/offers', {
    side: 'sell', price: '71.5', total: '50', minFiat: '500', maxFiat: '10000', paymentMethods: ['hesabpay', 'hawala'],
  });
  assert.equal(noAcct.data.error, 'missing_payment_account');
  await s.account(seller, 'hesabpay');
  await s.account(seller, 'hawala');

  const offer = await seller.post('/offers', {
    side: 'sell', price: '71.5', total: '50', minFiat: '500', maxFiat: '10000', paymentMethods: ['hesabpay', 'hawala'],
  });
  assert.equal(offer.status, 201, JSON.stringify(offer.data));
  let w = await s.balance(seller);
  assert.equal(w.available, '50');
  assert.equal(w.locked, '50');

  assert.equal((await buyer.get('/offers?side=buy')).data.length, 1);
  assert.equal((await buyer.get('/offers?side=sell')).data.length, 0);

  assert.equal((await seller.post(`/offers/${offer.data.id}/trades`, { amount: '10' })).data.error, 'own_offer');
  assert.equal((await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '1' })).data.error, 'outside_limits');
  assert.equal(
    (await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '10', paymentMethod: 'cash' })).data.error,
    'invalid_payment_method'
  );

  const trade = await buyer.post(`/offers/${offer.data.id}/trades`, { fiat: '1430', paymentMethod: 'hawala' });
  assert.equal(trade.status, 201, JSON.stringify(trade.data));
  assert.equal(trade.data.amount, '20');
  assert.equal(trade.data.fiat, '1430');
  assert.equal(trade.data.role, 'buyer');
  assert.deepEqual(trade.data.paymentAccount, { holderName: 'Test Holder', account: '0700-hawala' });
  assert.equal((await seller.get(`/offers/${offer.data.id}`)).data.remaining, '30');

  assert.equal((await seller.post(`/trades/${trade.data.id}/pay`)).status, 403);
  assert.equal((await buyer.post(`/trades/${trade.data.id}/release`)).status, 403);

  await buyer.post(`/trades/${trade.data.id}/messages`, { body: 'پول را فرستادم' });
  assert.equal((await buyer.post(`/trades/${trade.data.id}/pay`)).data.status, 'paid');
  assert.equal((await seller.post(`/trades/${trade.data.id}/release`)).data.status, 'completed');

  w = await s.balance(buyer);
  assert.equal(w.available, '19.98');
  w = await s.balance(seller);
  assert.equal(w.available, '50');
  assert.equal(w.locked, '30');

  const msgs = (await seller.get(`/trades/${trade.data.id}/messages`)).data;
  assert.ok(msgs.some((m) => m.body === 'پول را فرستادم'));
  assert.ok(msgs.some((m) => m.userId === null && m.body === 'trade_released'));

  const other = await s.user('other1');
  assert.equal((await other.get(`/trades/${trade.data.id}`)).status, 403);
  assert.equal((await other.get(`/trades/${trade.data.id}/messages`)).status, 403);

  await seller.post(`/offers/${offer.data.id}/status`, { status: 'closed' });
  w = await s.balance(seller);
  assert.equal(w.available, '80');
  assert.equal(w.locked, '0');

  const ov = (await s.admin.get('/admin/overview')).data;
  assert.equal(ov.fees, '0.02');
  assert.equal(ov.userBalances, '99.98');
});

test('buy offer: taker sells, buyer cancels, funds are refunded', async (t) => {
  const s = await setup();
  t.after(s.close);
  const maker = await s.user('maker2');
  const taker = await s.user('taker2');
  await s.fund(taker, '40', 2);

  const offer = await maker.post('/offers', {
    side: 'buy', price: '70', total: '100', minFiat: '100', maxFiat: '7000', paymentMethods: ['mpaisa'],
  });
  assert.equal(offer.status, 201);
  assert.equal((await s.balance(maker)).locked, '0');

  assert.equal((await taker.post(`/offers/${offer.data.id}/trades`, { amount: '30' })).data.error, 'missing_payment_account');
  await s.account(taker, 'mpaisa');
  assert.equal((await taker.post(`/offers/${offer.data.id}/trades`, { amount: '50' })).data.error, 'insufficient_balance');
  const trade = await taker.post(`/offers/${offer.data.id}/trades`, { amount: '30' });
  assert.equal(trade.status, 201, JSON.stringify(trade.data));
  assert.equal(trade.data.role, 'seller');
  let w = await s.balance(taker);
  assert.equal(w.available, '10');
  assert.equal(w.locked, '30');

  assert.equal((await taker.post(`/trades/${trade.data.id}/cancel`)).status, 403);
  assert.equal((await maker.post(`/trades/${trade.data.id}/cancel`)).data.status, 'cancelled');
  w = await s.balance(taker);
  assert.equal(w.available, '40');
  assert.equal(w.locked, '0');
  assert.equal((await maker.get(`/offers/${offer.data.id}`)).data.remaining, '100');
});

test('cancel after the sell offer was closed returns funds to the seller balance', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('seller7');
  const buyer = await s.user('buyer7');
  await s.fund(seller, '10', 7);
  await s.account(seller, 'bank');
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['bank'],
  });
  const trade = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '4' });
  await seller.post(`/offers/${offer.data.id}/status`, { status: 'closed' });
  let w = await s.balance(seller);
  assert.equal(w.available, '6');
  assert.equal(w.locked, '4');
  await buyer.post(`/trades/${trade.data.id}/cancel`);
  w = await s.balance(seller);
  assert.equal(w.available, '10');
  assert.equal(w.locked, '0');
});

test('dispute resolved by admin for buyer and for seller', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('seller3');
  const buyer = await s.user('buyer3');
  await s.fund(seller, '20', 3);
  await s.account(seller, 'bank');
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '20', minFiat: '70', maxFiat: '700', paymentMethods: ['bank'],
  });

  const t1 = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '10' });
  assert.equal((await buyer.post(`/trades/${t1.data.id}/dispute`, { reason: 'x' })).data.error, 'invalid_state');
  await buyer.post(`/trades/${t1.data.id}/pay`);
  assert.equal((await buyer.post(`/trades/${t1.data.id}/dispute`, {})).data.error, 'reason_required');
  assert.equal((await buyer.post(`/trades/${t1.data.id}/dispute`, { reason: 'Seller not responding' })).data.status, 'disputed');
  assert.equal((await seller.post(`/trades/${t1.data.id}/release`)).data.error, 'invalid_state');
  assert.equal((await buyer.post(`/admin/trades/${t1.data.id}/resolve`, { winner: 'buyer' })).status, 403);
  const r1 = await s.admin.post(`/admin/trades/${t1.data.id}/resolve`, { winner: 'buyer', note: 'receipt ok' });
  assert.equal(r1.data.status, 'completed');
  assert.equal((await s.balance(buyer)).available, '9.99');

  const t2 = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '10' });
  await buyer.post(`/trades/${t2.data.id}/pay`);
  await seller.post(`/trades/${t2.data.id}/dispute`, { reason: 'No money received' });
  const r2 = await s.admin.post(`/admin/trades/${t2.data.id}/resolve`, { winner: 'seller' });
  assert.equal(r2.data.status, 'cancelled');
  assert.equal((await seller.get(`/offers/${offer.data.id}`)).data.remaining, '10');
  assert.equal((await s.admin.get('/admin/trades?status=disputed')).data.length, 0);
});

test('expired trade is cancelled and funds return to the offer', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('seller4');
  const buyer = await s.user('buyer4');
  await s.fund(seller, '10', 4);
  await s.account(seller, 'cash');
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['cash'],
  });
  const trade = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '5' });
  await s.db.run('UPDATE trades SET expires_at = 0 WHERE id = ?', [trade.data.id]);
  const tr = (await buyer.get(`/trades/${trade.data.id}`)).data;
  assert.equal(tr.status, 'cancelled');
  assert.equal(tr.resolution, 'expired');
  assert.equal((await buyer.post(`/trades/${trade.data.id}/pay`)).data.error, 'invalid_state');
  assert.equal((await seller.get(`/offers/${offer.data.id}`)).data.remaining, '10');
});

test('open trade limit per taker', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('seller8');
  const buyer = await s.user('buyer8');
  await s.fund(seller, '100', 8);
  await s.account(seller, 'cash');
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '100', minFiat: '70', maxFiat: '7000', paymentMethods: ['cash'],
  });
  for (let i = 0; i < 5; i++) {
    assert.equal((await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '1' })).status, 201);
  }
  assert.equal((await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '1' })).data.error, 'too_many_open_trades');
});

test('withdrawal: lock, reject refunds, approve burns', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('wd5');
  await s.fund(c, '20', 5);
  assert.equal((await s.withdraw(c, { amount: '10', address: 'bad' })).data.error, 'invalid_address');
  assert.equal((await s.withdraw(c, { amount: '1', address: ADDR })).data.error, 'below_minimum');
  assert.equal((await s.withdraw(c, { amount: '20', address: ADDR })).data.error, 'insufficient_balance');

  const w1 = await s.withdraw(c, { amount: '10', address: ADDR });
  assert.equal(w1.status, 201);
  let b = await s.balance(c);
  assert.equal(b.available, '9');
  assert.equal(b.locked, '11');
  await s.admin.post(`/admin/withdrawals/${w1.data.id}/reject`, { note: 'test' });
  assert.equal((await s.balance(c)).available, '20');
  assert.equal((await s.admin.post(`/admin/withdrawals/${w1.data.id}/reject`, {})).data.error, 'already_reviewed');

  const w2 = await s.withdraw(c, { amount: '10', address: ADDR });
  assert.equal((await s.admin.post(`/admin/withdrawals/${w2.data.id}/approve`, {})).data.error, 'invalid_txid');
  await s.admin.post(`/admin/withdrawals/${w2.data.id}/approve`, { txid: TXID(99) });
  b = await s.balance(c);
  assert.equal(b.available, '9');
  assert.equal(b.locked, '0');
  assert.equal(b.withdrawals[0].status, 'sent');
});

test('auth, admin guard and input validation', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = s.client();
  assert.equal((await c.get('/wallet')).status, 401);
  assert.equal((await c.post('/auth/register', { username: 'ab', password: 'password123' })).data.error, 'invalid_username');
  assert.equal((await c.post('/auth/register', { username: 'abc', password: 'short' })).data.error, 'weak_password');
  await s.user('dup6');
  assert.equal((await c.post('/auth/register', { username: 'DUP6', password: 'password123' })).data.error, 'username_taken');
  assert.equal((await c.post('/auth/login', { username: 'dup6', password: 'wrongpass' })).status, 401);
  assert.equal((await c.post('/auth/login', { username: 'dup6', password: 'password123' })).status, 200);
  assert.equal((await c.get('/me')).data.username, 'dup6');
  await c.post('/auth/logout');
  assert.equal((await c.get('/me')).status, 401);
  assert.equal((await c.get('/admin/overview')).status, 401);

  const u = await s.user('user6');
  assert.equal((await u.get('/admin/overview')).status, 403);
  const d = await u.post('/deposits', { amount: '۱۲٫۵', txid: TXID(6) });
  assert.equal(d.data.amount, '12.5');
  assert.equal((await u.post('/deposits', { amount: '1', txid: TXID(6) })).data.error, 'duplicate_txid');
  assert.equal((await u.post('/deposits', { amount: '1', txid: 'nope' })).data.error, 'invalid_txid');
  assert.equal((await u.post('/payment-accounts', { method: 'paypal', holderName: 'x', account: '1' })).data.error, 'invalid_payment_method');
  assert.equal((await u.post('/payment-accounts', { method: 'hesabpay', holderName: '', account: '1' })).data.error, 'invalid_payment_account');
  await s.account(u, 'hesabpay');
  await u.post('/payment-accounts', { method: 'hesabpay', holderName: 'New Name', account: '0799' });
  const accts = (await u.get('/payment-accounts')).data;
  assert.equal(accts.length, 1);
  assert.equal(accts[0].holderName, 'New Name');
  assert.equal((await u.post('/offers', {
    side: 'sell', price: '70', total: '5', minFiat: '70', maxFiat: '350', paymentMethods: ['hesabpay'],
  })).data.error, 'insufficient_balance');
  assert.equal((await u.post(`/payment-accounts/${accts[0].id}/delete`)).data.ok, true);
  assert.equal((await u.get('/payment-accounts')).data.length, 0);
  assert.equal((await u.post('/offers', {
    side: 'sell', price: '70', total: '5', minFiat: '70', maxFiat: '350', paymentMethods: ['paypal'],
  })).data.error, 'invalid_payment_methods');

  // blocked users lose their session and cannot log in
  const uid = (await u.get('/me')).data.id;
  await s.admin.post(`/admin/users/${uid}/block`, { blocked: true });
  assert.equal((await u.get('/me')).status, 401);
  assert.equal((await u.post('/auth/login', { username: 'user6', password: 'password123' })).data.error, 'account_blocked');
});

test('state-changing requests require JSON (CSRF guard)', async (t) => {
  const s = await setup();
  t.after(s.close);
  const res = await fetch(`${s.base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=adminpass123',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'json_required');
});

test('admin: audit log, self-review guards, user search, admin chat', async (t) => {
  const s = await setup();
  t.after(s.close);
  const seller = await s.user('sellerA');
  const buyer = await s.user('buyerA');
  await s.fund(seller, '10', 20);
  await s.account(seller, 'bank');

  // every decision lands in the audit log with the admin and note
  const d = await seller.post('/deposits', { amount: '3', txid: TXID(21) });
  await s.admin.post(`/admin/deposits/${d.data.id}/reject`, { note: 'not on chain' });
  let log = (await s.admin.get('/admin/actions')).data;
  assert.equal(log[0].action, 'deposit_reject');
  assert.equal(log[0].admin, 'admin');
  assert.equal(log[0].note, 'not on chain');
  assert.equal(log[1].action, 'deposit_approve');

  // a failed decision is rolled back together with its log entry
  const before = log.length;
  assert.equal((await s.admin.post(`/admin/deposits/${d.data.id}/approve`, {})).data.error, 'already_reviewed');
  assert.equal((await s.admin.get('/admin/actions')).data.length, before);

  // admin cannot review their own deposit
  const own = await s.admin.post('/deposits', { amount: '1', txid: TXID(22) });
  assert.equal((await s.admin.post(`/admin/deposits/${own.data.id}/approve`, {})).data.error, 'own_request');

  // admin sees the dispute, posts in chat, and resolves it
  const offer = await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['bank'],
  });
  const tr = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '5' });
  await buyer.post(`/trades/${tr.data.id}/pay`);
  await buyer.post(`/trades/${tr.data.id}/dispute`, { reason: 'no release' });
  assert.equal((await s.admin.get(`/trades/${tr.data.id}`)).data.status, 'disputed');
  assert.equal((await s.admin.post(`/trades/${tr.data.id}/messages`, { body: 'Please upload the receipt' })).status, 201);
  const msgs = (await buyer.get(`/trades/${tr.data.id}/messages`)).data;
  assert.ok(msgs.some((m) => m.fromAdmin && m.body === 'Please upload the receipt'));
  await s.admin.post(`/admin/trades/${tr.data.id}/resolve`, { winner: 'buyer', note: 'bank statement ok' });
  log = (await s.admin.get('/admin/actions')).data;
  assert.equal(log[0].action, 'resolve_buyer');
  assert.equal(log[0].targetId, tr.data.id);

  // search and block
  const found = (await s.admin.get('/admin/users?q=buyerA')).data;
  assert.equal(found.length, 1);
  assert.equal(found[0].completed, 1);
  assert.equal((await s.admin.get('/admin/users?q=%25')).data.length, 0);
  const me = (await s.admin.get('/me')).data;
  assert.equal((await s.admin.post(`/admin/users/${me.id}/block`, { blocked: true })).data.error, 'cannot_block_self');
  await s.admin.post(`/admin/users/${found[0].id}/block`, { blocked: true });
  assert.equal((await s.admin.get('/admin/actions')).data[0].action, 'user_block');
  assert.equal((await buyer.get('/me')).status, 401);
});
