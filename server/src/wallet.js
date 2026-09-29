'use strict';

const { conflict } = require('./errors');

// Low-level balance operations. Every change writes a ledger row.
// Callers must run these inside db.tx() when combining several operations.
function createWallet(db) {
  const now = () => Date.now();
  const ensure = db.prepare('INSERT OR IGNORE INTO balances (user_id) VALUES (?)');
  const get = db.prepare('SELECT available, locked FROM balances WHERE user_id = ?');
  const update = db.prepare(
    'UPDATE balances SET available = available + ?, locked = locked + ? WHERE user_id = ?'
  );
  const log = db.prepare(
    `INSERT INTO ledger (user_id, kind, available_delta, locked_delta, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  function balance(userId) {
    ensure.run(userId);
    return { ...get.get(userId) };
  }

  function apply(userId, kind, dAvail, dLocked, ref = {}) {
    const b = balance(userId);
    if (b.available + dAvail < 0) throw conflict('insufficient_balance');
    if (b.locked + dLocked < 0) throw new Error(`locked balance underflow for user ${userId}`);
    update.run(dAvail, dLocked, userId);
    log.run(userId, kind, dAvail, dLocked, ref.type ?? null, ref.id ?? null, now());
  }

  return {
    balance,
    credit: (userId, amount, kind, ref) => apply(userId, kind, amount, 0, ref),
    lock: (userId, amount, kind, ref) => apply(userId, kind, -amount, amount, ref),
    unlock: (userId, amount, kind, ref) => apply(userId, kind, amount, -amount, ref),
    burnLocked: (userId, amount, kind, ref) => apply(userId, kind, 0, -amount, ref),
    // Move escrowed funds from one user's locked balance to another's available balance.
    releaseLocked(fromId, toId, amount, fee, ref) {
      apply(fromId, 'escrow_release', 0, -amount, ref);
      apply(toId, 'trade_receive', amount - fee, 0, ref);
      if (fee > 0) log.run(null, 'fee', fee, 0, ref.type ?? null, ref.id ?? null, now());
    },
    history(userId, limit = 50) {
      return db
        .prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
        .all(userId, limit);
    },
  };
}

module.exports = { createWallet };
