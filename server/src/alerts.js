'use strict';

// Suspicious-activity rules. Each raises at most one open alert per user and rule.
const m = require('./money');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function createAlerts(db, config) {
  const now = () => Date.now();

  function raise(userId, rule, severity, details) {
    if (db.prepare("SELECT 1 FROM alerts WHERE user_id = ? AND rule = ? AND status = 'open'").get(userId, rule)) return;
    db.prepare('INSERT INTO alerts (user_id, rule, severity, details, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId, rule, severity, JSON.stringify(details), now()
    );
  }

  return {
    raise,

    // Money that arrives and leaves again without being traded (possible pass-through / laundering),
    // and one destination address shared by several accounts (possible multi-accounting).
    onWithdrawalRequested(userId, amount, address) {
      const deposited = db
        .prepare("SELECT COALESCE(SUM(amount), 0) s FROM deposits WHERE user_id = ? AND status = 'approved' AND created_at > ?")
        .get(userId, now() - 2 * HOUR).s;
      const traded = db
        .prepare("SELECT COALESCE(SUM(amount), 0) s FROM trades WHERE (buyer_id = ? OR seller_id = ?) AND status = 'completed' AND created_at > ?")
        .get(userId, userId, now() - DAY).s;
      if (deposited >= amount * 0.9 && traded < amount * 0.1) {
        raise(userId, 'pass_through', 'medium', { amount: m.fmtUsdt(amount), depositedLast2h: m.fmtUsdt(deposited), tradedLast24h: m.fmtUsdt(traded) });
      }
      const others = db.prepare('SELECT DISTINCT user_id FROM withdrawals WHERE address = ? AND user_id != ?').all(address, userId);
      if (others.length) raise(userId, 'shared_address', 'high', { address, otherUsers: others.map((r) => r.user_id) });
    },

    onTradeOpened(trade) {
      if (trade.amount >= config.alertLargeTradeMicro) {
        for (const uid of [trade.buyer_id, trade.seller_id]) raise(uid, 'large_trade', 'info', { tradeId: trade.id, amount: m.fmtUsdt(trade.amount) });
      }
    },

    onBuyerCancelled(trade) {
      const n = db
        .prepare("SELECT COUNT(*) n FROM trades WHERE buyer_id = ? AND resolution = 'cancelled_by_buyer' AND closed_at > ?")
        .get(trade.buyer_id, now() - DAY).n;
      if (n >= 5) raise(trade.buyer_id, 'many_cancels', 'low', { cancelsLast24h: n });
    },

    onDispute(trade, userId) {
      const n = db
        .prepare("SELECT COUNT(*) n FROM trades WHERE (buyer_id = ? OR seller_id = ?) AND dispute_reason IS NOT NULL AND created_at > ?")
        .get(userId, userId, now() - 30 * DAY).n;
      if (n >= 3) raise(userId, 'many_disputes', 'medium', { disputesLast30d: n, tradeId: trade.id });
    },

    onAuthFailure(userId) {
      const n = db
        .prepare("SELECT COUNT(*) n FROM security_events WHERE user_id = ? AND kind LIKE '%failed%' AND created_at > ?")
        .get(userId, now() - HOUR).n;
      if (n >= 5) raise(userId, 'auth_failures', 'medium', { failuresLastHour: n });
    },

    list(status) {
      return db
        .prepare(
          `SELECT a.*, u.username, c.username AS closed_by_username FROM alerts a JOIN users u ON u.id = a.user_id
           LEFT JOIN users c ON c.id = a.closed_by WHERE (? IS NULL OR a.status = ?) ORDER BY a.id DESC LIMIT 200`
        )
        .all(status ?? null, status ?? null)
        .map((r) => ({
          id: r.id, userId: r.user_id, username: r.username, rule: r.rule, severity: r.severity, details: JSON.parse(r.details),
          status: r.status, note: r.note, closedBy: r.closed_by_username, createdAt: r.created_at, closedAt: r.closed_at,
        }));
    },

    close(id, staffId, note) {
      return db.prepare("UPDATE alerts SET status = 'closed', note = ?, closed_by = ?, closed_at = ? WHERE id = ? AND status = 'open'")
        .run(String(note ?? '').slice(0, 500) || null, staffId, now(), id).changes;
    },

    openCount: () => db.prepare("SELECT COUNT(*) n FROM alerts WHERE status = 'open'").get().n,
  };
}

module.exports = { createAlerts };
