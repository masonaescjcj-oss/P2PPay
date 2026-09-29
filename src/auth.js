'use strict';

const crypto = require('node:crypto');
const { ApiError, forbidden } = require('./errors');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(db, config) {
  const COOKIE = 'p2ppay_session';
  const ttl = config.sessionDays * 86400_000;

  const insertSession = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
  const findSession = db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_blocked, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  );
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');

  function cookieHeader(token, maxAgeSec) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (config.cookieSecure) parts.push('Secure');
    return parts.join('; ');
  }

  function login(res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    insertSession.run(token, userId, Date.now() + ttl);
    res.setHeader('Set-Cookie', cookieHeader(token, Math.floor(ttl / 1000)));
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) deleteSession.run(token);
    res.setHeader('Set-Cookie', cookieHeader('', 0));
  }

  // Attaches req.user when a valid session cookie is present.
  function session(req, _res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const row = findSession.get(token);
      if (row && row.expires_at > Date.now() && !row.is_blocked) {
        req.user = { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
      } else if (row) {
        deleteSession.run(token);
      }
    }
    next();
  }

  const requireUser = (req, _res, next) =>
    next(req.user ? undefined : new ApiError(401, 'unauthorized'));
  const requireAdmin = (req, _res, next) =>
    next(!req.user ? new ApiError(401, 'unauthorized') : req.user.role !== 'admin' ? forbidden() : undefined);

  return { login, logout, session, requireUser, requireAdmin };
}

// Tiny fixed-window rate limiter keyed by IP + route (in-memory, per process).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = `${req.ip}:${req.path}`;
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) hits.set(key, { n: 1, reset: t + windowMs });
    else if (++h.n > max) return next(new ApiError(429, 'too_many_requests'));
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    next();
  };
}

module.exports = { hashPassword, verifyPassword, createAuth, rateLimit };
