'use strict';

// Suspicious-activity rules. Each raises at most one open alert per user and rule
// (enforced by the partial unique index alerts_one_open).
const m = require('./money');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function createAlerts(db, config) {
  const now = () => Date.now();
  const count = async (sql, params) => (await db.one(sql, params)).n;

  const raise = (userId, rule, severity, details) =>
    db.run(
      `INSERT INTO alerts (user_id, rule, severity, details, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, rule) WHERE status = 'open' DO NOTHING`,
      [userId, rule, severity, JSON.stringify(details), now()]
    );

  return {
    raise,

    // Money that arrives and leaves again without being traded (possible pass-through / laundering),
    // and one destination address shared by several accounts (possible multi-accounting).
    async onWithdrawalRequested(userId, amount, address) {
      const deposited = await count(
        "SELECT COALESCE(SUM(amount), 0) n FROM deposits WHERE user_id = ? AND status = 'approved' AND created_at > ?",
        [userId, now() - 2 * HOUR]
      );
      const traded = await count(
        "SELECT COALESCE(SUM(amount), 0) n FROM trades WHERE (buyer_id = ? OR seller_id = ?) AND status = 'completed' AND created_at > ?",
        [userId, userId, now() - DAY]
      );
      if (deposited >= amount * 0.9 && traded < amount * 0.1) {
        await raise(userId, 'pass_through', 'medium', { amount: m.fmtUsdt(amount), depositedLast2h: m.fmtUsdt(deposited), tradedLast24h: m.fmtUsdt(traded) });
      }
      const others = await db.query('SELECT DISTINCT user_id FROM withdrawals WHERE address = ? AND user_id != ?', [address, userId]);
      if (others.length) await raise(userId, 'shared_address', 'high', { address, otherUsers: others.map((r) => r.user_id) });
    },

    async onTradeOpened(trade) {
      if (trade.amount >= config.alertLargeTradeMicro) {
        for (const uid of [trade.buyer_id, trade.seller_id]) await raise(uid, 'large_trade', 'info', { tradeId: trade.id, amount: m.fmtUsdt(trade.amount) });
      }
    },

    async onBuyerCancelled(trade) {
      const n = await count(
        "SELECT COUNT(*) n FROM trades WHERE buyer_id = ? AND resolution = 'cancelled_by_buyer' AND closed_at > ?",
        [trade.buyer_id, now() - DAY]
      );
      if (n >= 5) await raise(trade.buyer_id, 'many_cancels', 'low', { cancelsLast24h: n });
    },

    async onDispute(trade, userId) {
      const n = await count(
        'SELECT COUNT(*) n FROM trades WHERE (buyer_id = ? OR seller_id = ?) AND dispute_reason IS NOT NULL AND created_at > ?',
        [userId, userId, now() - 30 * DAY]
      );
      if (n >= 3) await raise(userId, 'many_disputes', 'medium', { disputesLast30d: n, tradeId: trade.id });
    },

    async onAuthFailure(userId) {
      const n = await count(
        "SELECT COUNT(*) n FROM security_events WHERE user_id = ? AND kind LIKE '%failed%' AND created_at > ?",
        [userId, now() - HOUR]
      );
      if (n >= 5) await raise(userId, 'auth_failures', 'medium', { failuresLastHour: n });
    },

    async list(status) {
      const rows = await db.query(
        `SELECT a.*, u.username, c.username AS closed_by_username FROM alerts a JOIN users u ON u.id = a.user_id
         LEFT JOIN users c ON c.id = a.closed_by WHERE (?::text IS NULL OR a.status = ?) ORDER BY a.id DESC LIMIT 200`,
        [status ?? null, status ?? null]
      );
      return rows.map((r) => ({
        id: r.id, userId: r.user_id, username: r.username, rule: r.rule, severity: r.severity, details: JSON.parse(r.details),
        status: r.status, note: r.note, closedBy: r.closed_by_username, createdAt: r.created_at, closedAt: r.closed_at,
      }));
    },

    async close(id, staffId, note) {
      const r = await db.run(
        "UPDATE alerts SET status = 'closed', note = ?, closed_by = ?, closed_at = ? WHERE id = ? AND status = 'open'",
        [String(note ?? '').slice(0, 500) || null, staffId, now(), id]
      );
      return r.rowCount;
    },

    openCount: () => count("SELECT COUNT(*) n FROM alerts WHERE status = 'open'"),
  };
}

module.exports = { createAlerts };
