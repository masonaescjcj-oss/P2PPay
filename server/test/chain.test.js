'use strict';

// Chain mode against an in-memory fake TronGrid: deposits, withdrawals and sweeps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256 } = require('@noble/hashes/sha2.js');
const { TronWeb, utils } = require('tronweb');
const baseConfig = require('../src/config');
const keys = require('../src/tron/keys');
const { setup } = require('./helpers');

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const kr = keys.createKeyring(M);
const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const OUT = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const COLD = kr.depositAddress(999999);
const U = (n) => BigInt(Math.round(n * 1e6)); // USDT → micro

// --- tiny protobuf reader to inspect what the server broadcast ---
function fields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let v = 0n, s = 0n, b;
    do { b = buf[i++]; v |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80);
    return v;
  };
  while (i < buf.length) {
    const key = Number(varint());
    const f = key >> 3, w = key & 7;
    if (w === 0) out.push({ f, v: varint() });
    else if (w === 2) { const n = Number(varint()); out.push({ f, v: buf.subarray(i, i + n) }); i += n; }
    else throw new Error('wire ' + w);
  }
  return out;
}
const get = (fs, f) => fs.find((x) => x.f === f)?.v;
const b58 = (bytes) => TronWeb.address.fromHex(Buffer.from(bytes).toString('hex'));

function decode(hex) {
  const txFields = fields(Buffer.from(hex, 'hex'));
  const raw = get(txFields, 1);
  const signature = Buffer.from(get(txFields, 2)).toString('hex');
  const txid = Buffer.from(sha256(raw)).toString('hex');
  const contract = fields(get(fields(raw), 11));
  const type = Number(get(contract, 1));
  const value = fields(get(fields(get(contract, 2)), 2));
  const d = { txid, signer: TronWeb.address.fromHex(utils.crypto.ecRecover(txid, signature)), from: b58(get(value, 1)) };
  if (type === 1) Object.assign(d, { kind: 'trx', to: b58(get(value, 2)), amount: get(value, 3) });
  else {
    const data = Buffer.from(get(value, 4)).toString('hex');
    Object.assign(d, { kind: 'trc20', token: b58(get(value, 2)), to: TronWeb.address.fromHex('41' + data.slice(32, 72)), amount: BigInt('0x' + data.slice(72)) });
  }
  return d;
}

function fakeTron() {
  const s = { transfers: new Map(), usdt: new Map(), trx: new Map(), sent: [], outcomes: new Map(), known: new Set(), logs: new Map(), reply: () => ({ result: true }) };
  s.client = {
    getNowBlock: async () => ({ number: 5000, id: '0000000000001388' + 'ab'.repeat(24), timestamp: Date.now() }),
    getIncomingTrc20: async (a, { minTimestamp }) => (s.transfers.get(a) || []).filter((t) => t.timestamp >= minTimestamp),
    getTrc20Balance: async (a) => s.usdt.get(a) ?? 0n,
    getTrxBalance: async (a) => s.trx.get(a) ?? 0n,
    broadcastHex: async (hex) => {
      const d = decode(hex);
      s.sent.push(d);
      return { txid: d.txid, ...s.reply(d) };
    },
    getConfirmedOutcome: async (txid) => s.outcomes.get(txid) ?? null,
    getConfirmedLogs: async (txid) => (s.logs.has(txid) ? { ok: true, logs: s.logs.get(txid) } : null),
    isKnown: async (txid) => s.known.has(txid),
  };
  const h20 = (a) => TronWeb.address.toHex(a).slice(2).toLowerCase();
  // An incoming transfer as the index API reports it; `onChain: false` = the node has no matching event.
  s.pay = (to, amount, { onChain = true, ...extra } = {}) => {
    const list = s.transfers.get(to) || [];
    const t = { txid: Buffer.from(sha256(Buffer.from(`${to}:${list.length}:${amount}:${extra.contract}`))).toString('hex'), from: OUT, to, value: String(U(amount)), contract: USDT, type: 'Transfer', timestamp: Date.now(), ...extra };
    list.push(t);
    s.transfers.set(to, list);
    if (onChain) {
      s.logs.set(t.txid, [{
        address: h20(t.contract),
        topics: ['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', h20(OUT).padStart(64, '0'), h20(to).padStart(64, '0')],
        data: U(amount).toString(16).padStart(64, '0'),
      }]);
    }
    return t;
  };
  return s;
}

async function chainSetup(tronOverrides = {}) {
  const fake = fakeTron();
  const s = await setup(
    { tron: { ...baseConfig.tron, network: 'nile', mnemonic: M, usdtContract: USDT, explorer: 'https://nile.tronscan.org', ...tronOverrides } },
    { tronClient: fake.client, autoStartChain: false, log: { warn() {}, error() {} } }
  );
  const chain = s.app.locals.chain;
  const db = s.app.locals.db;
  const age = (username) => db.run('UPDATE users SET created_at = ? WHERE username = ?', [Date.now() - 2 * 86_400_000, username]);
  // Credit a user through a (fake) on-chain deposit to their own address.
  const fund = async (c, amount) => {
    const { address } = (await c.get('/deposit-address')).data;
    fake.pay(address, Number(amount));
    assert.equal((await c.post('/deposit-address/check')).data.credited, 1);
  };
  return { ...s, fake, chain, db, age, fund };
}

test('chain deposits: per-user address, confirmed credit once, fake tokens and dust ignored', async (t) => {
  const s = await chainSetup();
  t.after(s.close);
  const c = await s.user('alice');
  const cfg = (await c.get('/config')).data;
  assert.equal(cfg.depositAddress, null);
  assert.equal(cfg.chain.network, 'nile');
  assert.equal((await c.post('/deposits', { amount: '1', txid: 'ab'.repeat(32) })).data.error, 'chain_deposits_only');

  const me = (await c.get('/me')).data;
  const { address } = (await c.get('/deposit-address')).data;
  assert.equal(address, kr.depositAddress(me.id));

  s.fake.pay(address, 50);
  s.fake.pay(address, 9, { contract: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7' }); // a different token
  s.fake.pay(address, 0.5); // below MIN_DEPOSIT_MICRO
  s.fake.pay(address, 0); // zero-value spam
  s.fake.pay(address, 1000, { onChain: false }); // index API claims a transfer the node never executed
  assert.equal((await c.post('/deposit-address/check')).data.credited, 1);
  s.fake.usdt.set(address, U(50));
  await s.chain.tick();
  await s.chain.tick();
  const w = await s.balance(c);
  assert.equal(w.available, '50');
  const deps = w.deposits;
  assert.equal(deps.length, 2);
  assert.deepEqual(deps.map((d) => d.status).sort(), ['approved', 'rejected']);
  assert.ok(deps.every((d) => d.source === 'chain' && d.address === address));
  assert.equal((await s.db.one('SELECT needs_sweep FROM deposit_addresses WHERE address = ?', [address])).needs_sweep, 1);
});

test('chain withdrawals: auto-send below limit, burn only on confirmation', async (t) => {
  const s = await chainSetup();
  t.after(s.close);
  const c = await s.user('bob');
  await s.age('bob');
  await s.fund(c, '500');
  s.fake.usdt.set(kr.hotAddress, U(10_000));
  s.fake.trx.set(kr.hotAddress, 1_000_000_000n);

  assert.equal((await s.withdraw(c, { amount: '100', address: kr.hotAddress })).data.error, 'invalid_address');
  const wd = await s.withdraw(c, { amount: '100', address: OUT });
  assert.equal(wd.status, 201);
  await s.chain.tick();
  assert.equal(s.fake.sent.length, 1);
  const sent = s.fake.sent[0];
  assert.deepEqual([sent.kind, sent.signer, sent.from, sent.token, sent.to, sent.amount], ['trc20', kr.hotAddress, kr.hotAddress, USDT, OUT, U(100)]);
  let b = await s.balance(c);
  assert.equal(b.withdrawals[0].status, 'sending');
  assert.equal(b.withdrawals[0].txid, sent.txid);
  assert.equal(b.locked, '101');

  await s.chain.tick(); // not confirmed yet → nothing changes, no re-broadcast
  assert.equal(s.fake.sent.length, 1);
  s.fake.outcomes.set(sent.txid, { ok: true, blockNumber: 5001 });
  await s.chain.tick();
  b = await s.balance(c);
  assert.equal(b.withdrawals[0].status, 'sent');
  assert.equal(b.available, '399');
  assert.equal(b.locked, '0');
});

test('chain withdrawals: limits, admin send, broadcast rejection, revert, expiry, refund', async (t) => {
  const s = await chainSetup();
  t.after(s.close);
  const c = await s.user('carol');
  const fresh = await s.user('dave');
  await s.age('carol');
  await s.fund(c, '1000');
  await s.fund(fresh, '50');
  s.fake.usdt.set(kr.hotAddress, U(10_000));
  s.fake.trx.set(kr.hotAddress, 1_000_000_000n);

  const big = (await s.withdraw(c, { amount: '300', address: OUT })).data; // above auto limit
  await s.withdraw(fresh, { amount: '10', address: OUT }); // account younger than 24h
  await s.chain.tick();
  assert.equal(s.fake.sent.length, 0);

  // admin sends; node rejects the broadcast → failed, funds still locked
  s.fake.reply = () => ({ result: false, code: 'CONTRACT_VALIDATE_ERROR', message: 'balance is not sufficient' });
  let r = await s.admin.post(`/admin/withdrawals/${big.id}/send`, { note: 'checked' });
  assert.equal(r.data.status, 'failed');
  assert.match(r.data.note, /CONTRACT_VALIDATE_ERROR/);
  assert.equal((await s.balance(c)).locked, '301');

  // the rejected signed tx could still be broadcast by someone until it expires → no retry or refund yet
  assert.equal((await s.admin.post(`/admin/withdrawals/${big.id}/send`)).data.error, 'retry_later');
  assert.equal((await s.admin.post(`/admin/withdrawals/${big.id}/reject`, { note: 'x' })).data.error, 'retry_later');
  await s.db.run('UPDATE withdrawals SET tx_expires_at = ? WHERE id = ?', [Date.now() - 10 * 60_000, big.id]);

  // retry; this time it lands but reverts on chain → failed again
  s.fake.reply = () => ({ result: true });
  r = await s.admin.post(`/admin/withdrawals/${big.id}/send`);
  assert.equal(r.data.status, 'sending');
  assert.equal((await s.admin.post(`/admin/withdrawals/${big.id}/reject`, { note: 'x' })).data.error, 'already_reviewed');
  s.fake.outcomes.set(s.fake.sent.at(-1).txid, { ok: false, reason: 'REVERT' });
  await s.chain.tick();
  let w = (await s.balance(c)).withdrawals.find((x) => x.id === big.id);
  assert.equal(w.status, 'failed');
  assert.equal(w.attempts, 2);

  // a reverted tx can never execute again → immediate retry is fine.
  // This time the broadcast result is unknown and the tx expires unseen → failed ("expired")
  s.fake.reply = () => { throw new Error('socket hang up'); };
  assert.equal((await s.admin.post(`/admin/withdrawals/${big.id}/send`)).data.status, 'sending');
  const lastTx = s.fake.sent.at(-1).txid;
  await s.db.run('UPDATE withdrawals SET tx_expires_at = ? WHERE id = ?', [Date.now() - 10 * 60_000, big.id]);
  s.fake.known.add(lastTx);
  await s.chain.tick();
  assert.equal((await s.balance(c)).withdrawals.find((x) => x.id === big.id).status, 'sending'); // node still knows it
  s.fake.known.delete(lastTx);
  await s.chain.tick();
  w = (await s.balance(c)).withdrawals.find((x) => x.id === big.id);
  assert.equal(w.status, 'failed');
  assert.equal(w.note, 'expired');

  // admin gives up and refunds
  await s.admin.post(`/admin/withdrawals/${big.id}/reject`, { note: 'refund after failures' });
  const b = await s.balance(c);
  assert.equal(b.available, '1000');
  assert.equal(b.locked, '0');
  const actions = (await s.admin.get('/admin/actions')).data.map((a) => a.action);
  assert.ok(actions.includes('withdrawal_send') && actions.includes('withdrawal_reject'));

  // a "failed" attempt that in fact landed: retry settles it as sent instead of paying twice
  const late = (await s.withdraw(c, { amount: '50', address: OUT })).data;
  s.fake.reply = () => ({ result: false, code: 'SERVER_BUSY' });
  await s.admin.post(`/admin/withdrawals/${late.id}/send`);
  s.fake.outcomes.set(s.fake.sent.at(-1).txid, { ok: true });
  s.fake.reply = () => ({ result: true });
  const sentBefore = s.fake.sent.length;
  assert.equal((await s.admin.post(`/admin/withdrawals/${late.id}/send`)).data.error, 'already_sent');
  assert.equal(s.fake.sent.length, sentBefore);
  assert.equal((await s.balance(c)).withdrawals.find((x) => x.id === late.id).status, 'sent');
  assert.equal((await s.balance(c)).available, '949');

  // hot wallet empty → admin send refused, stays pending
  s.fake.usdt.set(kr.hotAddress, 0n);
  const small = (await s.withdraw(c, { amount: '20', address: OUT })).data;
  assert.equal((await s.admin.post(`/admin/withdrawals/${small.id}/send`)).data.error, 'hot_wallet_low');
  assert.equal((await s.balance(c)).withdrawals.find((x) => x.id === small.id).status, 'pending');

  const st = (await s.admin.get('/admin/chain')).data;
  assert.equal(st.hotAddress, kr.hotAddress);
  assert.equal(st.network, 'nile');
});

test('daily auto-withdrawal cap', async (t) => {
  const s = await chainSetup({ autoWithdrawMaxMicro: 100_000_000, dailyAutoMaxMicro: 150_000_000 });
  t.after(s.close);
  const c = await s.user('erin');
  await s.age('erin');
  await s.fund(c, '500');
  s.fake.usdt.set(kr.hotAddress, U(10_000));
  s.fake.trx.set(kr.hotAddress, 1_000_000_000n);
  await s.withdraw(c, { amount: '100', address: OUT });
  await s.withdraw(c, { amount: '80', address: OUT });
  await s.chain.tick();
  assert.equal(s.fake.sent.length, 1); // 100 + 80 would exceed the 150/day cap
});

test('sweeps: TRX top-up, then USDT to hot wallet, or to cold wallet when hot is full', async (t) => {
  const s = await chainSetup({ coldAddress: COLD, hotMaxMicro: 1_000_000_000 });
  t.after(s.close);
  const c = await s.user('frank');
  const { address } = (await c.get('/deposit-address')).data;
  s.fake.pay(address, 60);
  s.fake.usdt.set(address, U(60)); // on chain the confirmed deposit is already in the balance
  s.fake.trx.set(kr.hotAddress, 1_000_000_000n);
  s.fake.usdt.set(kr.hotAddress, U(10));
  await s.chain.tick(); // credits; its sweep pass sends the first TRX top-up
  assert.equal(s.fake.sent.length, 1);

  const topup = s.fake.sent.at(-1);
  assert.deepEqual([topup.kind, topup.from, topup.to, topup.amount], ['trx', kr.hotAddress, address, 35_000_000n]);
  await s.chain.sweepTick(); // top-up still in flight → no second top-up
  assert.equal(s.fake.sent.length, 1);

  s.fake.outcomes.set(topup.txid, { ok: true });
  s.fake.trx.set(address, 35_000_000n);
  await s.chain.sweepTick();
  const sweep = s.fake.sent.at(-1);
  assert.deepEqual([sweep.kind, sweep.signer, sweep.from, sweep.to, sweep.amount], ['trc20', address, address, kr.hotAddress, U(60)]);

  // swept address is emptied → flag cleared on the next pass
  s.fake.outcomes.set(sweep.txid, { ok: true });
  s.fake.usdt.set(address, 0n);
  await s.chain.sweepTick();
  assert.equal((await s.db.one('SELECT needs_sweep FROM deposit_addresses WHERE address = ?', [address])).needs_sweep, 0);

  // next deposit while the hot wallet is above its cap → goes to cold storage
  s.fake.usdt.set(kr.hotAddress, U(5000));
  s.fake.pay(address, 40);
  s.fake.usdt.set(address, U(40));
  await s.chain.tick();
  await s.chain.sweepTick();
  assert.equal(s.fake.sent.at(-1).to, COLD);
  assert.equal((await s.balance(c)).available, '100');
});
