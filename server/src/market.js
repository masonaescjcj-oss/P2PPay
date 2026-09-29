'use strict';

const { bad, forbidden, notFound, conflict } = require('./errors');
const m = require('./money');

const MAX_OPEN_TRADES = 5;
const OPEN = ['pending_payment', 'paid', 'disputed'];

// Concurrency: an offer or trade row is locked (SELECT … FOR UPDATE) before it is read-and-changed,
// so parallel requests cannot oversell an offer or move a trade twice. Lock order is trade → offer.
//
// hooks (all optional): assertCanPostOffer(userId), assertTrade({actorId, buyerId, sellerId, amount}),
// onTradeOpened(trade), onBuyerCancelled(trade), onDispute(trade, userId),
// notify(userId, kind, data) — called inside the transaction of the event
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
  const notify = (userId, kind, data) => hooks.notify?.(userId, kind, data);
  const other = (t, userId) => (t.buyer_id === userId ? t.seller_id : t.buyer_id);
  const safety = config.safety || {};
  const DAY = 86_400_000;
  // Either side blocked the other.
  const blocked = async (a, b) =>
    !!(await db.one(
      'SELECT 1 AS x FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      [a, b, b, a]
    ));

  async function stats(userId) {
    const s = await db.one(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE status IN ('completed','cancelled')) AS closed
       FROM trades WHERE buyer_id = ? OR seller_id = ?`,
      [userId, userId]
    );
    const r = await db.one(
      'SELECT COUNT(*) FILTER (WHERE positive) AS up, COUNT(*) FILTER (WHERE NOT positive) AS down FROM trade_ratings WHERE ratee_id = ?',
      [userId]
    );
    const rated = r.up + r.down;
    return {
      completed: s.completed,
      completionRate: s.closed ? Math.round((s.completed / s.closed) * 100) : null,
      ratings: { up: r.up, down: r.down, positivePct: rated ? Math.round((r.up / rated) * 100) : null },
    };
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
      requirements: {
        requireAccept: o.require_accept,
        minTrades: o.min_trades,
        minAccountDays: o.min_account_days,
        requireId: o.require_id,
      },
      status: o.status,
      createdAt: o.created_at,
      maker: { id: maker.id, username: maker.username, displayName: maker.display_name, ...(await stats(maker.id)) },
    };
  }

  async function tradeView(t, viewerId) {
    const [b, s, offer, acct] = await Promise.all([
      nameOf(t.buyer_id), nameOf(t.seller_id), getOffer(t.offer_id), getAccount(t.seller_id, t.payment_method),
    ]);
    const isParty = viewerId === t.buyer_id || viewerId === t.seller_id;
    // The buyer sees the seller's account only while a payment is due — not before the seller accepts,
    // and not after the trade is cancelled, expired or done. Seller and staff always see it.
    const showAccount = viewerId !== t.buyer_id || (!!t.accepted_at && ['pending_payment', 'paid', 'disputed'].includes(t.status));
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
      paymentAccount: acct && showAccount ? { holderName: acct.holder_name, account: acct.account } : null,
      awaitingAccept: t.status === 'pending_payment' && !t.accepted_at,
      acceptedAt: t.accepted_at,
      counterparty: isParty ? await partySummary(other(t, viewerId)) : null,
      status: t.status,
      disputeReason: t.dispute_reason,
      resolution: t.resolution,
      expiresAt: t.expires_at,
      paidAt: t.paid_at,
      closedAt: t.closed_at,
      createdAt: t.created_at,
      myRating: viewerId && t.status === 'completed' && (viewerId === t.buyer_id || viewerId === t.seller_id)
        ? ((await db.one('SELECT positive, comment FROM trade_ratings WHERE trade_id = ? AND rater_id = ?', [t.id, viewerId])) ?? false)
        : null,
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
    const cap = config.beta?.maxOfferMicro;
    if (cap && total > cap) throw bad('beta_offer_limit', null, { max: m.fmtUsdt(cap) });
    if (!minFiat || !maxFiat || minFiat > maxFiat) throw bad('invalid_limits');
    if (minFiat > m.fiatFor(total, price)) throw bad('invalid_limits');
    const methods = Array.isArray(input.paymentMethods) ? [...new Set(input.paymentMethods)] : [];
    if (!methods.length || methods.some((pm) => !config.paymentMethods.includes(pm))) throw bad('invalid_payment_methods');
    const terms = String(input.terms ?? '').trim().slice(0, 1000);
    const window = Number.parseInt(input.paymentWindow ?? config.defaultPaymentWindowMin, 10);
    if (!(window >= 10 && window <= 180)) throw bad('invalid_payment_window');
    // Who may take the offer. Seller approval (sell offers only) keeps the payment account hidden
    // until the seller has looked at the buyer.
    const minTrades = Number.parseInt(input.minTrades ?? 0, 10);
    const minAccountDays = Number.parseInt(input.minAccountDays ?? 0, 10);
    if (!(minTrades >= 0 && minTrades <= 1000) || !(minAccountDays >= 0 && minAccountDays <= 3650)) throw bad('invalid_requirements');
    const requireId = input.requireId === true;
    const requireAccept = side === 'sell' &&
      (input.requireAccept === undefined ? safety.requireAcceptByDefault !== false : input.requireAccept === true);
    const frozen = await db.one('SELECT trade_frozen_until FROM users WHERE id = ?', [userId]);
    if (frozen?.trade_frozen_until > now()) throw forbidden('trading_paused', { until: frozen.trade_frozen_until });
    // A seller must be able to tell buyers where to send AFN.
    if (side === 'sell') {
      for (const pm of methods) if (!(await getAccount(userId, pm))) throw bad('missing_payment_account');
    }

    const o = await db.tx(async () => {
      const row = await db.one(
        `INSERT INTO offers (user_id, side, price, total, remaining, min_fiat, max_fiat, payment_methods, terms, payment_window,
                             require_accept, min_trades, min_account_days, require_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?) RETURNING *`,
        [userId, side, price, total, total, minFiat, maxFiat, JSON.stringify(methods), terms, window,
          requireAccept, minTrades, minAccountDays, requireId, now()]
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
  async function listMarket({ side = 'buy', paymentMethod, fiat, viewerId = null } = {}) {
    const offerSide = side === 'sell' ? 'buy' : 'sell';
    const order = offerSide === 'sell' ? 'ASC' : 'DESC';
    // Offers of anyone the viewer blocked, or who blocked the viewer, are left out.
    let rows = await db.query(
      `SELECT o.* FROM offers o JOIN users u ON u.id = o.user_id
       WHERE o.status = 'active' AND o.side = ? AND o.remaining > 0 AND u.is_blocked = 0
         AND NOT EXISTS (SELECT 1 FROM user_blocks b
                         WHERE (b.blocker_id = o.user_id AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = o.user_id))
       ORDER BY o.price ${order}, o.id ASC LIMIT 200`,
      [offerSide, viewerId ?? 0, viewerId ?? 0]
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
      if (await blocked(o.user_id, takerId)) throw conflict('offer_unavailable');
      const taker = await db.one('SELECT kyc_tier, created_at, trade_frozen_until FROM users WHERE id = ?', [takerId]);
      const ts = now();
      if (taker.trade_frozen_until > ts) throw forbidden('trading_paused', { until: taker.trade_frozen_until });
      const done = (await db.one(
        "SELECT COUNT(*) AS n FROM trades WHERE (buyer_id = ? OR seller_id = ?) AND status = 'completed'", [takerId, takerId]
      )).n;
      const ageDays = Math.floor((ts - taker.created_at) / DAY);
      if (done < o.min_trades || ageDays < o.min_account_days || (o.require_id && taker.kyc_tier < 2)) {
        throw bad('requirements_not_met', null, { minTrades: o.min_trades, minAccountDays: o.min_account_days, requireId: o.require_id });
      }

      let amount;
      if (input.fiat !== undefined && input.fiat !== '') {
        const f = m.parseAfn(input.fiat);
        if (!f) throw bad('invalid_amount');
        amount = m.usdtFor(f, o.price);
      } else {
        amount = m.parseUsdt(input.amount);
      }
      if (!amount) throw bad('invalid_amount');
      const cap = config.beta?.maxTradeMicro;
      if (cap && amount > cap) throw bad('beta_trade_limit', null, { max: m.fmtUsdt(cap) });
      // New accounts start small: a throwaway account cannot open large trades to fish for accounts.
      const newCap = safety.newAccountMaxMicro;
      if (newCap && amount > newCap && ageDays < (safety.newAccountDays ?? 7) && done < (safety.newAccountTrades ?? 3)) {
        throw bad('new_account_limit', null, { max: m.fmtUsdt(newCap) });
      }
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
      // With seller approval the trade first waits a short accept window; the payment timer starts on accept.
      const waits = o.side === 'sell' && o.require_accept;
      const expires = ts + (waits ? (safety.acceptWindowMin ?? 10) : o.payment_window) * 60_000;
      const trade = await db.one(
        `INSERT INTO trades (offer_id, maker_id, taker_id, buyer_id, seller_id, amount, price, fiat, fee, payment_method, status,
                             expires_at, accepted_at, revealed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?) RETURNING *`,
        [o.id, o.user_id, takerId, buyerId, sellerId, amount, o.price, fiat, fee, pm, expires, waits ? null : ts, waits ? null : ts, ts]
      );
      await db.run('UPDATE offers SET remaining = remaining - ? WHERE id = ?', [amount, o.id]);
      // For a buy offer the taker is the seller: lock their USDT now.
      if (o.side === 'buy') await wallet.lock(sellerId, amount, 'trade_lock', { type: 'trade', id: trade.id });
      await sys(trade.id, waits ? 'trade_awaiting_accept' : 'trade_opened');
      await notify(o.user_id, waits ? 'trade_request' : 'trade_opened', { tradeId: trade.id, amount: m.fmtUsdt(amount) });
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
    const data = { tradeId: t.id, amount: m.fmtUsdt(t.amount - t.fee), resolution };
    if (resolution === 'released') await notify(t.buyer_id, 'trade_released', data);
    else if (resolution.startsWith('resolved')) {
      await notify(t.buyer_id, 'trade_resolved', data);
      await notify(t.seller_id, 'trade_resolved', data);
    } else if (resolution === 'cancelled_by_buyer') await notify(t.seller_id, 'trade_cancelled', data);
    else if (resolution === 'declined_by_seller') await notify(t.buyer_id, 'trade_declined', data);
    else {
      await notify(t.buyer_id, 'trade_cancelled', data);
      await notify(t.seller_id, 'trade_cancelled', data);
    }
    if (status === 'cancelled' && t.revealed_at && ['cancelled_by_buyer', 'expired'].includes(resolution)) await checkRevealAbuse(t.buyer_id);
  }

  // A buyer who keeps cancelling (or letting expire) trades after seeing the seller's account is likely
  // collecting accounts: pause their trading and alert staff.
  async function checkRevealAbuse(buyerId) {
    const limit = safety.revealCancelLimit ?? 3;
    if (!limit) return;
    const ts = now();
    const { n } = await db.one(
      `SELECT COUNT(*) AS n FROM trades
       WHERE buyer_id = ? AND status = 'cancelled' AND revealed_at IS NOT NULL
         AND resolution IN ('cancelled_by_buyer','expired') AND closed_at > ?`,
      [buyerId, ts - DAY]
    );
    if (n < limit) return;
    const until = ts + (safety.freezeDays ?? 7) * DAY;
    const r = await db.run('UPDATE users SET trade_frozen_until = ? WHERE id = ? AND trade_frozen_until < ?', [until, buyerId, ts]);
    if (r.rowCount) await hooks.onRevealAbuse?.(buyerId, n);
  }

  // Cancels unpaid trades whose payment window ended. Safe to run from several processes at once.
  async function expireTrades() {
    const due = await db.query("SELECT id FROM trades WHERE status = 'pending_payment' AND expires_at < ? LIMIT 100", [now()]);
    let n = 0;
    for (const { id } of due) {
      await db.tx(async () => {
        const t = await db.one("SELECT * FROM trades WHERE id = ? AND status = 'pending_payment' AND expires_at < ? FOR UPDATE SKIP LOCKED", [id, now()]);
        if (!t) return;
        // A request the seller never answered is closed as not accepted, not as an unpaid trade.
        await close(t, 'cancelled', t.accepted_at ? 'expired' : 'not_accepted');
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
        case 'accept': {
          if (!isSeller) throw forbidden();
          if (t.status !== 'pending_payment' || t.accepted_at) throw conflict('invalid_state');
          const o = await getOffer(t.offer_id);
          const ts = now();
          await db.run('UPDATE trades SET accepted_at = ?, revealed_at = ?, expires_at = ? WHERE id = ?',
            [ts, ts, ts + o.payment_window * 60_000, t.id]);
          await sys(t.id, 'trade_accepted');
          await notify(t.buyer_id, 'trade_accepted', { tradeId: t.id, amount: m.fmtUsdt(t.amount) });
          break;
        }
        case 'decline':
          if (!isSeller) throw forbidden();
          if (t.status !== 'pending_payment' || t.accepted_at) throw conflict('invalid_state');
          await close(t, 'cancelled', 'declined_by_seller');
          break;
        case 'pay':
          if (!isBuyer) throw forbidden();
          if (t.status !== 'pending_payment') throw conflict('invalid_state');
          if (!t.accepted_at) throw conflict('awaiting_acceptance');
          await db.run("UPDATE trades SET status = 'paid', paid_at = ? WHERE id = ?", [now(), t.id]);
          await sys(t.id, 'trade_marked_paid');
          await notify(t.seller_id, 'trade_paid', { tradeId: t.id, amount: m.fmtUsdt(t.amount) });
          break;
        case 'release':
          if (!isSeller) throw forbidden();
          if (t.status !== 'paid' && t.status !== 'pending_payment') throw conflict('invalid_state');
          if (!t.accepted_at) throw conflict('awaiting_acceptance');
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
          await notify(other(t, userId), 'trade_disputed', { tradeId: t.id });
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
    const t = isStaff ? await getTrade(tradeId) : await loadForParty(userId, tradeId);
    if (!t) throw notFound();
    const text = String(body ?? '').trim().slice(0, 2000);
    if (!text) throw bad('empty_message');
    await db.tx(async () => {
      await addMsg(tradeId, userId, text);
      // Tell the other side (both sides when staff writes).
      for (const uid of [t.buyer_id, t.seller_id]) if (uid !== userId) await notify(uid, 'trade_message', { tradeId: t.id });
    });
    return { ok: true };
  }

  // ---------- ratings ----------
  // Each side rates the other once, after a completed trade.
  async function rate(userId, tradeId, input = {}) {
    if (typeof input.positive !== 'boolean') throw bad('invalid_rating');
    const comment = String(input.comment ?? '').trim().slice(0, 300) || null;
    await db.tx(async () => {
      const t = await loadForParty(userId, tradeId, true);
      if (t.status !== 'completed') throw conflict('invalid_state');
      const r = await db.run(
        `INSERT INTO trade_ratings (trade_id, rater_id, ratee_id, positive, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [t.id, userId, other(t, userId), input.positive, comment, now()]
      );
      if (!r.rowCount) throw conflict('already_rated');
    });
    return tradeView(await getTrade(tradeId), userId);
  }

  // What a trade party sees about the other side (for the seller deciding whether to accept).
  async function partySummary(userId) {
    const u = await db.one('SELECT username, kyc_tier, created_at FROM users WHERE id = ?', [userId]);
    return { username: u.username, memberSince: u.created_at, idVerified: u.kyc_tier >= 2, ...(await stats(userId)) };
  }

  // ---------- blocking ----------
  const findUser = (username) =>
    db.one("SELECT id FROM users WHERE lower(username) = lower(?) AND role = 'user'", [String(username ?? '')]);

  async function block(userId, username) {
    const u = await findUser(username);
    if (!u) throw notFound();
    if (u.id === userId) throw bad('cannot_block_self');
    await db.run('INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [userId, u.id, now()]);
    return { ok: true };
  }

  async function unblock(userId, username) {
    const u = await findUser(username);
    if (!u) throw notFound();
    await db.run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [userId, u.id]);
    return { ok: true };
  }

  async function blocks(userId) {
    const rows = await db.query(
      `SELECT u.username, u.display_name, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 500`,
      [userId]
    );
    return rows.map((r) => ({ username: r.username, displayName: r.display_name, blockedAt: r.created_at }));
  }

  // ---------- public trader profile ----------
  async function publicProfile(username, viewerId = null) {
    const u = await db.one(
      "SELECT id, username, display_name, kyc_tier, created_at FROM users WHERE lower(username) = lower(?) AND role = 'user' AND is_blocked = 0",
      [String(username ?? '')]
    );
    if (!u) throw notFound();
    const blockedByMe = viewerId
      ? !!(await db.one('SELECT 1 AS x FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [viewerId, u.id]))
      : false;
    // Someone who blocked the viewer shows no offers to them.
    const hidden = viewerId ? await blocked(viewerId, u.id) : false;
    const release = await db.one(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY closed_at - paid_at) AS ms, COUNT(*) AS n
       FROM trades WHERE seller_id = ? AND status = 'completed' AND resolution = 'released' AND paid_at IS NOT NULL`,
      [u.id]
    );
    const reviews = await db.query(
      `SELECT r.positive, r.comment, r.created_at, (r.rater_id = t.buyer_id) AS rater_was_buyer
       FROM trade_ratings r JOIN trades t ON t.id = r.trade_id WHERE r.ratee_id = ? ORDER BY r.created_at DESC LIMIT 20`,
      [u.id]
    );
    const offers = await db.query(
      "SELECT * FROM offers WHERE user_id = ? AND status = 'active' AND remaining > 0 ORDER BY id DESC LIMIT 10",
      [u.id]
    );
    return {
      username: u.username,
      displayName: u.display_name,
      verified: u.kyc_tier >= 2,
      memberSince: u.created_at,
      ...(await stats(u.id)),
      medianReleaseMinutes: release.n && release.ms != null ? Math.max(1, Math.round(release.ms / 60_000)) : null,
      reviews: reviews.map((r) => ({ positive: r.positive, comment: r.comment, createdAt: r.created_at, from: r.rater_was_buyer ? 'buyer' : 'seller' })),
      offers: hidden ? [] : await Promise.all(offers.filter((o) => m.fiatFor(o.remaining, o.price) >= o.min_fiat).map(offerView)),
      isMe: viewerId === u.id,
      blockedByMe,
    };
  }

  return {
    OPEN, stats, createOffer, setOfferStatus, listMarket, myOffers, offer,
    openTrade, action, resolveDispute, trade, myTrades, listTrades, messages, postMessage, expireTrades,
    rate, publicProfile, block, unblock, blocks,
  };
}

module.exports = { createMarket };
