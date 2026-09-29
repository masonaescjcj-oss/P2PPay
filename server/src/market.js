'use strict';

const { bad, forbidden, notFound, conflict } = require('./errors');
const m = require('./money');

const MAX_OPEN_TRADES = 5;
const OPEN = ['pending_payment', 'paid', 'disputed'];

// Concurrency: an offer or trade row is locked (SELECT … FOR UPDATE) before it is read-and-changed,
// so parallel requests cannot oversell an offer or move a trade twice. Lock order is trade → offer.
//
// hooks (all optional): assertCanPostOffer(userId), assertTrade({actorId, buyerId, sellerId, amount}),
// onTradeOpened(trade), onBuyerCancelled(trade), onDispute(trade, userId)
function createMarket(db, wallet, config, hooks = {}) {
  const now = () => Date.now();
  const getOffer = (id, lock = false) => db.one(`SELECT * FROM offers WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  const getTrade = (id, lock = false) => db.one(`SELECT * FROM trades WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  const addMsg = (tradeId, userId, body) =>
    db.run('INSERT INTO trade_messages (trade_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', [tradeId, userId, body, now()]);
  const sys = (tradeId, body) => addMsg(tradeId, null, body);
  const getAccount = (userId, method) =>
    db.one('SELECT holder_name, account FROM payment_accounts WHERE user_id = ? AND method = ?', [userId, method]);
  const nameOf = (id) => db.one('SELECT id, username, display_name FROM users WHERE id = ?', [id]);

  async function stats(userId) {
    const s = await db.one(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE status IN ('completed','cancelled')) AS closed
       FROM trades WHERE buyer_id = ? OR seller_id = ?`,
      [userId, userId]
    );
    return { completed: s.completed, completionRate: s.closed ? Math.round((s.completed / s.closed) * 100) : null };
  }

  // ---------- serialization ----------
  async function offerView(o) {
    const maker = await nameOf(o.user_id);
    return {
      id: o.id,
      side: o.side,
      price: m.fmtAfn(o.price),
      total: m.fmtUsdt(o.total),
      remaining: m.fmtUsdt(o.remaining),
      minFiat: m.fmtAfn(o.min_fiat),
      maxFiat: m.fmtAfn(Math.min(o.max_fiat, m.fiatFor(o.remaining, o.price))),
      paymentMethods: JSON.parse(o.payment_methods),
      terms: o.terms,
      paymentWindow: o.payment_window,
      status: o.status,
      createdAt: o.created_at,
      maker: { id: maker.id, username: maker.username, displayName: maker.display_name, ...(await stats(maker.id)) },
    };
  }

  async function tradeView(t, viewerId) {
    const [b, s, offer, acct] = await Promise.all([
      nameOf(t.buyer_id), nameOf(t.seller_id), getOffer(t.offer_id), getAccount(t.seller_id, t.payment_method),
    ]);
    return {
      id: t.id,
      offerId: t.offer_id,
      role: viewerId === t.buyer_id ? 'buyer' : viewerId === t.seller_id ? 'seller' : 'observer',
      buyer: { id: b.id, username: b.username, displayName: b.display_name },
      seller: { id: s.id, username: s.username, displayName: s.display_name },
      amount: m.fmtUsdt(t.amount),
      fee: m.fmtUsdt(t.fee),
      receive: m.fmtUsdt(t.amount - t.fee),
      price: m.fmtAfn(t.price),
      fiat: m.fmtAfn(t.fiat),
      paymentMethod: t.payment_method,
      terms: offer.terms,
      // The seller's receiving account for the chosen method; only trade parties and staff see trades.
      paymentAccount: acct ? { holderName: acct.holder_name, account: acct.account } : null,
      status: t.status,
      disputeReason: t.dispute_reason,
      resolution: t.resolution,
      expiresAt: t.expires_at,
      paidAt: t.paid_at,
      closedAt: t.closed_at,
      createdAt: t.created_at,
    };
  }

  // ---------- offers ----------
  async function createOffer(userId, input) {
    await hooks.assertCanPostOffer?.(userId);
    const side = input.side;
    if (side !== 'buy' && side !== 'sell') throw bad('invalid_side');
    const price = m.parseAfn(input.price);
    const total = m.parseUsdt(input.total);
    const minFiat = m.parseAfn(input.minFiat);
    const maxFiat = m.parseAfn(input.maxFiat);
    if (!price) throw bad('invalid_price');
    if (!total) throw bad('invalid_amount');
    if (!minFiat || !maxFiat || minFiat > maxFiat) throw bad('invalid_limits');
    if (minFiat > m.fiatFor(total, price)) throw bad('invalid_limits');
    const methods = Array.isArray(input.paymentMethods) ? [...new Set(input.paymentMethods)] : [];
    if (!methods.length || methods.some((pm) => !config.paymentMethods.includes(pm))) throw bad('invalid_payment_methods');
    const terms = String(input.terms ?? '').trim().slice(0, 1000);
    const window = Number.parseInt(input.paymentWindow ?? config.defaultPaymentWindowMin, 10);
    if (!(window >= 10 && window <= 180)) throw bad('invalid_payment_window');
    // A seller must be able to tell buyers where to send AFN.
    if (side === 'sell') {
      for (const pm of methods) if (!(await getAccount(userId, pm))) throw bad('missing_payment_account');
    }

    const o = await db.tx(async () => {
      const row = await db.one(
        `INSERT INTO offers (user_id, side, price, total, remaining, min_fiat, max_fiat, payment_methods, terms, payment_window, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?) RETURNING *`,
        [userId, side, price, total, total, minFiat, maxFiat, JSON.stringify(methods), terms, window, now()]
      );
      // A sell offer's USDT is held in escrow for as long as the offer is open.
      if (side === 'sell') await wallet.lock(userId, total, 'offer_lock', { type: 'offer', id: row.id });
      return row;
    });
    return offerView(o);
  }

  async function setOfferStatus(userId, offerId, status, isStaff = false) {
    if (!['active', 'paused', 'closed'].includes(status)) throw bad('invalid_status');
    const o = await db.tx(async () => {
      const o = await getOffer(offerId, true);
      if (!o) throw notFound();
      if (o.user_id !== userId && !isStaff) throw forbidden();
      if (o.status === 'closed') throw conflict('offer_closed');
      if (status === 'closed') {
        if (o.side === 'sell' && o.remaining > 0) await wallet.unlock(o.user_id, o.remaining, 'offer_unlock', { type: 'offer', id: o.id });
        return db.one("UPDATE offers SET status = 'closed', remaining = 0 WHERE id = ? RETURNING *", [o.id]);
      }
      return db.one('UPDATE offers SET status = ? WHERE id = ? RETURNING *', [status, o.id]);
    });
    return offerView(o);
  }

  // side is from the visitor's point of view: 'buy' lists sell offers and vice versa.
  async function listMarket({ side = 'buy', paymentMethod, fiat } = {}) {
    const offerSide = side === 'sell' ? 'buy' : 'sell';
    const order = offerSide === 'sell' ? 'ASC' : 'DESC';
    let rows = await db.query(
      `SELECT o.* FROM offers o JOIN users u ON u.id = o.user_id
       WHERE o.status = 'active' AND o.side = ? AND o.remaining > 0 AND u.is_blocked = 0
       ORDER BY o.price ${order}, o.id ASC LIMIT 200`,
      [offerSide]
    );
    if (paymentMethod) rows = rows.filter((o) => JSON.parse(o.payment_methods).includes(paymentMethod));
    rows = rows.filter((o) => m.fiatFor(o.remaining, o.price) >= o.min_fiat);
    const f = fiat ? m.parseAfn(fiat) : null;
    if (f) rows = rows.filter((o) => f >= o.min_fiat && f <= Math.min(o.max_fiat, m.fiatFor(o.remaining, o.price)));
    return Promise.all(rows.map(offerView));
  }

  async function myOffers(userId) {
    const rows = await db.query("SELECT * FROM offers WHERE user_id = ? ORDER BY status = 'closed', id DESC LIMIT 100", [userId]);
    return Promise.all(rows.map(offerView));
  }

  async function offer(offerId) {
    const o = await getOffer(offerId);
    if (!o) throw notFound();
    return offerView(o);
  }

  // ---------- trades ----------
  async function openTrade(takerId, offerId, input) {
    await expireTrades();
    const t = await db.tx(async () => {
      const o = await getOffer(offerId, true);
      if (!o || o.status !== 'active') throw conflict('offer_unavailable');
      if (o.user_id === takerId) throw bad('own_offer');
      const maker = await db.one('SELECT is_blocked FROM users WHERE id = ?', [o.user_id]);
      if (maker.is_blocked) throw conflict('offer_unavailable');

      let amount;
      if (input.fiat !== undefined && input.fiat !== '') {
        const f = m.parseAfn(input.fiat);
        if (!f) throw bad('invalid_amount');
        amount = m.usdtFor(f, o.price);
      } else {
        amount = m.parseUsdt(input.amount);
      }
      if (!amount) throw bad('invalid_amount');
      const fiat = m.fiatFor(amount, o.price);
      if (amount > o.remaining) throw conflict('exceeds_available');
      if (fiat < o.min_fiat || fiat > o.max_fiat) throw bad('outside_limits');

      const methods = JSON.parse(o.payment_methods);
      const pm = input.paymentMethod || methods[0];
      if (!methods.includes(pm)) throw bad('invalid_payment_method');
      if (o.side === 'buy' && !(await getAccount(takerId, pm))) throw bad('missing_payment_account');
      if (o.side === 'sell' && !(await getAccount(o.user_id, pm))) throw conflict('offer_unavailable');

      const open = await db.one(
        "SELECT COUNT(*) AS n FROM trades WHERE taker_id = ? AND status IN ('pending_payment','paid','disputed')",
        [takerId]
      );
      if (open.n >= MAX_OPEN_TRADES) throw conflict('too_many_open_trades');

      const buyerId = o.side === 'sell' ? takerId : o.user_id;
      const sellerId = o.side === 'sell' ? o.user_id : takerId;
      await hooks.assertTrade?.({ actorId: takerId, buyerId, sellerId, amount });
      const fee = m.feeFor(amount, config.tradeFeeBps);
      const ts = now();
      const trade = await db.one(
        `INSERT INTO trades (offer_id, maker_id, taker_id, buyer_id, seller_id, amount, price, fiat, fee, payment_method, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?) RETURNING *`,
        [o.id, o.user_id, takerId, buyerId, sellerId, amount, o.price, fiat, fee, pm, ts + o.payment_window * 60_000, ts]
      );
      await db.run('UPDATE offers SET remaining = remaining - ? WHERE id = ?', [amount, o.id]);
      // For a buy offer the taker is the seller: lock their USDT now.
      if (o.side === 'buy') await wallet.lock(sellerId, amount, 'trade_lock', { type: 'trade', id: trade.id });
      await sys(trade.id, 'trade_opened');
      await hooks.onTradeOpened?.(trade);
      return trade;
    });
    return tradeView(t, takerId);
  }

  // Returns escrowed USDT to where it came from (the open offer, or the seller's balance).
  async function refund(t) {
    const o = await getOffer(t.offer_id, true);
    const ref = { type: 'trade', id: t.id };
    if (o.side === 'sell') {
      if (o.status !== 'closed') await db.run('UPDATE offers SET remaining = remaining + ? WHERE id = ?', [t.amount, o.id]);
      else await wallet.unlock(t.seller_id, t.amount, 'trade_refund', ref);
    } else {
      await wallet.unlock(t.seller_id, t.amount, 'trade_refund', ref);
      if (o.status !== 'closed') await db.run('UPDATE offers SET remaining = remaining + ? WHERE id = ?', [t.amount, o.id]);
    }
  }

  // Caller holds the trade row lock.
  async function close(t, status, resolution) {
    if (status === 'completed') await wallet.releaseLocked(t.seller_id, t.buyer_id, t.amount, t.fee, { type: 'trade', id: t.id });
    else await refund(t);
    await db.run('UPDATE trades SET status = ?, resolution = ?, closed_at = ? WHERE id = ?', [status, resolution, now(), t.id]);
    await sys(t.id, `trade_${resolution}`);
  }

  // Cancels unpaid trades whose payment window ended. Safe to run from several processes at once.
  async function expireTrades() {
    const due = await db.query("SELECT id FROM trades WHERE status = 'pending_payment' AND expires_at < ? LIMIT 100", [now()]);
    let n = 0;
    for (const { id } of due) {
      await db.tx(async () => {
        const t = await db.one("SELECT * FROM trades WHERE id = ? AND status = 'pending_payment' AND expires_at < ? FOR UPDATE SKIP LOCKED", [id, now()]);
        if (!t) return;
        await close(t, 'cancelled', 'expired');
        n++;
      });
    }
    return n;
  }

  async function loadForParty(userId, tradeId, lock = false) {
    const t = await getTrade(tradeId, lock);
    if (!t) throw notFound();
    if (t.buyer_id !== userId && t.seller_id !== userId) throw forbidden();
    return t;
  }

  async function action(userId, tradeId, act, input = {}) {
    await expireTrades();
    let after = null;
    await db.tx(async () => {
      const t = await loadForParty(userId, tradeId, true);
      const isBuyer = t.buyer_id === userId;
      const isSeller = t.seller_id === userId;
      switch (act) {
        case 'pay':
          if (!isBuyer) throw forbidden();
          if (t.status !== 'pending_payment') throw conflict('invalid_state');
          await db.run("UPDATE trades SET status = 'paid', paid_at = ? WHERE id = ?", [now(), t.id]);
          await sys(t.id, 'trade_marked_paid');
          break;
        case 'release':
          if (!isSeller) throw forbidden();
          if (t.status !== 'paid' && t.status !== 'pending_payment') throw conflict('invalid_state');
          await close(t, 'completed', 'released');
          break;
        case 'cancel':
          if (!isBuyer) throw forbidden();
          if (t.status !== 'pending_payment' && t.status !== 'paid') throw conflict('invalid_state');
          await close(t, 'cancelled', 'cancelled_by_buyer');
          after = () => hooks.onBuyerCancelled?.(t);
          break;
        case 'dispute': {
          if (t.status !== 'paid') throw conflict('invalid_state');
          const reason = String(input.reason ?? '').trim().slice(0, 1000);
          if (!reason) throw bad('reason_required');
          await db.run("UPDATE trades SET status = 'disputed', dispute_reason = ? WHERE id = ?", [reason, t.id]);
          await sys(t.id, 'trade_disputed');
          after = () => hooks.onDispute?.(t, userId);
          break;
        }
        default:
          throw bad('invalid_action');
      }
    });
    await after?.();
    return tradeView(await getTrade(tradeId), userId);
  }

  async function resolveDispute(tradeId, winner, note = '', actorId = null) {
    await db.tx(async () => {
      const t = await getTrade(tradeId, true);
      if (!t) throw notFound();
      if (actorId !== null && (t.buyer_id === actorId || t.seller_id === actorId)) throw forbidden('own_request');
      if (t.status !== 'disputed' && t.status !== 'paid') throw conflict('invalid_state');
      if (winner === 'buyer') await close(t, 'completed', 'resolved_buyer');
      else if (winner === 'seller') await close(t, 'cancelled', 'resolved_seller');
      else throw bad('invalid_winner');
      if (note) await addMsg(t.id, null, `admin: ${String(note).slice(0, 1000)}`);
    });
    return tradeView(await getTrade(tradeId), null);
  }

  async function trade(userId, tradeId, isStaff = false) {
    await expireTrades();
    const t = isStaff ? await getTrade(tradeId) : await loadForParty(userId, tradeId);
    if (!t) throw notFound();
    return tradeView(t, userId);
  }

  async function myTrades(userId) {
    await expireTrades();
    const rows = await db.query(
      `SELECT * FROM trades WHERE buyer_id = ? OR seller_id = ?
       ORDER BY status NOT IN ('pending_payment','paid','disputed'), id DESC LIMIT 100`,
      [userId, userId]
    );
    return Promise.all(rows.map((t) => tradeView(t, userId)));
  }

  async function listTrades(status) {
    const rows = status
      ? await db.query('SELECT * FROM trades WHERE status = ? ORDER BY id DESC LIMIT 200', [status])
      : await db.query('SELECT * FROM trades ORDER BY id DESC LIMIT 200');
    return Promise.all(rows.map((t) => tradeView(t, null)));
  }

  async function messages(userId, tradeId, afterId = 0, isStaff = false) {
    if (!isStaff) await loadForParty(userId, tradeId);
    return db.query(
      `SELECT m.id, m.user_id AS "userId", u.username, COALESCE(u.role != 'user', false) AS "fromAdmin", m.body, m.created_at AS "createdAt"
       FROM trade_messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.trade_id = ? AND m.id > ? ORDER BY m.id LIMIT 500`,
      [tradeId, afterId]
    );
  }

  async function postMessage(userId, tradeId, body, isStaff = false) {
    if (!isStaff) await loadForParty(userId, tradeId);
    else if (!(await getTrade(tradeId))) throw notFound();
    const text = String(body ?? '').trim().slice(0, 2000);
    if (!text) throw bad('empty_message');
    await addMsg(tradeId, userId, text);
    return { ok: true };
  }

  return {
    OPEN, stats, createOffer, setOfferStatus, listMarket, myOffers, offer,
    openTrade, action, resolveDispute, trade, myTrades, listTrades, messages, postMessage, expireTrades,
  };
}

module.exports = { createMarket };
