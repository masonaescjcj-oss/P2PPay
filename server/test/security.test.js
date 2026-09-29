'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const totp = require('../src/security/totp');
const { normalizePhone } = require('../src/security/service');
const baseConfig = require('../src/config');
const { setup, TXID, ADDR } = require('./helpers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('selfie')]);

test('TOTP matches RFC 6238 and refuses replays', () => {
  const key = Buffer.from('12345678901234567890');
  for (const [t, want] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [20000000000, '65353130']]) {
    assert.equal(totp.hotp(key, Math.floor(t / 30), 8), want);
  }
  const s = totp.generateSecret();
  const now = Date.now();
  const at = Math.floor(now / 30_000);
  assert.equal(totp.verifyTotp(s, totp.totp(s, now), { now }), at);
  assert.equal(totp.verifyTotp(s, totp.totp(s, now), { now, lastStep: at }), null);
  assert.equal(totp.verifyTotp(s, '12345'), null);
  assert.equal(normalizePhone('0701234567'), '+93701234567');
  assert.equal(normalizePhone('۰۷۰۱۲۳۴۵۶۷'), '+93701234567');
  assert.equal(normalizePhone('12'), null);
});

test('phone verification: codes, attempts, one account per number', async (t) => {
  const s = await setup();
  t.after(s.close);
  const a = await s.user('phoneA', { verified: false });
  assert.equal((await a.post('/me/phone', { phone: 'abc' })).data.error, 'invalid_phone');
  assert.equal((await a.post('/me/phone', { phone: '0701111111' })).data.phone, '+93701111111');
  for (let i = 0; i < 5; i++) assert.equal((await a.post('/me/phone/verify', { code: '000000' })).data.error, 'invalid_code');
  assert.equal((await a.post('/me/phone/verify', { code: s.sms.last('+93701111111') })).data.error, 'code_expired');
  await a.post('/me/phone', { phone: '0701111111' });
  assert.equal((await a.post('/me/phone/verify', { code: s.sms.last('+93701111111') })).status, 200);
  const me = (await a.get('/me')).data;
  assert.equal(me.phoneVerified, true);
  assert.equal(me.kycTier, 1);

  const b = await s.user('phoneB', { verified: false });
  assert.equal((await b.post('/me/phone', { phone: '+93701111111' })).data.error, 'phone_in_use');

  // five failures within an hour raise an alert for staff
  const alerts = (await s.admin.get('/admin/alerts')).data;
  assert.ok(alerts.some((x) => x.rule === 'auth_failures' && x.username === 'phoneA'));
});

test('KYC tiers gate trading, offers and withdrawals; 24h limits apply to both sides', async (t) => {
  const limits = { ...baseConfig.kycLimits, 1: { trade: 30_000_000, withdraw: 20_000_000 } };
  const s = await setup({ kycLimits: limits });
  t.after(s.close);
  const seller = await s.user('tierSeller');
  const newbie = await s.user('tierNewbie', { verified: false });
  const buyer = await s.user('tierBuyer');
  await s.fund(seller, '100', 1);
  await s.fund(newbie, '10', 2);
  await s.account(seller, 'bank');
  await s.account(newbie, 'bank');

  assert.equal((await newbie.post('/offers', { side: 'sell', price: '70', total: '5', minFiat: '70', maxFiat: '350', paymentMethods: ['bank'] })).data.error, 'kyc_required');
  assert.equal((await s.withdraw(newbie, { amount: '6', address: ADDR })).data.error, 'verification_required');

  const offer = await seller.post('/offers', { side: 'sell', price: '70', total: '60', minFiat: '70', maxFiat: '7000', paymentMethods: ['bank'] });
  assert.equal(offer.status, 201);
  assert.equal((await newbie.post(`/offers/${offer.data.id}/trades`, { amount: '5' })).data.error, 'kyc_required');

  const t1 = await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '25' });
  assert.equal(t1.status, 201);
  assert.equal((await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '10' })).data.error, 'limit_exceeded'); // 25 + 10 > 30
  // cancelled trades do not count
  await buyer.post(`/trades/${t1.data.id}/cancel`);
  assert.equal((await buyer.post(`/offers/${offer.data.id}/trades`, { amount: '10' })).status, 201);

  // the counterparty's limit is checked too
  const buyOffer = await newbie.post('/offers', { side: 'buy', price: '70', total: '5', minFiat: '70', maxFiat: '350', paymentMethods: ['bank'] });
  assert.equal(buyOffer.data.error, 'kyc_required');

  assert.equal((await s.withdraw(seller, { amount: '15', address: ADDR })).status, 201);
  assert.equal((await s.withdraw(seller, { amount: '6', address: ADDR })).data.error, 'limit_exceeded'); // 15 + 6 > 20
  const k = (await seller.get('/kyc')).data;
  assert.equal(k.tier, 1);
  assert.equal(k.limits.withdraw, '20');
  assert.equal(k.used.withdraw, '15');
});

test('withdrawal codes: required, single use, wrong code changes nothing', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('wdCode');
  await s.fund(c, '50', 3);
  assert.equal((await c.post('/withdrawals', { amount: '10', address: ADDR })).data.error, 'code_expired');
  await c.post('/withdrawals/code');
  const code = s.sms.last(c.phone);
  assert.equal((await c.post('/withdrawals', { amount: '10', address: ADDR, code: '111111' })).data.error, 'invalid_code');
  assert.equal((await s.balance(c)).available, '50');
  assert.equal((await c.post('/withdrawals', { amount: '10', address: 'bad', code })).data.error, 'invalid_address'); // input first
  assert.equal((await c.post('/withdrawals', { amount: '10', address: ADDR, code })).status, 201);
  assert.equal((await c.post('/withdrawals', { amount: '10', address: ADDR, code })).data.error, 'code_expired');
});

test('authenticator 2FA: login challenge, backup codes, replay, disable, sessions', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('twofa');
  const other = s.client();
  await other.post('/auth/login', { username: 'twofa', password: 'password123' });
  await s.enableTotp(c);
  assert.equal(c.backupCodes.length, 10);
  assert.equal((await other.get('/me')).status, 401); // other sessions signed out
  assert.equal((await c.get('/me')).data.totpEnabled, true);

  const l = s.client();
  const r1 = await l.post('/auth/login', { username: 'twofa', password: 'password123' });
  assert.equal(r1.data.twoFactor, true);
  assert.equal((await l.get('/me')).status, 401);
  assert.equal((await l.post('/auth/login/2fa', { challenge: r1.data.challenge, code: '000000' })).data.error, 'invalid_code');
  // the code used to enable 2FA cannot be replayed (the exact code: a fresh one may already be a newer step)
  assert.equal((await l.post('/auth/login/2fa', { challenge: r1.data.challenge, code: c.enableCode })).data.error, 'invalid_code');
  // a backup code works exactly once
  const backup = c.backupCodes[0];
  assert.equal((await l.post('/auth/login/2fa', { challenge: r1.data.challenge, code: backup })).status, 200);
  assert.equal((await l.get('/me')).data.username, 'twofa');
  const r2 = await s.client().post('/auth/login', { username: 'twofa', password: 'password123' });
  assert.equal((await s.client().post('/auth/login/2fa', { challenge: r2.data.challenge, code: backup })).data.error, 'invalid_code');
  assert.equal((await s.client().post('/auth/login/2fa', { challenge: 'forged', code: backup })).data.error, 'challenge_expired');

  // withdrawals use the authenticator, not SMS, and never a backup code
  await s.fund(c, '20', 4);
  assert.equal((await c.post('/withdrawals/code')).data.error, 'use_authenticator');
  assert.equal((await c.post('/withdrawals', { amount: '10', address: ADDR, code: c.backupCodes[1] })).data.error, 'invalid_code');

  assert.equal((await c.post('/me/totp/disable', { code: '000000' })).data.error, 'invalid_code');
  assert.equal((await c.post('/me/totp/disable', { code: c.backupCodes[2] })).status, 200);
  assert.equal((await c.get('/me')).data.totpEnabled, false);
  const events = (await c.get('/me/security')).data.events.map((e) => e.kind);
  assert.ok(events.includes('totp_enabled') && events.includes('totp_disabled') && events.includes('login'));
});

test('guessing 2FA codes with fresh login challenges still locks the account', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('guessed');
  const secret = await s.enableTotp(c);
  let last;
  for (let i = 0; i < 8; i++) {
    const ch = (await s.client().post('/auth/login', { username: 'guessed', password: 'password123' })).data.challenge;
    last = (await s.client().post('/auth/login/2fa', { challenge: ch, code: '000000' })).data.error;
  }
  assert.equal(last, 'account_locked');
  assert.equal((await s.client().post('/auth/login', { username: 'guessed', password: 'password123' })).data.error, 'account_locked');
  void secret;
});

test('login lockout and password change', async (t) => {
  const s = await setup();
  t.after(s.close);
  const c = await s.user('lockme');
  const other = s.client();
  await other.post('/auth/login', { username: 'lockme', password: 'password123' });
  for (let i = 0; i < 7; i++) assert.equal((await s.client().post('/auth/login', { username: 'lockme', password: 'nope-nope' })).data.error, 'invalid_credentials');
  assert.equal((await s.client().post('/auth/login', { username: 'lockme', password: 'nope-nope' })).data.error, 'account_locked');
  assert.equal((await s.client().post('/auth/login', { username: 'lockme', password: 'password123' })).data.error, 'account_locked');
  await s.db.run("UPDATE users SET locked_until = 0 WHERE username = 'lockme'");

  assert.equal((await c.post('/me/password', { current: 'wrong', next: 'newpassword1' })).data.error, 'invalid_password');
  assert.equal((await c.post('/me/password', { current: 'password123', next: 'short' })).data.error, 'weak_password');
  assert.equal((await c.post('/me/password', { current: 'password123', next: 'newpassword1' })).status, 200);
  assert.equal((await other.get('/me')).status, 401);
  assert.equal((await c.get('/me')).status, 200);
  assert.equal((await s.client().post('/auth/login', { username: 'lockme', password: 'newpassword1' })).status, 200);
});

test('staff roles: permissions, 2FA requirement, role changes', async (t) => {
  const s = await setup();
  t.after(s.close);
  const sup = await s.user('supporter');
  const fin = await s.user('financier');
  const plain = await s.user('plainuser');
  assert.equal((await plain.get('/admin/overview')).status, 403);
  const ids = Object.fromEntries((await s.admin.get('/admin/users')).data.map((x) => [x.username, x.id]));

  assert.equal((await sup.post(`/admin/users/${ids.financier}/role`, { role: 'admin' })).status, 403);
  assert.equal((await s.admin.post(`/admin/users/${ids.supporter}/role`, { role: 'support' })).status, 200);
  assert.equal((await s.admin.post(`/admin/users/${ids.financier}/role`, { role: 'finance' })).status, 200);
  assert.equal((await s.admin.post(`/admin/users/${ids.admin}/role`, { role: 'user' })).data.error, 'own_request');

  // role change signs the user out; staff need 2FA before anything works
  assert.equal((await sup.get('/me')).status, 401);
  const sup2 = s.client();
  await sup2.post('/auth/login', { username: 'supporter', password: 'password123' });
  assert.equal((await sup2.get('/admin/overview')).data.error, 'staff_2fa_required');
  await s.enableTotp(sup2);
  assert.equal((await sup2.get('/admin/overview')).status, 200);
  assert.equal((await sup2.get('/admin/kyc')).status, 200);
  assert.equal((await sup2.get('/admin/alerts')).status, 200);
  assert.equal((await sup2.get('/admin/deposits')).status, 403);
  assert.equal((await sup2.get('/admin/actions')).status, 403);
  assert.equal((await sup2.post(`/admin/users/${ids.financier}/block`, { blocked: true })).data.error, 'cannot_block_admin');
  assert.equal((await sup2.post('/me/totp/disable', { code: totp.totp(sup2.totpSecret) })).data.error, 'staff_2fa_required');

  const fin2 = s.client();
  await fin2.post('/auth/login', { username: 'financier', password: 'password123' });
  await s.enableTotp(fin2);
  assert.equal((await fin2.get('/admin/deposits')).status, 200);
  assert.equal((await fin2.get('/admin/trades')).status, 403);
  assert.equal((await fin2.get('/admin/users')).status, 403);
  const log = (await fin2.get('/admin/actions')).data.map((a) => a.action);
  assert.ok(log.includes('role_support') && log.includes('role_finance'));
  void plain;
});

test('KYC documents: encrypted at rest, staff review, tier upgrade', async (t) => {
  const s = await setup();
  t.after(s.close);
  const unverified = await s.user('kycNone', { verified: false });
  assert.equal((await unverified.post('/kyc/submission', { docType: 'tazkira', fullName: 'Ahmad Rahimi', docNumber: '1400-0101-12345' })).data.error, 'phone_first');
  const c = await s.user('kycUser');
  assert.equal((await c.post('/kyc/submission', { docType: 'id', fullName: 'A', docNumber: '1' })).data.error, 'invalid_doc_type');
  const sub = (await c.post('/kyc/submission', { docType: 'tazkira', fullName: 'Ahmad Rahimi', docNumber: '1400-0101-12345' })).data;
  assert.equal(sub.status, 'draft');

  // uploads must be real images and carry the upload header
  const bare = await fetch(`${s.base}/kyc/submission/${sub.id}/files/front`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG });
  assert.equal((await bare.json()).error, 'json_required');
  assert.equal((await c.upload(`/kyc/submission/${sub.id}/files/front`, Buffer.from('not an image'))).data.error, 'invalid_image');
  assert.equal((await c.upload(`/kyc/submission/${sub.id}/files/other`, PNG)).data.error, 'invalid_file_kind');
  assert.equal((await c.upload(`/kyc/submission/${sub.id}/files/front`, PNG)).status, 200);
  assert.equal((await c.post(`/kyc/submission/${sub.id}/submit`)).data.error, 'kyc_files_missing');
  assert.equal((await c.upload(`/kyc/submission/${sub.id}/files/selfie`, JPG, 'image/jpeg')).status, 200);
  assert.equal((await c.post(`/kyc/submission/${sub.id}/submit`)).data.status, 'pending');
  assert.equal((await c.upload(`/kyc/submission/${sub.id}/files/back`, PNG)).data.error, 'kyc_not_editable');

  // on disk the files are ciphertext
  const files = fs.readdirSync(s.config.kycDir, { recursive: true }).filter((f) => f.endsWith('.bin'));
  assert.equal(files.length, 2);
  for (const f of files) {
    const onDisk = fs.readFileSync(path.join(s.config.kycDir, f));
    assert.ok(!onDisk.includes(Buffer.from('fake image body')) && !onDisk.includes(Buffer.from('selfie')));
  }

  const pending = (await s.admin.get('/admin/kyc?status=pending')).data;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].username, 'kycUser');
  const img = await s.admin.get(`/admin/kyc/${sub.id}/files/front`);
  assert.ok(Buffer.compare(img.data, PNG) === 0);
  assert.equal((await c.get(`/admin/kyc/${sub.id}/files/front`)).status, 403);

  assert.equal((await s.admin.post(`/admin/kyc/${sub.id}/reject`, {})).data.error, 'reason_required');
  assert.equal((await s.admin.post(`/admin/kyc/${sub.id}/approve`, { tier: 2 })).data.status, 'approved');
  const k = (await c.get('/kyc')).data;
  assert.equal(k.tier, 2);
  assert.equal(k.limits.trade, '20000');
  assert.equal((await s.admin.get('/admin/actions')).data[0].action, 'kyc_approve');
});

test('alerts: pass-through, shared address, large trade; closing is audited', async (t) => {
  const s = await setup({ alertLargeTradeMicro: 10_000_000 });
  t.after(s.close);
  const a = await s.user('alertA');
  const b = await s.user('alertB');
  await s.fund(a, '100', 5);
  await s.fund(b, '100', 6);
  await s.account(a, 'bank');

  assert.equal((await s.withdraw(a, { amount: '95', address: ADDR })).status, 201); // arrives and leaves untraded
  assert.equal((await s.withdraw(b, { amount: '5', address: ADDR })).status, 201); // same destination
  const offer = await b.post('/offers', { side: 'buy', price: '70', total: '50', minFiat: '70', maxFiat: '3500', paymentMethods: ['bank'] });
  await s.fund(a, '30', 7);
  assert.equal((await a.post(`/offers/${offer.data.id}/trades`, { amount: '20' })).status, 201);

  const list = (await s.admin.get('/admin/alerts?status=open')).data;
  const rules = list.map((x) => `${x.username}:${x.rule}`);
  assert.ok(rules.includes('alertA:pass_through'), rules.join());
  assert.ok(rules.includes('alertB:shared_address'), rules.join());
  assert.ok(rules.includes('alertA:large_trade') && rules.includes('alertB:large_trade'), rules.join());

  const one = list.find((x) => x.rule === 'shared_address');
  assert.deepEqual(one.details.address, ADDR);
  assert.equal((await s.admin.post(`/admin/alerts/${one.id}/close`, { note: 'family members, checked' })).status, 200);
  assert.equal((await s.admin.post(`/admin/alerts/${one.id}/close`, {})).status, 404);
  assert.equal((await s.admin.get('/admin/actions')).data[0].action, 'alert_close');
  assert.equal((await s.admin.get('/admin/overview')).data.openAlerts, list.length - 1);
  void TXID;
});
