// The subset of node:crypto the server uses, on audited pure-JS primitives (@noble).
const { Buffer } = require('buffer')
const { gcm } = require('@noble/ciphers/aes.js')
const { hmac } = require('@noble/hashes/hmac.js')
const { sha1 } = require('@noble/hashes/legacy.js')
const { sha256 } = require('@noble/hashes/sha2.js')
const { scrypt } = require('@noble/hashes/scrypt.js')

const HASHES = { sha256, sha1 }
const bytes = (v, enc) => (typeof v === 'string' ? Buffer.from(v, enc || 'utf8') : Buffer.from(v))
const out = (u8, enc) => (enc ? Buffer.from(u8).toString(enc) : Buffer.from(u8))

function randomBytes(n) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Buffer.from(b)
}

function randomInt(min, max) {
  if (max === undefined) [min, max] = [0, min]
  const range = max - min
  const limit = Math.floor(0x100000000 / range) * range
  const u = new Uint32Array(1)
  do crypto.getRandomValues(u)
  while (u[0] >= limit)
  return min + (u[0] % range)
}

function hasher(fn) {
  const parts = []
  return {
    update(v, enc) {
      parts.push(bytes(v, enc))
      return this
    },
    digest: (enc) => out(fn(Buffer.concat(parts)), enc),
  }
}

const createHash = (alg) => hasher((data) => HASHES[alg](data))
const createHmac = (alg, key) => hasher((data) => hmac(HASHES[alg], bytes(key), data))

// Node's defaults: N = 16384, r = 8, p = 1.
const scryptSync = (password, salt, keylen) => Buffer.from(scrypt(bytes(password), bytes(salt), { N: 16384, r: 8, p: 1, dkLen: keylen }))

function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length')
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

// AES-256-GCM, one shot: update() collects, final() does the work.
function createCipheriv(alg, key, iv) {
  if (alg !== 'aes-256-gcm') throw new Error(`unsupported cipher ${alg}`)
  const parts = []
  let tag
  return {
    update(v) {
      parts.push(bytes(v))
      return Buffer.alloc(0)
    },
    final() {
      const sealed = gcm(bytes(key), bytes(iv)).encrypt(Buffer.concat(parts))
      tag = Buffer.from(sealed.subarray(sealed.length - 16))
      return Buffer.from(sealed.subarray(0, sealed.length - 16))
    },
    getAuthTag: () => tag,
  }
}

function createDecipheriv(alg, key, iv) {
  if (alg !== 'aes-256-gcm') throw new Error(`unsupported cipher ${alg}`)
  const parts = []
  let tag
  return {
    setAuthTag(t) {
      tag = bytes(t)
    },
    update(v) {
      parts.push(bytes(v))
      return Buffer.alloc(0)
    },
    final: () => Buffer.from(gcm(bytes(key), bytes(iv)).decrypt(Buffer.concat([...parts, tag]))),
  }
}

module.exports = { randomBytes, randomInt, createHash, createHmac, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv }
