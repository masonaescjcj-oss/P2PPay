'use strict';

// AES-256-GCM for data at rest (TOTP secrets, KYC documents) + an HMAC key for hashing short codes.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createSecretBox(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('data key must be 32 bytes');
  // Fixed key-derivation labels (from the project's first name): changing them makes stored data unreadable.
  const encKey = crypto.createHmac('sha256', key).update('p2ppay:enc').digest();
  const macKey = crypto.createHmac('sha256', key).update('p2ppay:mac').digest();
  return {
    seal(data) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([c.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]);
    },
    open(blob) {
      const b = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
      const d = crypto.createDecipheriv('aes-256-gcm', encKey, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]);
    },
    mac: (s) => crypto.createHmac('sha256', macKey).update(String(s)).digest('hex'),
  };
}

// DATA_ENCRYPTION_KEY in production; a per-install key file in development; random for in-memory tests.
function loadDataKey(config, log = console) {
  if (config.dataKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(config.dataKey)) throw new Error('DATA_ENCRYPTION_KEY must be 64 hex characters');
    return Buffer.from(config.dataKey, 'hex');
  }
  if (config.nodeEnv === 'production') throw new Error('DATA_ENCRYPTION_KEY is required in production');
  if (!config.databaseUrl && (!config.pgliteDir || config.pgliteDir === ':memory:')) return crypto.randomBytes(32);
  const file = path.join(config.dataDir || path.join(__dirname, '..', '..', 'data'), 'dev-data.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    log.warn(`[security] created development data key at ${file}; set DATA_ENCRYPTION_KEY in production`);
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

module.exports = { createSecretBox, loadDataKey };
