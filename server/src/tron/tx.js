'use strict';

// Builds TRON transactions locally (protobuf) so the server signs exactly what it built;
// the node only supplies a recent block reference (TaPoS), which cannot redirect funds.
const { secp256k1 } = require('@noble/curves/secp256k1.js');
const { sha256 } = require('@noble/hashes/sha2.js');
const { addressToBytes } = require('./keys');

const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function varint(n) {
  let v = BigInt(n);
  if (v < 0n) throw new Error('negative varint');
  const out = [];
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return Uint8Array.from(out);
}
const tag = (field, wire) => varint((field << 3) | wire);
const fBytes = (field, bytes) => concat(tag(field, 2), varint(bytes.length), bytes);
const fStr = (field, s) => fBytes(field, new TextEncoder().encode(s));
// proto3 omits zero-valued scalars
const fInt = (field, n) => (BigInt(n) === 0n ? new Uint8Array(0) : concat(tag(field, 0), varint(n)));

const TYPES = {
  TransferContract: 1,
  TriggerSmartContract: 31,
};

function contract(name, value) {
  const any = concat(fStr(1, `type.googleapis.com/protocol.${name}`), fBytes(2, value));
  return concat(fInt(1, TYPES[name]), fBytes(2, any));
}

function trc20TransferData(to, amount) {
  const addr = addressToBytes(to).slice(1);
  const a = BigInt(amount);
  if (a <= 0n) throw new Error('amount must be positive');
  const word = (bytes) => concat(new Uint8Array(32 - bytes.length), bytes);
  return concat(unhex('a9059cbb'), word(addr), word(unhex(a.toString(16).padStart(64, '0'))));
}

// block: { number, id (blockID hex), timestamp }
function rawData({ block, contractBytes, feeLimit = 0, expirationMs = 60_000, now = Date.now() }) {
  const num = BigInt(block.number);
  const numBytes = unhex(num.toString(16).padStart(16, '0'));
  const refBlockBytes = numBytes.slice(6, 8);
  const refBlockHash = unhex(block.id).slice(8, 16);
  const expiration = BigInt(block.timestamp) + BigInt(expirationMs);
  return {
    bytes: concat(
      fBytes(1, refBlockBytes),
      fBytes(4, refBlockHash),
      fInt(8, expiration),
      fBytes(11, contractBytes),
      fInt(14, now),
      fInt(18, feeLimit)
    ),
    expiration: Number(expiration),
  };
}

function buildTrxTransfer({ from, to, amountSun, block, now }) {
  const value = concat(fBytes(1, addressToBytes(from)), fBytes(2, addressToBytes(to)), fInt(3, amountSun));
  return rawData({ block, now, contractBytes: contract('TransferContract', value) });
}

function buildTrc20Transfer({ from, token, to, amount, feeLimitSun, block, now }) {
  const value = concat(
    fBytes(1, addressToBytes(from)),
    fBytes(2, addressToBytes(token)),
    fBytes(4, trc20TransferData(to, amount))
  );
  return rawData({ block, now, feeLimit: feeLimitSun, contractBytes: contract('TriggerSmartContract', value) });
}

// Signs raw_data; returns the txID and the full Transaction protobuf hex for /wallet/broadcasthex.
function sign(raw, privateKey) {
  const txID = sha256(raw.bytes);
  const sig = secp256k1.sign(txID, privateKey, { prehash: false, format: 'recovered' });
  // noble: [recovery, r(32), s(32)] → TRON: r || s || (recovery + 27)
  const rsv = concat(sig.slice(1, 65), Uint8Array.of(sig[0] + 27));
  return {
    txID: hex(txID),
    signature: hex(rsv),
    rawDataHex: hex(raw.bytes),
    expiration: raw.expiration,
    hex: hex(concat(fBytes(1, raw.bytes), fBytes(2, rsv))),
  };
}

module.exports = { buildTrxTransfer, buildTrc20Transfer, trc20TransferData, sign, hex, unhex };
