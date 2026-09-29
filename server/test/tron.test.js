'use strict';

// Cross-checks our key derivation, protobuf encoding and signatures against tronweb (dev dependency).
const test = require('node:test');
const assert = require('node:assert/strict');
const { TronWeb, utils } = require('tronweb');
const keys = require('../src/tron/keys');
const tx = require('../src/tron/tx');

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const kr = keys.createKeyring(M);
const block = { number: 71382989, id: '00000000044137cd2b7e6df70b6024677c0d2167777389da2a4e56458b9e8b51', timestamp: 1790670000000 };
const now = 1790670001234;
const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const h41 = (a) => TronWeb.address.toHex(a);
const refs = { ref_block_bytes: '37cd', ref_block_hash: '2b7e6df70b602467', timestamp: now, expiration: block.timestamp + 60000 };
const hexOf = (b) => Buffer.from(b).toString('hex');

test('HD addresses match tronweb and the known BIP44 vector', () => {
  assert.equal(kr.depositAddress(0), 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
  for (const path of ["m/44'/195'/0'/0/5", keys.HOT_PATH]) {
    const ours = path === keys.HOT_PATH ? kr.hotAddress : kr.depositAddress(5);
    assert.equal(ours, TronWeb.fromMnemonic(M, path).address);
  }
  assert.ok(keys.isAddress(kr.hotAddress));
  assert.ok(!keys.isAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdX')); // bad checksum
  assert.ok(!keys.isAddress('0x1234'));
  assert.throws(() => keys.createKeyring('not a real mnemonic'), /valid BIP39/);
});

test('TRC20 transfer encoding, txID and signature match tronweb', () => {
  const to = kr.depositAddress(3);
  const raw = tx.buildTrc20Transfer({ from: kr.hotAddress, token: USDT, to, amount: 141002117, feeLimitSun: 100000000, block, now });
  const json = {
    raw_data: {
      contract: [{
        parameter: {
          value: { owner_address: h41(kr.hotAddress), contract_address: h41(USDT), data: hexOf(tx.trc20TransferData(to, 141002117)) },
          type_url: 'type.googleapis.com/protocol.TriggerSmartContract',
        },
        type: 'TriggerSmartContract',
      }],
      ...refs, fee_limit: 100000000,
    },
  };
  const pb = utils.transaction.txJsonToPb(json);
  assert.equal(hexOf(raw.bytes), utils.transaction.txPbToRawDataHex(pb).toLowerCase());
  const signed = tx.sign(raw, kr.hotKey());
  assert.equal(signed.txID, utils.transaction.txPbToTxID(pb).replace(/^0x/, ''));
  assert.equal(signed.signature, utils.crypto.ECKeySign(Buffer.from(signed.txID, 'hex'), Buffer.from(kr.hotKey())).toLowerCase());
  assert.equal(TronWeb.address.fromHex(utils.crypto.ecRecover(signed.txID, signed.signature)), kr.hotAddress);
  // transfer(address,uint256) calldata: selector + recipient + amount
  const data = hexOf(tx.trc20TransferData(to, 1));
  assert.equal(data.slice(0, 8), 'a9059cbb');
  assert.equal(data.slice(32, 72), h41(to).slice(2).toLowerCase());
  assert.equal(BigInt('0x' + data.slice(72)), 1n);
});

test('TRX transfer encoding matches tronweb', () => {
  const raw = tx.buildTrxTransfer({ from: kr.hotAddress, to: kr.depositAddress(3), amountSun: 30000000, block, now });
  const json = {
    raw_data: {
      contract: [{
        parameter: {
          value: { owner_address: h41(kr.hotAddress), to_address: h41(kr.depositAddress(3)), amount: 30000000 },
          type_url: 'type.googleapis.com/protocol.TransferContract',
        },
        type: 'TransferContract',
      }],
      ...refs,
    },
  };
  assert.equal(hexOf(raw.bytes), utils.transaction.txPbToRawDataHex(utils.transaction.txJsonToPb(json)).toLowerCase());
  assert.throws(() => tx.buildTrc20Transfer({ from: kr.hotAddress, token: USDT, to: kr.hotAddress, amount: 0, block }), /positive/);
});
