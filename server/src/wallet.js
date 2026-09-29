'use strict';

const { conflict } = require('./errors');

// Balance operations. Every change is one atomic conditional UPDATE (so concurrent requests can
// never overdraw) plus a ledger row. Combine several operations inside db.tx().
function createWallet(db) {
  const now = () => Date.now();

  const ensure = (userId) => db.run('INSERT INTO balances (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const log = (userId, kind, dAvail, dLocked, ref = {}) =>
    db.run(
      `INSERT INTO ledger (user_id, kind, available_delta, locked_delta, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, kind, dAvail, dLocked, ref.type ?? null, ref.id ?? null, now()]
    );

  async function balance(userId) {
    await ensure(userId);
    const b = await db.one('SELECT available, locked FROM balances WHERE user_id = ?', [userId]);
    return { available: b.available, locked: b.locked };
  }

  async function apply(userId, kind, dAvail, dLocked, ref = {}) {
    return db.tx(async () => {
      await ensure(userId);
      const r = await db.run(
        `UPDATE balances SET available = available + ?, locked = locked + ?
         WHERE user_id = ? AND available + ? >= 0 AND locked + ? >= 0`,
        [dAvail, dLocked, userId, dAvail, dLocked]
      );
      if (r.rowCount === 0) {
        const b = await db.one('SELECT available FROM balances WHERE user_id = ?', [userId]);
        if (b.available + dAvail < 0) throw conflict('insufficient_balance');
        throw new Error(`locked balance underflow for user ${userId}`);
      }
      await log(userId, kind, dAvail, dLocked, ref);
    });
  }

  return {
    balance,
    credit: (userId, amount, kind, ref) => apply(userId, kind, amount, 0, ref),
    lock: (userId, amount, kind, ref) => apply(userId, kind, -amount, amount, ref),
    unlock: (userId, amount, kind, ref) => apply(userId, kind, amount, -amount, ref),
    burnLocked: (userId, amount, kind, ref) => apply(userId, kind, 0, -amount, ref),
    // Move escrowed funds from one user's locked balance to another's available balance.
    releaseLocked(fromId, toId, amount, fee, ref) {
      // Touch balance rows in id order so two opposite releases cannot deadlock.
      const steps = [
        [fromId, 'escrow_release', 0, -amount],
        [toId, 'trade_receive', amount - fee, 0],
      ];
      if (toId < fromId) steps.reverse();
      return db.tx(async () => {
        for (const [uid, kind, a, l] of steps) await apply(uid, kind, a, l, ref);
        if (fee > 0) await log(null, 'fee', fee, 0, ref);
      });
    },
    history: (userId, limit = 50) => db.query('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit]),
  };
}

module.exports = { createWallet };
