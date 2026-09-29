'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const SUB = (n, lang = 'fa') => ({
  endpoint: `https://push.example.org/send/${'x'.repeat(20)}${n}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  lang,
});

function fakePush() {
  const sent = [];
  const gone = new Set();
  const push = async (sub, payload) => {
    if (gone.has(sub.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  };
  return { push, sent, gone };
}

async function tradeSetup(s) {
  const seller = await s.user('nseller');
  const buyer = await s.user('nbuyer');
  await s.fund(seller, '100', 301);
  await s.account(seller, 'cash');
  const offer = (await seller.post('/offers', { side: 'sell', price: '70', total: '100', minFiat: '70', maxFiat: '7000', paymentMethods: ['cash'] })).data;
  return { seller, buyer, offer };
}

test('notifications follow a trade: opened, paid, messages (one per chat), released', async (t) => {
  const s = await setup({}, { autoStartPush: false });
  t.after(s.close);
  const { seller, buyer, offer } = await tradeSetup(s);
  const deposit = (await seller.get('/notifications')).data.items.find((n) => n.kind === 'deposit_credited');
  assert.equal(deposit.data.amount, '100');
  assert.equal(deposit.url, '/wallet');

  const tr = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '20' })).data;
  let sn = (await seller.get('/notifications')).data;
  assert.equal(sn.items[0].kind, 'trade_opened');
  assert.equal(sn.items[0].url, `/trades/${tr.id}`);
  assert.equal(sn.unread, 2);

  await buyer.post(`/trades/${tr.id}/messages`, { body: 'salam' });
  await buyer.post(`/trades/${tr.id}/messages`, { body: 'are you there?' });
  sn = (await seller.get('/notifications')).data;
  assert.equal(sn.items.filter((n) => n.kind === 'trade_message').length, 1); // refreshed, not stacked
  assert.equal(sn.items[0].url, `/trades/${tr.id}/chat`);

  await buyer.post(`/trades/${tr.id}/pay`);
  assert.equal((await seller.get('/notifications')).data.items[0].kind, 'trade_paid');
  await seller.post(`/trades/${tr.id}/release`);
  const bn = (await buyer.get('/notifications')).data;
  assert.equal(bn.items[0].kind, 'trade_released');
  assert.equal(bn.items[0].data.amount, '19.98');

  assert.equal((await seller.get('/notifications/unread')).data.unread, 4);
  const first = (await seller.get('/notifications')).data.items[0];
  assert.equal((await seller.post('/notifications/read', { ids: [first.id] })).data.unread, 3);
  assert.equal((await seller.post('/notifications/read', { all: true })).data.unread, 0);
  // someone else's ids are ignored
  assert.equal((await buyer.post('/notifications/read', { ids: [first.id] })).data.unread, bn.unread);
});

test('web push outbox: sent once per device, localized, dead devices dropped', async (t) => {
  const fp = fakePush();
  const s = await setup({}, { push: fp.push, autoStartPush: false });
  t.after(s.close);
  const notifier = s.app.locals.services.notifier;
  const { seller, buyer, offer } = await tradeSetup(s);
  assert.equal((await seller.post('/push/subscribe', { endpoint: 'http://insecure', keys: {} })).data.error, 'invalid_subscription');
  assert.equal((await seller.post('/push/subscribe', SUB(1))).status, 201);
  assert.equal((await seller.post('/push/subscribe', SUB(2, 'en'))).status, 201);
  await notifier.flush(); // older events (deposit) go out now
  fp.sent.length = 0;

  const tr = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '10' })).data;
  // two workers at once (two instances) still send each notification once per device
  await Promise.all([notifier.flush(), notifier.flush()]);
  assert.equal(fp.sent.length, 2);
  const fa = fp.sent.find((p) => p.endpoint.endsWith('1'));
  const en = fp.sent.find((p) => p.endpoint.endsWith('2'));
  assert.equal(fa.title, 'معاملهٔ جدید');
  assert.equal(en.title, 'New trade');
  assert.match(en.body, /10\.00? USDT|10 USDT/);
  assert.equal(en.url, `/trades/${tr.id}`);
  await notifier.flush();
  assert.equal(fp.sent.length, 2); // nothing twice

  fp.gone.add(SUB(2).endpoint);
  await buyer.post(`/trades/${tr.id}/pay`);
  await notifier.flush();
  assert.equal(fp.sent.length, 3); // the living device only
  const left = await s.db.query('SELECT endpoint FROM push_subscriptions');
  assert.deepEqual(left.map((r) => r.endpoint), [SUB(1).endpoint]);
  assert.equal((await seller.post('/push/unsubscribe', { endpoint: SUB(1).endpoint })).status, 200);
  assert.equal((await s.db.one('SELECT COUNT(*) n FROM push_subscriptions')).n, 0);
});

test('ratings after a completed trade, shown on offers and the public profile', async (t) => {
  const s = await setup({}, { autoStartPush: false });
  t.after(s.close);
  const { seller, buyer, offer } = await tradeSetup(s);
  const tr = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '20' })).data;
  assert.equal((await buyer.post(`/trades/${tr.id}/rate`, { positive: true })).data.error, 'invalid_state');
  await buyer.post(`/trades/${tr.id}/pay`);
  await seller.post(`/trades/${tr.id}/release`);

  assert.equal((await buyer.get(`/trades/${tr.id}`)).data.myRating, false); // may rate now
  assert.equal((await buyer.post(`/trades/${tr.id}/rate`, { positive: 'yes' })).data.error, 'invalid_rating');
  const r = await buyer.post(`/trades/${tr.id}/rate`, { positive: true, comment: 'سریع و مطمئن' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.myRating, { positive: true, comment: 'سریع و مطمئن' });
  assert.equal((await buyer.post(`/trades/${tr.id}/rate`, { positive: false })).data.error, 'already_rated');
  assert.equal((await seller.post(`/trades/${tr.id}/rate`, { positive: true })).status, 200);
  const outsider = await s.user('noutsider');
  assert.equal((await outsider.post(`/trades/${tr.id}/rate`, { positive: false })).status, 403);

  const market = (await buyer.get('/offers?side=buy')).data;
  assert.deepEqual(market[0].maker.ratings, { up: 1, down: 0, positivePct: 100 });

  const p = (await s.client().get('/users/NSELLER')).data; // public, case-insensitive
  assert.equal(p.username, 'nseller');
  assert.equal(p.completed, 1);
  assert.equal(p.ratings.positivePct, 100);
  assert.equal(p.reviews[0].comment, 'سریع و مطمئن');
  assert.equal(p.reviews[0].from, 'buyer');
  assert.ok(p.medianReleaseMinutes >= 1);
  assert.equal(p.offers.length, 1);
  assert.equal(p.phone, undefined); // nothing private
  assert.equal((await s.client().get('/users/nobody_here')).status, 404);
  assert.equal((await s.client().get('/users/admin')).status, 404); // staff are not listed
});
