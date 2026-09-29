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

  api.post('/auth/register', authLimit, async (req, res) => {
    const username = String(req.body.username ?? '').trim();
    const password = String(req.body.password ?? '');
    const displayName = String(req.body.displayName ?? '').trim().slice(0, 40) || username;
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw bad('invalid_username');
    if (password.length < 8 || password.length > 200) throw bad('weak_password');
    // The unique index on lower(username) settles a race between two identical sign-ups.
    const row = await db.one(
      'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id',
      [username, displayName, hashPassword(password), Date.now()]
    );
    if (!row) throw conflict('username_taken');
    const id = row.id;
    await security.event(id, 'registered', req);
    await auth.login(res, id);
    res.status(201).json({ id, username, displayName, role: 'user' });
  });

  // Step 1: password. Returns the user, or { twoFactor: true, challenge } when an authenticator is on.
  api.post('/auth/login', authLimit, async (req, res) => {
    const r = await security.passwordLogin(req.body.username, req.body.password, req);
    if (r.challenge) return res.json({ twoFactor: true, challenge: r.challenge });
    await auth.login(res, r.user.id);
    res.json(loginResponse(r.user));
  });

  // Step 2: authenticator code or a backup code.
  api.post('/auth/login/2fa', authLimit, async (req, res) => {
    const user = await security.secondFactorLogin(req.body.challenge, req.body.code, req);
    await auth.login(res, user.id);
    res.json(loginResponse(user));
  });

  api.post('/auth/logout', async (req, res) => {
    await auth.logout(req, res);
    res.json({ ok: true });
  });

  api.get('/me', u, async (req, res) => {
    const s = await security.summary(req.user.id);
    res.json({
      ...req.user, ...(await market.stats(req.user.id)),
      phone: s.phone, phoneVerified: s.phoneVerified, totpEnabled: s.totpEnabled, kyc: await kyc.status(req.user.id),
    });
  });

  // ---------- security settings ----------
  api.get('/me/security', u, async (req, res) => res.json(await security.summary(req.user.id)));
  api.post('/me/phone', u, codeLimit, async (req, res) => res.json(await security.startPhoneVerification(req.user.id, req.body.phone, req)));
  api.post('/me/phone/verify', u, codeLimit, async (req, res) => res.json(await security.confirmPhone(req.user.id, req.body.code, req)));
  api.post('/me/totp/setup', u, async (req, res) => res.json(await security.beginTotp(req.user.id)));
  api.post('/me/totp/enable', u, codeLimit, async (req, res) =>
    res.json({ backupCodes: await security.confirmTotp(req.user.id, req.body.code, req.sessionToken, req) })
  );
  api.post('/me/totp/disable', u, codeLimit, async (req, res) => {
    await security.disableTotp(req.user.id, req.body.code, req);
    res.json({ ok: true });
  });
  api.post('/me/totp/backup-codes', u, codeLimit, async (req, res) => {
    if (!(await security.verifySecondFactor(req.user.id, req.body.code, req, { allowBackup: false }))) throw bad('invalid_code');
    res.json({ backupCodes: await security.regenerateBackupCodes(req.user.id) });
  });
  api.post('/me/password', u, codeLimit, async (req, res) => {
    await security.changePassword(req.user.id, req.body.current, req.body.next, req.sessionToken, req);
    res.json({ ok: true });
  });

  // ---------- identity verification ----------
  api.get('/kyc', u, async (req, res) => res.json(await kyc.status(req.user.id)));
  api.post('/kyc/submission', u, async (req, res) => res.status(201).json(await kyc.startSubmission(req.user.id, req.body)));
  api.post(
    '/kyc/submission/:id/files/:kind',
    u,
    rateLimit({ windowMs: 60 * 60_000, max: 30 }),
    express.raw({ type: 'image/*', limit: '5mb' }),
    async (req, res) => res.json(await kyc.addFile(req.user.id, ctx.id(req), req.params.kind, req.body))
  );
  api.post('/kyc/submission/:id/submit', u, async (req, res) => res.json(await kyc.submit(req.user.id, ctx.id(req))));

}

module.exports = { accountRoutes };
