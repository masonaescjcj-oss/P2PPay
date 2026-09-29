'use strict';

// Account security: phone verification and one-time SMS codes, authenticator-app 2FA with backup
// codes, two-step login challenges, login lockout, password changes and a per-user security log.
// Attempt counters are updated with single conditional statements, never read-then-write, so
// parallel guesses cannot exceed the limits. Code checks run outside transactions so a failed
// attempt is always recorded.
const crypto = require('node:crypto');
const totp = require('./totp');
const { bad, forbidden, conflict, ApiError } = require('../errors');
const { hashPassword, verifyPassword } = require('../auth');

const MIN = 60_000;
const OTP_TTL = 5 * MIN;
const OTP_RESEND = MIN;
const OTP_MAX_ATTEMPTS = 5;
const CHALLENGE_TTL = 5 * MIN;
const CHALLENGE_MAX_ATTEMPTS = 5;
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
  const getUser = (id) => db.one('SELECT * FROM users WHERE id = ?', [id]);

  const event = (userId, kind, req) =>
    db.run('INSERT INTO security_events (user_id, kind, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?)', [
      userId, kind, req?.ip ?? null, String(req?.headers?.['user-agent'] ?? '').slice(0, 200) || null, now(),
    ]);

  async function authFailure(userId, kind, req) {
    await event(userId, kind, req);
    await alerts?.onAuthFailure(userId);
  }

  // ---------- one-time SMS codes ----------
  const codeHash = (userId, purpose, code) => box.mac(`${purpose}:${userId}:${code}`);
  const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  async function sendCode(userId, purpose, phone, req) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.tx(async () => {
      // One sender per user and purpose at a time, so the resend limit cannot be raced.
      await db.run('SELECT pg_advisory_xact_lock(?, ?)', [9003, userId]);
      const last = await db.one('SELECT created_at FROM otp_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1', [userId, purpose]);
      if (last && now() - last.created_at < (config.otpResendMs ?? OTP_RESEND)) throw new ApiError(429, 'code_recently_sent');
      await db.run(
        'INSERT INTO otp_codes (user_id, purpose, target, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, purpose, phone, codeHash(userId, purpose, code), now() + OTP_TTL, now()]
      );
    });
    await sms(phone, `${config.appName || 'P2PPay'}: کد تأیید شما ${code} — این کد را به هیچ‌کس ندهید. / Your code: ${code}`);
    await event(userId, `code_sent_${purpose}`, req);
  }

  // Consumes the latest unused code for this purpose; returns its row (with target) or throws.
  async function checkCode(userId, purpose, code, req) {
    const latest = await db.one(
      'SELECT id FROM otp_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
      [userId, purpose]
    );
    // Reserve an attempt first; this fails once the limit is reached, even under parallel requests.
    const row = latest && (await db.one(
      'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND expires_at >= ? AND used_at IS NULL RETURNING *',
      [latest.id, OTP_MAX_ATTEMPTS, now()]
    ));
    if (!row) throw bad('code_expired');
    const given = String(code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(given) || !sameHash(codeHash(userId, purpose, given), row.code_hash)) {
      await authFailure(userId, `code_failed_${purpose}`, req);
      throw bad('invalid_code');
    }
    const used = await db.run('UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [now(), row.id]);
    if (used.rowCount !== 1) throw bad('code_expired'); // a parallel request used it first
    return row;
  }

  // ---------- phone verification (KYC tier 1) ----------
  async function startPhoneVerification(userId, phoneInput, req) {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw bad('invalid_phone');
    const taken = await db.one('SELECT 1 FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id != ?', [phone, userId]);
    if (taken) throw conflict('phone_in_use');
    await sendCode(userId, 'phone', phone, req);
    return { phone };
  }

  async function confirmPhone(userId, code, req) {
    const row = await checkCode(userId, 'phone', code, req);
    return db.tx(async () => {
      const taken = await db.one('SELECT 1 FROM users WHERE phone = ? AND phone_verified_at IS NOT NULL AND id != ?', [row.target, userId]);
      if (taken) throw conflict('phone_in_use');
      // The partial unique index users_verified_phone rejects a parallel verification of the same number.
      await db.run('UPDATE users SET phone = ?, phone_verified_at = ?, kyc_tier = GREATEST(kyc_tier, 1) WHERE id = ?', [row.target, now(), userId]);
      await event(userId, 'phone_verified', req);
      return { phone: row.target };
    });
  }

  // ---------- authenticator app (TOTP) ----------
  const secretOf = (enc) => box.open(Buffer.from(enc, 'base64')).toString('utf8');
  const seal = (s) => box.seal(s).toString('base64');

  async function beginTotp(userId) {
    const u = await getUser(userId);
    if (u.totp_enabled_at) throw conflict('totp_already_enabled');
    const secret = totp.generateSecret();
    await db.run('UPDATE users SET totp_pending = ? WHERE id = ? AND totp_enabled_at IS NULL', [seal(secret), userId]);
    return { secret, uri: totp.otpauthUri(secret, u.username, config.appName || 'P2PPay') };
  }

  // A code is accepted once: the step only moves forward, so a replay (even a parallel one) fails.
  async function useTotp(u, code) {
    const step = totp.verifyTotp(secretOf(u.totp_secret), code, { lastStep: u.totp_last_step });
    if (step === null) return false;
    const r = await db.run(
      'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
      [step, u.id, step]
    );
    return r.rowCount === 1;
  }

  async function useBackupCode(u, code) {
    const c = String(code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (c.length !== 10) return false;
    const r = await db.run('UPDATE backup_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [
      now(), u.id, box.mac(`backup:${u.id}:${c}`),
    ]);
    return r.rowCount === 1;
  }

  function newBackupCodes(userId) {
    return db.tx(async () => {
      await db.run('DELETE FROM backup_codes WHERE user_id = ?', [userId]);
      const codes = [];
      for (let i = 0; i < 10; i++) {
        const c = crypto.randomBytes(5).toString('hex');
        await db.run('INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)', [userId, box.mac(`backup:${userId}:${c}`)]);
        codes.push(`${c.slice(0, 5)}-${c.slice(5)}`);
      }
      return codes;
    });
  }

  // Enables 2FA; returns the one-time backup codes. Other sessions are signed out.
  async function confirmTotp(userId, code, currentToken, req) {
    const u = await getUser(userId);
    if (!u.totp_pending) throw bad('totp_not_started');
    const step = totp.verifyTotp(secretOf(u.totp_pending), code);
    if (step === null) {
      await authFailure(userId, 'totp_failed', req);
      throw bad('invalid_code');
    }
    return db.tx(async () => {
      const r = await db.run(
        `UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = ?, totp_last_step = ?
         WHERE id = ? AND totp_pending = ? AND totp_enabled_at IS NULL`,
        [now(), step, userId, u.totp_pending]
      );
      if (r.rowCount !== 1) throw conflict('totp_already_enabled');
      await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [userId, currentToken ?? '']);
      await event(userId, 'totp_enabled', req);
      return newBackupCodes(userId);
    });
  }

  // TOTP code, or (when allowed) a one-time backup code.
  async function verifySecondFactor(userId, code, req, { allowBackup = true } = {}) {
    const u = await getUser(userId);
    if (!u.totp_enabled_at) return false;
    if ((await useTotp(u, code)) || (allowBackup && (await useBackupCode(u, code)))) return true;
    await authFailure(userId, 'totp_failed', req);
    return false;
  }

  async function disableTotp(userId, code, req) {
    const u = await getUser(userId);
    if (!u.totp_enabled_at) throw bad('totp_not_enabled');
    if (u.role !== 'user' && config.requireStaff2fa) throw forbidden('staff_2fa_required');
    if (!(await verifySecondFactor(userId, code, req))) throw bad('invalid_code');
    await db.tx(async () => {
      await db.run('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL WHERE id = ?', [userId]);
      await db.run('DELETE FROM backup_codes WHERE user_id = ?', [userId]);
      await event(userId, 'totp_disabled', req);
    });
  }

  // ---------- login ----------
  const challengeHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

  // Wrong passwords and wrong 2FA codes share one counter; LOCK_AFTER failures lock the account.
  async function countLoginFailure(userId) {
    const r = await db.one(
      `UPDATE users SET
         failed_logins = CASE WHEN failed_logins + 1 >= ? THEN 0 ELSE failed_logins + 1 END,
         locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
       WHERE id = ? RETURNING locked_until`,
      [LOCK_AFTER, LOCK_AFTER, now() + LOCK_FOR, userId]
    );
    return r.locked_until > now();
  }

  const findByUsername = (username) =>
    db.one('SELECT * FROM users WHERE lower(username) = lower(?)', [String(username ?? '').trim()]);

  // Checks password and lockout. Returns { user } or { challenge } when a second factor is needed.
  async function passwordLogin(username, password, req) {
    const user = await findByUsername(username);
    if (!user) {
      verifyPassword(String(password ?? ''), 'scrypt$00$00'); // similar timing for unknown users
      throw new ApiError(401, 'invalid_credentials');
    }
    if (user.locked_until > now()) throw new ApiError(429, 'account_locked');
    if (!verifyPassword(String(password ?? ''), user.password_hash)) {
      const locked = await countLoginFailure(user.id);
      await authFailure(user.id, 'login_failed', req);
      throw new ApiError(401, locked ? 'account_locked' : 'invalid_credentials');
    }
    if (user.is_blocked) throw new ApiError(403, 'account_blocked');
    if (user.totp_enabled_at) {
      const token = crypto.randomBytes(32).toString('base64url');
      await db.run('INSERT INTO login_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
        challengeHash(token), user.id, now() + CHALLENGE_TTL,
      ]);
      return { challenge: token };
    }
    await db.run('UPDATE users SET failed_logins = 0 WHERE id = ?', [user.id]);
    await event(user.id, 'login', req);
    return { user };
  }

  async function secondFactorLogin(token, code, req) {
    const h = challengeHash(String(token ?? ''));
    // Reserve an attempt on the challenge up front (atomic), then check the code.
    const ch = await db.one(
      'UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ? AND attempts < ? AND expires_at >= ? RETURNING *',
      [h, CHALLENGE_MAX_ATTEMPTS, now()]
    );
    if (!ch) throw new ApiError(401, 'challenge_expired');
    const pending = await getUser(ch.user_id);
    if (pending.locked_until > now()) throw new ApiError(429, 'account_locked');
    if (!(await verifySecondFactor(ch.user_id, code, req))) {
      const locked = await countLoginFailure(ch.user_id);
      if (locked) await db.run('DELETE FROM login_challenges WHERE user_id = ?', [ch.user_id]);
      throw new ApiError(401, locked ? 'account_locked' : 'invalid_code');
    }
    const used = await db.run('DELETE FROM login_challenges WHERE token_hash = ?', [h]);
    if (used.rowCount !== 1) throw new ApiError(401, 'challenge_expired');
    await db.run('UPDATE users SET failed_logins = 0 WHERE id = ?', [ch.user_id]);
    const user = await getUser(ch.user_id);
    if (user.is_blocked) throw new ApiError(403, 'account_blocked');
    await event(user.id, 'login', req);
    return user;
  }

  async function changePassword(userId, current, next, currentToken, req) {
    const u = await getUser(userId);
    if (!verifyPassword(String(current ?? ''), u.password_hash)) {
      await authFailure(userId, 'password_change_failed', req);
      throw bad('invalid_password');
    }
    const p = String(next ?? '');
    if (p.length < 8 || p.length > 200) throw bad('weak_password');
    await db.tx(async () => {
      await db.run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [hashPassword(p), now(), userId]);
      await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [userId, currentToken ?? '']);
      await event(userId, 'password_changed', req);
    });
  }

  // ---------- withdrawals ----------
  // Every withdrawal needs a fresh second factor: the authenticator app if enabled, else an SMS code.
  async function sendWithdrawalCode(userId, req) {
    const u = await getUser(userId);
    if (u.totp_enabled_at) throw bad('use_authenticator');
    if (!u.phone_verified_at) throw forbidden('verification_required');
    await sendCode(userId, 'withdraw', u.phone, req);
  }

  async function checkWithdrawalCode(userId, code, req) {
    const u = await getUser(userId);
    if (u.totp_enabled_at) {
      if (!(await verifySecondFactor(userId, code, req, { allowBackup: false }))) throw bad('invalid_code');
      return;
    }
    if (!u.phone_verified_at) throw forbidden('verification_required');
    await checkCode(userId, 'withdraw', code, req);
  }

  async function summary(userId) {
    const u = await getUser(userId);
    const left = await db.one('SELECT COUNT(*) n FROM backup_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
    const events = await db.query(
      'SELECT kind, ip, user_agent AS "userAgent", created_at AS "createdAt" FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT 20',
      [userId]
    );
    return {
      phone: u.phone,
      phoneVerified: !!u.phone_verified_at,
      totpEnabled: !!u.totp_enabled_at,
      backupCodesLeft: left.n,
      events,
    };
  }

  void log;
  return {
    event, normalizePhone, findByUsername, startPhoneVerification, confirmPhone, beginTotp, confirmTotp, disableTotp,
    verifySecondFactor, passwordLogin, secondFactorLogin, changePassword, sendWithdrawalCode,
    checkWithdrawalCode, summary, regenerateBackupCodes: newBackupCodes,
  };
}

module.exports = { createSecurity, normalizePhone };
