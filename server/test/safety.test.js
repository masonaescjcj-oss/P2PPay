'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const baseConfig = require('../src/config');

const DAY = 86_400_000;
const SAFETY = { ...baseConfig.safety, requireAcceptByDefault: true, newAccountMaxMicro: 50_000_000, revealCancelLimit: 3 };
const idOf = async (s, username) => (await s.db.one('SELECT id FROM users WHERE username = ?', [username])).id;
// Makes an account look older so the new-account limit does not apply.
const age = (s, username, days) => s.db.run('UPDATE users SET created_at = ? WHERE username = ?', [Date.now() - days * DAY, username]);

async function market(s, offerBody = {}) {
  const seller = await s.user('sseller');
  await s.fund(seller, '600', 501);
  await s.account(seller, 'cash');
  const r = await seller.post('/offers', {
    side: 'sell', price: '70', total: '500', minFiat: '70', maxFiat: '35000', paymentMethods: ['cash'], ...offerBody,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { seller, offer: r.data };
}

test('seller approval: account hidden until accepted, payment timer starts on accept, hidden again after close', async (t) => {
  const s = await setup({ safety: SAFETY });
  t.after(s.close);
  const { seller, offer } = await market(s);
  assert.equal(offer.requirements.requireAccept, true); // on by default for sell offers
  const buyer = await s.user('sbuyer');

  const tr = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '10' })).data;
  assert.equal(tr.awaitingAccept, true);
  assert.equal(tr.paymentAccount, null);
  assert.ok(tr.expiresAt - Date.now() <= 10 * 60_000 + 1000); // accept window, not the payment window
  assert.equal((await buyer.post(`/trades/${tr.id}/pay`)).data.error, 'awaiting_acceptance');
  assert.equal((await buyer.post(`/trades/${tr.id}/accept`)).status, 403);
  assert.equal((await seller.post(`/trades/${tr.id}/release`)).data.error, 'awaiting_acceptance');

  // The seller sees who is asking, and gets a request notification.
  const sv = (await seller.get(`/trades/${tr.id}`)).data;
  assert.equal(sv.counterparty.username, 'sbuyer');
  assert.equal(sv.counterparty.completed, 0);
  assert.equal(sv.counterparty.idVerified, false);
  assert.equal((await seller.get('/notifications')).data.items[0].kind, 'trade_request');

  const acc = await seller.post(`/trades/${tr.id}/accept`);
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal((await seller.post(`/trades/${tr.id}/accept`)).data.error, 'invalid_state');
  const bv = (await buyer.get(`/trades/${tr.id}`)).data;
  assert.equal(bv.awaitingAccept, false);
  assert.equal(bv.paymentAccount.account, '0700-cash');
  assert.ok(bv.expiresAt - Date.now() > 20 * 60_000); // full payment window from now
  assert.equal((await buyer.get('/notifications')).data.items[0].kind, 'trade_accepted');

  await buyer.post(`/trades/${tr.id}/pay`);
  assert.equal((await buyer.get(`/trades/${tr.id}`)).data.paymentAccount.account, '0700-cash');
  await seller.post(`/trades/${tr.id}/release`);
  assert.equal((await buyer.get(`/trades/${tr.id}`)).data.paymentAccount, null); // gone once done
  assert.equal((await seller.get(`/trades/${tr.id}`)).data.paymentAccount.account, '0700-cash');

  // Decline: USDT goes back to the offer, the buyer is told.
  const t2 = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '5' })).data;
  assert.equal((await buyer.post(`/trades/${t2.id}/decline`)).status, 403);
  const d = (await seller.post(`/trades/${t2.id}/decline`)).data;
  assert.equal(d.status, 'cancelled');
  assert.equal(d.resolution, 'declined_by_seller');
  assert.equal((await buyer.get('/notifications')).data.items[0].kind, 'trade_declined');
  assert.equal((await seller.get(`/offers/${offer.id}`)).data.remaining, '490');

  // Without approval the account is visible at once (the old behaviour).
  const quick = (await seller.post('/offers', {
    side: 'sell', price: '71', total: '10', minFiat: '71', maxFiat: '710', paymentMethods: ['cash'], requireAccept: false,
  })).data;
  const t3 = (await buyer.post(`/offers/${quick.id}/trades`, { amount: '1' })).data;
  assert.equal(t3.awaitingAccept, false);
  assert.equal(t3.paymentAccount.account, '0700-cash');
  await buyer.post(`/trades/${t3.id}/cancel`);
  assert.equal((await buyer.get(`/trades/${t3.id}`)).data.paymentAccount, null);
});

test('an unanswered request expires without counting against the buyer', async (t) => {
  const s = await setup({ safety: SAFETY });
  t.after(s.close);
  const { offer } = await market(s);
  const buyer = await s.user('sbuyer');
  for (let i = 0; i < 4; i++) {
    const tr = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).data;
    await s.db.run('UPDATE trades SET expires_at = ? WHERE id = ?', [Date.now() - 1, tr.id]);
    assert.equal((await buyer.get(`/trades/${tr.id}`)).data.resolution, 'not_accepted');
  }
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).status, 201); // not frozen
});

test('offer requirements: completed trades, account age, verified ID', async (t) => {
  const s = await setup({ safety: SAFETY });
  t.after(s.close);
  const { seller } = await market(s);
  const r0 = await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['cash'], minTrades: -1,
  });
  assert.equal(r0.data.error, 'invalid_requirements');
  const offer = (await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['cash'],
    minTrades: 1, minAccountDays: 30, requireId: true,
  })).data;
  assert.deepEqual(offer.requirements, { requireAccept: true, minTrades: 1, minAccountDays: 30, requireId: true });

  const buyer = await s.user('sbuyer');
  const r = await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'requirements_not_met');
  assert.equal(r.data.minAccountDays, 30);

  // Meet all three: an older account, one completed trade, ID verified.
  await age(s, 'sbuyer', 40);
  const easy = (await seller.post('/offers', {
    side: 'sell', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['cash'], requireAccept: false,
  })).data;
  const first = (await buyer.post(`/offers/${easy.id}/trades`, { amount: '1' })).data;
  await buyer.post(`/trades/${first.id}/pay`);
  await seller.post(`/trades/${first.id}/release`);
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).data.error, 'requirements_not_met');
  await s.admin.post(`/admin/users/${await idOf(s, 'sbuyer')}/tier`, { tier: 2 });
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).status, 201);
});

test('new accounts are limited to small trades', async (t) => {
  const s = await setup({ safety: SAFETY });
  t.after(s.close);
  const { offer } = await market(s);
  const buyer = await s.user('sbuyer');
  const r = await buyer.post(`/offers/${offer.id}/trades`, { amount: '60' });
  assert.equal(r.data.error, 'new_account_limit');
  assert.equal(r.data.max, '50');
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '50' })).status, 201);
  await age(s, 'sbuyer', 8);
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '60' })).status, 201);
});

test('repeated cancels after seeing the account pause trading and alert staff; admin can lift it', async (t) => {
  const s = await setup({ safety: SAFETY });
  t.after(s.close);
  const { seller, offer } = await market(s);
  const buyer = await s.user('sbuyer');
  for (let i = 0; i < 3; i++) {
    const tr = (await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).data;
    await seller.post(`/trades/${tr.id}/accept`);
    if (i === 2) {
      await s.db.run('UPDATE trades SET expires_at = ? WHERE id = ?', [Date.now() - 1, tr.id]); // letting it expire counts too
      await s.app.locals.services.market.expireTrades();
    } else {
      assert.equal((await buyer.post(`/trades/${tr.id}/cancel`)).status, 200);
    }
  }
  const r = await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, 'trading_paused');
  assert.ok(r.data.until > Date.now() + 6 * DAY);
  assert.equal((await buyer.post('/offers', {
    side: 'buy', price: '70', total: '10', minFiat: '70', maxFiat: '700', paymentMethods: ['cash'],
  })).data.error, 'trading_paused');

  const alert = (await s.admin.get('/admin/alerts')).data.find((a) => a.rule === 'reveal_abuse');
  assert.equal(alert.severity, 'high');
  const uid = await idOf(s, 'sbuyer');
  const view = (await s.admin.get('/admin/users?q=sbuyer')).data[0];
  assert.ok(view.tradeFrozenUntil > Date.now());
  assert.equal((await s.admin.post(`/admin/users/${uid}/unfreeze`, {})).status, 200);
  assert.equal((await s.admin.get('/admin/users?q=sbuyer')).data[0].tradeFrozenUntil, null);
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).status, 201);
});

test('blocking hides offers both ways and stops new trades', async (t) => {
  const s = await setup({ safety: SAFETY });
  t.after(s.close);
  const { seller, offer } = await market(s);
  const buyer = await s.user('sbuyer');
  const ids = async (c) => (await c.get('/offers?side=buy')).data.map((o) => o.id);
  assert.ok((await ids(buyer)).includes(offer.id));

  assert.equal((await seller.post('/users/sseller/block')).data.error, 'cannot_block_self');
  assert.equal((await seller.post('/users/nobody/block')).status, 404);
  assert.equal((await seller.post('/users/sbuyer/block')).status, 200);
  assert.equal((await seller.post('/users/sbuyer/block')).status, 200); // idempotent
  assert.deepEqual((await seller.get('/me/blocks')).data.map((b) => b.username), ['sbuyer']);

  assert.ok(!(await ids(buyer)).includes(offer.id)); // the blocked side no longer sees the offer
  assert.ok((await ids(s.client())).includes(offer.id)); // everyone else still does
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).data.error, 'offer_unavailable');
  assert.deepEqual((await buyer.get('/users/sseller')).data.offers, []);
  assert.equal((await seller.get('/users/sbuyer')).data.blockedByMe, true);

  // The blocker does not see the blocked user's offers either.
  await s.fund(buyer, '20', 502);
  await s.account(buyer, 'cash');
  const bo = (await buyer.post('/offers', { side: 'sell', price: '69', total: '20', minFiat: '69', maxFiat: '1380', paymentMethods: ['cash'] })).data;
  assert.ok(!(await ids(seller)).includes(bo.id));

  assert.equal((await seller.post('/users/sbuyer/unblock')).status, 200);
  assert.equal((await seller.get('/users/sbuyer')).data.blockedByMe, false);
  assert.ok((await ids(buyer)).includes(offer.id));
  assert.equal((await buyer.post(`/offers/${offer.id}/trades`, { amount: '1' })).status, 201);
});
