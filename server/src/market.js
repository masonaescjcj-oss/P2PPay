'use strict';

const { bad, forbidden, notFound, conflict } = require('./errors');
const m = require('./money');

const MAX_OPEN_TRADES = 5;
const OPEN = ['pending_payment', 'paid', 'disputed'];

function createMarket(db, wallet, config) {
  const now = () => Date.now();
  const getOffer = db.prepare('SELECT * FROM offers WHERE id = ?');
  const getTrade = db.prepare('SELECT * FROM trades WHERE id = ?');
  const setRemaining = db.prepare('UPDATE offers SET remaining = ? WHERE id = ?');
  const addMsg = db.prepare('INSERT INTO trade_messages (trade_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
  const sys = (tradeId, body) => addMsg.run(tradeId, null, body, now());

  const userStats = db.prepare(
    `SELECT
       SUM(status = 'completed') AS completed,
       SUM(status IN ('completed','cancelled')) AS closed
     FROM trades WHERE buyer_id = ? OR seller_id = ?`
  );

  function stats(userId) {
    const s = userStats.get(userId, userId);
    const completed = s.completed || 0;
    const closed = s.closed || 0;
    return { completed, completionRate: closed ? Math.round((completed / closed) * 100) : null };
  }

  // ---------- serialization ----------
  function offerView(o) {
    const maker = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(o.user_id);
    const avail = Math.min(o.max_fiat, m.fiatFor(o.remaining, o.price));
    return {
      id: o.id,
      side: o.side,
      price: m.fmtAfn(o.price),
      total: m.fmtUsdt(o.total),
      remaining: m.fmtUsdt(o.remaining),
      minFiat: m.fmtAfn(o.min_fiat),
      maxFiat: m.fmtAfn(avail),
      paymentMethods: JSON.parse(o.payment_methods),
      terms: o.terms,
      paymentWindow: o.payment_window,
      status: o.status,
      createdAt: o.created_at,
      maker: { id: maker.id, username: maker.username, displayName: maker.display_name, ...stats(maker.id) },
    };
  }

  function tradeView(t, viewerId) {
    const name = (id) => db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id);
    const b = name(t.buyer_id);
    const s = name(t.seller_id);
    const offer = getOffer.get(t.offer_id);
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
  function createOffer(userId, input) {
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
    if (!methods.length || methods.some((pm) => !config.paymentMethods.includes(pm)))
      throw bad('invalid_payment_methods');
    const terms = String(input.terms ?? '').trim().slice(0, 1000);
    const window = Number.parseInt(input.paymentWindow ?? config.defaultPaymentWindowMin, 10);
    if (!(window >= 10 && window <= 180)) throw bad('invalid_payment_window');

    return db.tx(() => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO offers (user_id, side, price, total, remaining, min_fiat, max_fiat,
             payment_methods, terms, payment_window, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
        .run(userId, side, price, total, total, minFiat, maxFiat, JSON.stringify(methods), terms, window, now());
      const id = Number(lastInsertRowid);
      // A sell offer's USDT is held in escrow for as long as the offer is open.
      if (side === 'sell') wallet.lock(userId, total, 'offer_lock', { type: 'offer', id });
      return offerView(getOffer.get(id));
    });
  }

  function setOfferStatus(userId, offerId, status, isAdmin = false) {
    if (!['active', 'paused', 'closed'].includes(status)) throw bad('invalid_status');
    return db.tx(() => {
      const o = getOffer.get(offerId);
      if (!o) throw notFound();
      if (o.user_id !== userId && !isAdmin) throw forbidden();
      if (o.status === 'closed') throw conflict('offer_closed');
      if (status === 'closed') {
        if (o.side === 'sell' && o.remaining > 0)
          wallet.unlock(o.user_id, o.remaining, 'offer_unlock', { type: 'offer', id: o.id });
        db.prepare("UPDATE offers SET status = 'closed', remaining = 0 WHERE id = ?").run(o.id);
      } else {
        db.prepare('UPDATE offers SET status = ? WHERE id = ?').run(status, o.id);
      }
      return offerView(getOffer.get(o.id));
    });
  }

  // side is from the visitor's point of view: 'buy' lists sell offers and vice versa.
  function listMarket({ side = 'buy', paymentMethod, fiat } = {}) {
    const offerSide = side === 'sell' ? 'buy' : 'sell';
    const order = offerSide === 'sell' ? 'ASC' : 'DESC';
    let rows = db
      .prepare(
        `SELECT o.* FROM offers o JOIN users u ON u.id = o.user_id
         WHERE o.status = 'active' AND o.side = ? AND o.remaining > 0 AND u.is_blocked = 0
         ORDER BY o.price ${order}, o.id ASC LIMIT 200`
      )
      .all(offerSide);
    if (paymentMethod) rows = rows.filter((o) => JSON.parse(o.payment_methods).includes(paymentMethod));
    rows = rows.filter((o) => m.fiatFor(o.remaining, o.price) >= o.min_fiat);
    const f = fiat ? m.parseAfn(fiat) : null;
    if (f) rows = rows.filter((o) => f >= o.min_fiat && f <= Math.min(o.max_fiat, m.fiatFor(o.remaining, o.price)));
    return rows.map(offerView);
  }

  function myOffers(userId) {
    return db
      .prepare("SELECT * FROM offers WHERE user_id = ? ORDER BY status = 'closed', id DESC LIMIT 100")
      .all(userId)
      .map(offerView);
  }

  function offer(offerId) {
    const o = getOffer.get(offerId);
    if (!o) throw notFound();
    return offerView(o);
  }

  // ---------- trades ----------
  function openTrade(takerId, offerId, input) {
    return db.tx(() => {
      expireTrades();
      const o = getOffer.get(offerId);
      if (!o || o.status !== 'active') throw conflict('offer_unavailable');
      if (o.user_id === takerId) throw bad('own_offer');
      const maker = db.prepare('SELECT is_blocked FROM users WHERE id = ?').get(o.user_id);
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

      const open = db
        .prepare(
          `SELECT COUNT(*) AS n FROM trades WHERE taker_id = ?
           AND status IN ('pending_payment','paid','disputed')`
        )
        .get(takerId).n;
      if (open >= MAX_OPEN_TRADES) throw conflict('too_many_open_trades');

      const buyerId = o.side === 'sell' ? takerId : o.user_id;
      const sellerId = o.side === 'sell' ? o.user_id : takerId;
      const fee = m.feeFor(amount, config.tradeFeeBps);
      const t = now();
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO trades (offer_id, maker_id, taker_id, buyer_id, seller_id, amount, price, fiat, fee,
             payment_method, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`
        )
        .run(o.id, o.user_id, takerId, buyerId, sellerId, amount, o.price, fiat, fee, pm,
          t + o.payment_window * 60_000, t);
      const id = Number(lastInsertRowid);

      setRemaining.run(o.remaining - amount, o.id);
      // For a buy offer the taker is the seller: lock their USDT now.
      if (o.side === 'buy') wallet.lock(sellerId, amount, 'trade_lock', { type: 'trade', id });
      sys(id, 'trade_opened');
      return tradeView(getTrade.get(id), takerId);
    });
  }

  // Returns escrowed USDT to where it came from (the open offer, or the seller's balance).
  function refund(t) {
    const o = getOffer.get(t.offer_id);
    const ref = { type: 'trade', id: t.id };
    if (o.side === 'sell') {
      if (o.status !== 'closed') setRemaining.run(o.remaining + t.amount, o.id);
      else wallet.unlock(t.seller_id, t.amount, 'trade_refund', ref);
    } else {
      wallet.unlock(t.seller_id, t.amount, 'trade_refund', ref);
      if (o.status !== 'closed') setRemaining.run(o.remaining + t.amount, o.id);
    }
  }

  function close(t, status, resolution) {
    if (status === 'completed') {
      wallet.releaseLocked(t.seller_id, t.buyer_id, t.amount, t.fee, { type: 'trade', id: t.id });
    } else {
      refund(t);
    }
    db.prepare('UPDATE trades SET status = ?, resolution = ?, closed_at = ? WHERE id = ?').run(
      status, resolution, now(), t.id
    );
    sys(t.id, `trade_${resolution}`);
  }

  function expireTrades() {
    return db.tx(() => {
      const rows = db
        .prepare("SELECT * FROM trades WHERE status = 'pending_payment' AND expires_at < ?")
        .all(now());
      for (const t of rows) close(t, 'cancelled', 'expired');
      return rows.length;
    });
  }

  function loadForParty(userId, tradeId) {
    const t = getTrade.get(tradeId);
    if (!t) throw notFound();
    if (t.buyer_id !== userId && t.seller_id !== userId) throw forbidden();
    return t;
  }

  function action(userId, tradeId, act, input = {}) {
    return db.tx(() => {
      expireTrades();
      const t = loadForParty(userId, tradeId);
      const isBuyer = t.buyer_id === userId;
      const isSeller = t.seller_id === userId;

      switch (act) {
        case 'pay':
          if (!isBuyer) throw forbidden();
          if (t.status !== 'pending_payment') throw conflict('invalid_state');
          db.prepare("UPDATE trades SET status = 'paid', paid_at = ? WHERE id = ?").run(now(), t.id);
          sys(t.id, 'trade_marked_paid');
          break;
        case 'release':
          if (!isSeller) throw forbidden();
          if (t.status !== 'paid' && t.status !== 'pending_payment') throw conflict('invalid_state');
          close(t, 'completed', 'released');
          break;
        case 'cancel':
          if (!isBuyer) throw forbidden();
          if (t.status !== 'pending_payment' && t.status !== 'paid') throw conflict('invalid_state');
          close(t, 'cancelled', 'cancelled_by_buyer');
          break;
        case 'dispute': {
          if (t.status !== 'paid') throw conflict('invalid_state');
          const reason = String(input.reason ?? '').trim().slice(0, 1000);
          if (!reason) throw bad('reason_required');
          db.prepare("UPDATE trades SET status = 'disputed', dispute_reason = ? WHERE id = ?").run(reason, t.id);
          sys(t.id, 'trade_disputed');
          break;
        }
        default:
          throw bad('invalid_action');
      }
      return tradeView(getTrade.get(t.id), userId);
    });
  }

  function resolveDispute(tradeId, winner, note = '') {
    return db.tx(() => {
      const t = getTrade.get(tradeId);
      if (!t) throw notFound();
      if (t.status !== 'disputed' && t.status !== 'paid') throw conflict('invalid_state');
      if (winner === 'buyer') close(t, 'completed', 'resolved_buyer');
      else if (winner === 'seller') close(t, 'cancelled', 'resolved_seller');
      else throw bad('invalid_winner');
      if (note) addMsg.run(t.id, null, `admin: ${String(note).slice(0, 1000)}`, now());
      return tradeView(getTrade.get(t.id), null);
    });
  }

  function trade(userId, tradeId, isAdmin = false) {
    expireTrades();
    const t = isAdmin ? getTrade.get(tradeId) : loadForParty(userId, tradeId);
    if (!t) throw notFound();
    return tradeView(t, userId);
  }

  function myTrades(userId) {
    expireTrades();
    return db
      .prepare(
        `SELECT * FROM trades WHERE buyer_id = ? OR seller_id = ?
         ORDER BY status NOT IN ('pending_payment','paid','disputed'), id DESC LIMIT 100`
      )
      .all(userId, userId)
      .map((t) => tradeView(t, userId));
  }

  function listTrades(status) {
    const rows = status
      ? db.prepare('SELECT * FROM trades WHERE status = ? ORDER BY id DESC LIMIT 200').all(status)
      : db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 200').all();
    return rows.map((t) => tradeView(t, null));
  }

  function messages(userId, tradeId, afterId = 0, isAdmin = false) {
    if (!isAdmin) loadForParty(userId, tradeId);
    return db
      .prepare(
        `SELECT m.id, m.user_id AS userId, u.username, m.body, m.created_at AS createdAt
         FROM trade_messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.trade_id = ? AND m.id > ? ORDER BY m.id LIMIT 500`
      )
      .all(tradeId, afterId)
      .map((r) => ({ ...r }));
  }

  function postMessage(userId, tradeId, body, isAdmin = false) {
    if (!isAdmin) loadForParty(userId, tradeId);
    else if (!getTrade.get(tradeId)) throw notFound();
    const text = String(body ?? '').trim().slice(0, 2000);
    if (!text) throw bad('empty_message');
    addMsg.run(tradeId, userId, text, now());
    return { ok: true };
  }

  return {
    OPEN, stats, createOffer, setOfferStatus, listMarket, myOffers, offer,
    openTrade, action, resolveDispute, trade, myTrades, listTrades, messages, postMessage, expireTrades,
  };
}

module.exports = { createMarket };
