'use strict';

// RFC 6238 TOTP (HMAC-SHA1, 30 s steps, 6 digits) — compatible with Google Authenticator, Authy, etc.
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const STEP = 30_000;
const stepAt = (now) => Math.floor(now / STEP);
const generateSecret = () => base32Encode(crypto.randomBytes(20));
const totp = (secret, now = Date.now(), digits = 6) => hotp(base32Decode(secret), stepAt(now), digits);

// Returns the matching step (to store for replay protection) or null. Steps ≤ lastStep are refused.
function verifyTotp(secret, code, { now = Date.now(), window = 1, lastStep = 0 } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const cur = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const s = cur + d;
    if (s <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(c))) return s;
  }
  return null;
}

function otpauthUri(secret, account, issuer = 'AriaPay') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { base32Encode, base32Decode, hotp, totp, verifyTotp, generateSecret, otpauthUri };
