'use strict';

// Sign-up/login (with the 2FA step), the user's security settings and identity verification.
const express = require('express');
const { bad, conflict } = require('../errors');
const { hashPassword, rateLimit } = require('../auth');

function accountRoutes(api, ctx) {
  const { db, auth, security, kyc, market, u } = ctx;
  const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 20 });
  const codeLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });
  const loginResponse = (user) => ({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });

  api.post('/auth/register', authLimit, (req, res) => {
    const username = String(req.body.username ?? '').trim();
    const password = String(req.body.password ?? '');
    const displayName = String(req.body.displayName ?? '').trim().slice(0, 40) || username;
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw bad('invalid_username');
    if (password.length < 8 || password.length > 200) throw bad('weak_password');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('username_taken');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(username, displayName, hashPassword(password), Date.now());
    const id = Number(lastInsertRowid);
    security.event(id, 'registered', req);
    auth.login(res, id);
    res.status(201).json({ id, username, displayName, role: 'user' });
  });

  // Step 1: password. Returns the user, or { twoFactor: true, challenge } when an authenticator is on.
  api.post('/auth/login', authLimit, (req, res) => {
    const r = security.passwordLogin(req.body.username, req.body.password, req);
    if (r.challenge) return res.json({ twoFactor: true, challenge: r.challenge });
    auth.login(res, r.user.id);
    res.json(loginResponse(r.user));
  });

  // Step 2: authenticator code or a backup code.
  api.post('/auth/login/2fa', authLimit, (req, res) => {
    const user = security.secondFactorLogin(req.body.challenge, req.body.code, req);
    auth.login(res, user.id);
    res.json(loginResponse(user));
  });

  api.post('/auth/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });

  api.get('/me', u, (req, res) => {
    const s = security.summary(req.user.id);
    res.json({
      ...req.user, ...market.stats(req.user.id),
      phone: s.phone, phoneVerified: s.phoneVerified, totpEnabled: s.totpEnabled, kyc: kyc.status(req.user.id),
    });
  });

  // ---------- security settings ----------
  api.get('/me/security', u, (req, res) => res.json(security.summary(req.user.id)));
  api.post('/me/phone', u, codeLimit, async (req, res) => res.json(await security.startPhoneVerification(req.user.id, req.body.phone, req)));
  api.post('/me/phone/verify', u, codeLimit, (req, res) => res.json(security.confirmPhone(req.user.id, req.body.code, req)));
  api.post('/me/totp/setup', u, (req, res) => res.json(security.beginTotp(req.user.id)));
  api.post('/me/totp/enable', u, codeLimit, (req, res) =>
    res.json({ backupCodes: security.confirmTotp(req.user.id, req.body.code, req.sessionToken, req) })
  );
  api.post('/me/totp/disable', u, codeLimit, (req, res) => {
    security.disableTotp(req.user.id, req.body.code, req);
    res.json({ ok: true });
  });
  api.post('/me/totp/backup-codes', u, codeLimit, (req, res) => {
    if (!security.verifySecondFactor(req.user.id, req.body.code, req, { allowBackup: false })) throw bad('invalid_code');
    res.json({ backupCodes: db.tx(() => security.regenerateBackupCodes(req.user.id)) });
  });
  api.post('/me/password', u, codeLimit, (req, res) => {
    security.changePassword(req.user.id, req.body.current, req.body.next, req.sessionToken, req);
    res.json({ ok: true });
  });

  // ---------- identity verification ----------
  api.get('/kyc', u, (req, res) => res.json(kyc.status(req.user.id)));
  api.post('/kyc/submission', u, (req, res) => res.status(201).json(kyc.startSubmission(req.user.id, req.body)));
  api.post(
    '/kyc/submission/:id/files/:kind',
    u,
    rateLimit({ windowMs: 60 * 60_000, max: 30 }),
    express.raw({ type: 'image/*', limit: '5mb' }),
    (req, res) => res.json(kyc.addFile(req.user.id, ctx.id(req), req.params.kind, req.body))
  );
  api.post('/kyc/submission/:id/submit', u, (req, res) => res.json(kyc.submit(req.user.id, ctx.id(req))));

}

module.exports = { accountRoutes };
