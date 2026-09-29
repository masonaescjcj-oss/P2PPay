'use strict';

// Account security: phone verification and one-time SMS codes, authenticator-app 2FA with backup
// codes, two-step login challenges, login lockout, password changes and a per-user security log.
const crypto = require('node:crypto');
const totp = require('./totp');
const { bad, forbidden, conflict, ApiError } = require('../errors');
const { hashPassword, verifyPassword } = require('../auth');

const MIN = 60_000;
const OTP_TTL = 5 * MIN;
const OTP_RESEND = MIN;
const OTP_MAX_ATTEMPTS = 5;
const CHALLENGE_TTL = 5 * MIN;
const LOCK_AFTER = 8;
const LOCK_FOR = 15 * MIN;

// E.164; Afghan local numbers (07xxxxxxxx) become +937xxxxxxxx.
function normalizePhone(input) {
  let p = String(input ?? '').replace(/[\s()-]/g, '');
  p = p.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (/^07\d{8}$/.test(p)) p = '+93' + p.slice(1);
  if (/^0093\d+$/.test(p)) p = '+' + p.slice(2);
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

function createSecurity(db, config, { box, sms, alerts, log = console }) {
  const now = () => Date.now();
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

  function event(userId, kind, req) {
    db.prepare('INSERT INTO security_events (user_id, kind, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId, kind, req?.ip ?? null, String(req?.headers?.['user-agent'] ?? '').slice(0, 200) || null, now()
    );
  }

  function authFailure(userId, kind, req) {
    event(userId, kind, req);
    alerts?.onAuthFailure(userId);
  }

  // ---------- one-time SMS codes ----------
  const codeHash = (userId, purpose, code) => box.mac(`${purpose}:${userId}:${code}`);

  async function sendCode(userId, purpose, phone, req) {
    const last = db.prepare('SELECT created_at FROM otp_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(userId, purpose);
    if (last && now() - last.created_at < (config.otpResendMs ?? OTP_RESEND)) throw new ApiError(429, 'code_recently_sent');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare(
      'INSERT INTO otp_codes (user_id, purpose, target, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, purpose, phone, codeHash(userId, purpose, code), now() + OTP_TTL, now());
    await sms(phone, `P2PPay: کد تأیید شما ${code} — این کد را به هیچ‌کس ندهید. / Your code: ${code}`);
    event(userId, `code_sent_${purpose}`, req);
  }

  // Consumes the latest unused code for this purpose; returns its row (with target) or throws.
  function checkCode(userId, purpose, code, req) {
    const row = db
      .prepare('SELECT * FROM otp_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(userId, purpose);
    if (!row || row.expires_at < now() || row.attempts >= OTP_MAX_ATTEMPTS) throw bad('code_expired');
    const given = String(code ?? '').replace(/\s/g, '');
    const ok = /^\d{6}$/.test(given) && crypto.timingSafeEqual(Buffer.from(codeHash(userId, purpose, given)), Buffer.from(row.code_hash));
    if (!ok) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      authFailure(userId, `code_failed_${purpose}`, req);
      throw bad('invalid_code');
    }
    db.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(now(), row.id);
    return row;
  }

  // ---------- phone verification (KYC tier 1) ----------
  async function startPhoneVerification(userId, phoneInput, req) {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw bad('invalid_phone');
    const taken = db.prepare('SELECT 1 FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id != ?').get(phone, userId);
    if (taken) throw conflict('phone_in_use');
    await sendCode(userId, 'phone', phone, req);
    return { phone };
  }

  function confirmPhone(userId, code, req) {
    // Check the code outside the transaction so a failed attempt is always counted.
    const row = checkCode(userId, 'phone', code, req);
    return db.tx(() => {
      const taken = db.prepare('SELECT 1 FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id != ?').get(row.target, userId);
      if (taken) throw conflict('phone_in_use');
      db.prepare('UPDATE users SET phone = ?, phone_verified_at = ?, kyc_tier = MAX(kyc_tier, 1) WHERE id = ?').run(row.target, now(), userId);
      event(userId, 'phone_verified', req);
      return { phone: row.target };
    });
  }

  // ---------- authenticator app (TOTP) ----------
  const secretOf = (enc) => box.open(Buffer.from(enc, 'base64')).toString('utf8');
  const seal = (s) => box.seal(s).toString('base64');

  function beginTotp(userId) {
    const u = getUser.get(userId);
    if (u.totp_enabled_at) throw conflict('totp_already_enabled');
    const secret = totp.generateSecret();
    db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(seal(secret), userId);
    return { secret, uri: totp.otpauthUri(secret, u.username) };
  }

  function useTotp(u, code) {
    const step = totp.verifyTotp(secretOf(u.totp_secret), code, { lastStep: u.totp_last_step });
    if (step === null) return false;
    db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, u.id);
    return true;
  }

  function useBackupCode(u, code) {
    const c = String(code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (c.length !== 10) return false;
    const r = db.prepare('UPDATE backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
      .run(now(), u.id, box.mac(`backup:${u.id}:${c}`));
    return r.changes === 1;
  }

  function newBackupCodes(userId) {
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').run(userId);
    const codes = [];
    for (let i = 0; i < 10; i++) {
      const c = crypto.randomBytes(5).toString('hex');
      db.prepare('INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)').run(userId, box.mac(`backup:${userId}:${c}`));
      codes.push(`${c.slice(0, 5)}-${c.slice(5)}`);
    }
    return codes;
  }

  // Enables 2FA; returns the one-time backup codes. Other sessions are signed out.
  function confirmTotp(userId, code, currentToken, req) {
    const u = getUser.get(userId);
    if (!u.totp_pending) throw bad('totp_not_started');
    const step = totp.verifyTotp(secretOf(u.totp_pending), code);
    if (step === null) {
      authFailure(userId, 'totp_failed', req); // recorded outside any transaction
      throw bad('invalid_code');
    }
    return db.tx(() => {
      db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = ?, totp_last_step = ? WHERE id = ?')
        .run(now(), step, userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, currentToken ?? '');
      event(userId, 'totp_enabled', req);
      return newBackupCodes(userId);
    });
  }

  // TOTP code, or (when allowed) a one-time backup code.
  function verifySecondFactor(userId, code, req, { allowBackup = true } = {}) {
    const u = getUser.get(userId);
    if (!u.totp_enabled_at) return false;
    if (useTotp(u, code) || (allowBackup && useBackupCode(u, code))) return true;
    authFailure(userId, 'totp_failed', req);
    return false;
  }

  function disableTotp(userId, code, req) {
    const u = getUser.get(userId);
    if (!u.totp_enabled_at) throw bad('totp_not_enabled');
    if (u.role !== 'user' && config.requireStaff2fa) throw forbidden('staff_2fa_required');
    if (!verifySecondFactor(userId, code, req)) throw bad('invalid_code');
    db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL WHERE id = ?').run(userId);
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').run(userId);
    event(userId, 'totp_disabled', req);
  }

  // ---------- login ----------
  const challengeHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

  // Wrong passwords and wrong 2FA codes share one counter; LOCK_AFTER failures lock the account.
  function countLoginFailure(user) {
    const fails = (db.prepare('SELECT failed_logins FROM users WHERE id = ?').get(user.id)?.failed_logins ?? 0) + 1;
    const lock = fails >= LOCK_AFTER;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock ? now() + LOCK_FOR : 0, user.id);
    return lock;
  }

  // Checks password and lockout. Returns { user } or { challenge } when a second factor is needed.
  function passwordLogin(username, password, req) {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim());
    if (!user) {
      verifyPassword(String(password ?? ''), 'scrypt$00$00'); // similar timing for unknown users
      throw new ApiError(401, 'invalid_credentials');
    }
    if (user.locked_until > now()) throw new ApiError(429, 'account_locked');
    if (!verifyPassword(String(password ?? ''), user.password_hash)) {
      const locked = countLoginFailure(user);
      authFailure(user.id, 'login_failed', req);
      throw new ApiError(401, locked ? 'account_locked' : 'invalid_credentials');
    }
    if (user.is_blocked) throw new ApiError(403, 'account_blocked');
    if (user.totp_enabled_at) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(challengeHash(token), user.id, now() + CHALLENGE_TTL);
      return { challenge: token };
    }
    db.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').run(user.id);
    event(user.id, 'login', req);
    return { user };
  }

  function secondFactorLogin(token, code, req) {
    const h = challengeHash(String(token ?? ''));
    const ch = db.prepare('SELECT * FROM login_challenges WHERE token_hash = ?').get(h);
    if (!ch || ch.expires_at < now() || ch.attempts >= 5) throw new ApiError(401, 'challenge_expired');
    const pending = getUser.get(ch.user_id);
    if (pending.locked_until > now()) throw new ApiError(429, 'account_locked');
    if (!verifySecondFactor(ch.user_id, code, req)) {
      db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?').run(h);
      const locked = countLoginFailure(pending);
      if (locked) db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(ch.user_id);
      throw new ApiError(401, locked ? 'account_locked' : 'invalid_code');
    }
    db.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').run(ch.user_id);
    db.prepare('DELETE FROM login_challenges WHERE token_hash = ?').run(h);
    const user = getUser.get(ch.user_id);
    if (user.is_blocked) throw new ApiError(403, 'account_blocked');
    event(user.id, 'login', req);
    return user;
  }

  function changePassword(userId, current, next, currentToken, req) {
    const u = getUser.get(userId);
    if (!verifyPassword(String(current ?? ''), u.password_hash)) {
      authFailure(userId, 'password_change_failed', req);
      throw bad('invalid_password');
    }
    const p = String(next ?? '');
    if (p.length < 8 || p.length > 200) throw bad('weak_password');
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hashPassword(p), now(), userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, currentToken ?? '');
    event(userId, 'password_changed', req);
  }

  // ---------- withdrawals ----------
  // Every withdrawal needs a fresh second factor: the authenticator app if enabled, else an SMS code.
  async function sendWithdrawalCode(userId, req) {
    const u = getUser.get(userId);
    if (u.totp_enabled_at) throw bad('use_authenticator');
    if (!u.phone_verified_at) throw forbidden('verification_required');
    await sendCode(userId, 'withdraw', u.phone, req);
  }

  function checkWithdrawalCode(userId, code, req) {
    const u = getUser.get(userId);
    if (u.totp_enabled_at) {
      if (!verifySecondFactor(userId, code, req, { allowBackup: false })) throw bad('invalid_code');
      return;
    }
    if (!u.phone_verified_at) throw forbidden('verification_required');
    checkCode(userId, 'withdraw', code, req);
  }

  function summary(userId) {
    const u = getUser.get(userId);
    return {
      phone: u.phone,
      phoneVerified: !!u.phone_verified_at,
      totpEnabled: !!u.totp_enabled_at,
      backupCodesLeft: db.prepare('SELECT COUNT(*) n FROM backup_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n,
      events: db
        .prepare('SELECT kind, ip, user_agent AS userAgent, created_at AS createdAt FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT 20')
        .all(userId)
        .map((r) => ({ ...r })),
    };
  }

  void log;
  return {
    event, normalizePhone, startPhoneVerification, confirmPhone, beginTotp, confirmTotp, disableTotp,
    verifySecondFactor, passwordLogin, secondFactorLogin, changePassword, sendWithdrawalCode,
    checkWithdrawalCode, summary, regenerateBackupCodes: newBackupCodes,
  };
}

module.exports = { createSecurity, normalizePhone };
