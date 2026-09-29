'use strict';

const { bad, forbidden, notFound, conflict } = require('./errors');
const m = require('./money');

const { isAddress } = require('./tron/keys');
const TXID = /^(0x)?[0-9a-fA-F]{64}$/;

// Deposits and withdrawals are reviewed by an admin, who checks the Tron chain
// (e.g. on tronscan.org) before approving. Hook an on-chain watcher in here later.
// isBlockedAddress: addresses users may not withdraw to (the platform's own wallets).
// beforeWithdraw(userId, amount): throws when limits forbid it; onWithdrawal(userId, amount, address): after.
function createFunds(db, wallet, config, { isBlockedAddress, beforeWithdraw, onWithdrawal } = {}) {
  const now = () => Date.now();

  const depView = (d) => ({
    id: d.id, userId: d.user_id, username: d.username, amount: m.fmtUsdt(d.amount), network: d.network,
    txid: d.txid, address: d.address ?? null, source: d.source ?? 'manual', status: d.status, note: d.note, createdAt: d.created_at, reviewedAt: d.reviewed_at,
  });
  const wdView = (w) => ({
    id: w.id, userId: w.user_id, username: w.username, amount: m.fmtUsdt(w.amount), fee: m.fmtUsdt(w.fee),
    network: w.network, address: w.address, status: w.status, txid: w.txid, note: w.note,
    auto: !!w.auto, attempts: w.attempts ?? 0,
    createdAt: w.created_at, reviewedAt: w.reviewed_at,
  });

  function requestDeposit(userId, input) {
    const amount = m.parseUsdt(input.amount);
    if (!amount) throw bad('invalid_amount');
    const txid = String(input.txid ?? '').trim().replace(/^0x/i, '').toLowerCase();
    if (!TXID.test(txid)) throw bad('invalid_txid');
    if (db.prepare('SELECT 1 FROM deposits WHERE txid = ?').get(txid)) throw conflict('duplicate_txid');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO deposits (user_id, amount, network, txid, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, amount, config.network, txid, now());
    return depView(db.prepare('SELECT * FROM deposits WHERE id = ?').get(lastInsertRowid));
  }

  function reviewDeposit(id, approve, input = {}, actorId = null) {
    return db.tx(() => {
      const d = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
      if (!d) throw notFound();
      if (d.user_id === actorId) throw forbidden('own_request');
      if (d.status !== 'pending') throw conflict('already_reviewed');
      // Admin may correct the amount to what actually arrived on-chain.
      const amount = input.amount !== undefined && input.amount !== '' ? m.parseUsdt(input.amount) : d.amount;
      if (approve && !amount) throw bad('invalid_amount');
      db.prepare('UPDATE deposits SET status = ?, amount = ?, note = ?, reviewed_at = ? WHERE id = ?').run(
        approve ? 'approved' : 'rejected', amount || d.amount, input.note ? String(input.note).slice(0, 500) : null,
        now(), d.id
      );
      if (approve) wallet.credit(d.user_id, amount, 'deposit', { type: 'deposit', id: d.id });
      return depView(db.prepare('SELECT * FROM deposits WHERE id = ?').get(d.id));
    });
  }

  // Input checks only (no balance or limits), so bad input is reported before a security code is spent.
  function validateWithdrawal(input) {
    const amount = m.parseUsdt(input.amount);
    if (!amount) throw bad('invalid_amount');
    if (amount < config.minWithdrawMicro) throw bad('below_minimum');
    const address = String(input.address ?? '').trim();
    if (!isAddress(address) || (isBlockedAddress && isBlockedAddress(address))) throw bad('invalid_address');
    return { amount, address };
  }

  function requestWithdrawal(userId, input) {
    const { amount, address } = validateWithdrawal(input);
    const fee = config.withdrawFeeMicro;
    return db.tx(() => {
      beforeWithdraw?.(userId, amount);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO withdrawals (user_id, amount, fee, network, address, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, amount, fee, config.network, address, now());
      const id = Number(lastInsertRowid);
      wallet.lock(userId, amount + fee, 'withdraw_lock', { type: 'withdrawal', id });
      onWithdrawal?.(userId, amount, address);
      return wdView(db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id));
    });
  }

  function reviewWithdrawal(id, approve, input = {}, actorId = null) {
    return db.tx(() => {
      const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
      if (!w) throw notFound();
      if (w.user_id === actorId) throw forbidden('own_request');
      if (w.status !== 'pending' && w.status !== 'failed') throw conflict('already_reviewed');
      const ref = { type: 'withdrawal', id: w.id };
      let txid = null;
      if (approve) {
        txid = String(input.txid ?? '').trim().replace(/^0x/i, '').toLowerCase();
        if (!TXID.test(txid)) throw bad('invalid_txid');
        wallet.burnLocked(w.user_id, w.amount + w.fee, 'withdrawal', ref);
      } else {
        wallet.unlock(w.user_id, w.amount + w.fee, 'withdraw_refund', ref);
      }
      db.prepare('UPDATE withdrawals SET status = ?, txid = ?, note = ?, reviewed_at = ? WHERE id = ?').run(
        approve ? 'sent' : 'rejected', txid, input.note ? String(input.note).slice(0, 500) : null, now(), w.id
      );
      return wdView(db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(w.id));
    });
  }

  const listFor = (table, view) => (userId) =>
    db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(userId).map(view);
  const listAll = (table, view) => (status) =>
    db
      .prepare(
        `SELECT t.*, u.username FROM ${table} t JOIN users u ON u.id = t.user_id
         WHERE (? IS NULL OR t.status = ?) ORDER BY t.id DESC LIMIT 200`
      )
      .all(status ?? null, status ?? null)
      .map(view);

  return {
    requestDeposit, reviewDeposit, validateWithdrawal, requestWithdrawal, reviewWithdrawal,
    myDeposits: listFor('deposits', depView),
    myWithdrawals: listFor('withdrawals', wdView),
    allDeposits: listAll('deposits', depView),
    allWithdrawals: listAll('withdrawals', wdView),
  };
}

module.exports = { createFunds };
