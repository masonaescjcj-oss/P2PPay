'use strict';

// Notifications. notify() writes a row inside the caller's transaction, so a notification exists
// exactly when its event happened. Rows with pushed_at IS NULL form a push outbox: a worker on each
// instance claims them with FOR UPDATE SKIP LOCKED, sends Web Push to the user's devices and marks
// them, so several instances never send the same one twice.
const { bad } = require('./errors');

// Kinds that also go to the user's phone.
const PUSH_KINDS = new Set([
  'trade_opened', 'trade_request', 'trade_accepted', 'trade_declined', 'trade_paid', 'trade_released', 'trade_cancelled', 'trade_disputed', 'trade_resolved',
  'trade_message', 'deposit_credited', 'withdrawal_sent', 'withdrawal_rejected', 'kyc_approved', 'kyc_rejected',
]);

// Push texts (the in-app list is rendered by the web app from the same kind + data).
const TEXT = {
  fa: {
    trade_opened: ['معاملهٔ جدید', 'کسی روی آگهی شما معامله‌ای به مقدار {amount} تتر باز کرد.'],
    trade_request: ['درخواست معامله', 'کسی می‌خواهد {amount} تتر از شما بخرد. بررسی کنید و بپذیرید یا رد کنید.'],
    trade_accepted: ['فروشنده پذیرفت', 'حالا پول را بپردازید و «پرداخت کردم» را بزنید.'],
    trade_declined: ['درخواست رد شد', 'فروشنده این معامله را نپذیرفت. آگهی دیگری را امتحان کنید.'],
    trade_paid: ['خریدار پرداخت کرد', 'حساب خود را بررسی کنید و اگر پول رسیده، تتر را آزاد کنید.'],
    trade_released: ['تتر آزاد شد', '{amount} تتر به کیف پول شما اضافه شد.'],
    trade_cancelled: ['معامله لغو شد', 'معاملهٔ #{tradeId} لغو شد.'],
    trade_disputed: ['شکایت باز شد', 'برای معاملهٔ #{tradeId} شکایت ثبت شد؛ پشتیبانی بررسی می‌کند.'],
    trade_resolved: ['داوری انجام شد', 'پشتیبانی دربارهٔ معاملهٔ #{tradeId} تصمیم گرفت.'],
    trade_message: ['پیام جدید', 'در معاملهٔ #{tradeId} پیام تازه دارید.'],
    deposit_credited: ['واریز انجام شد', '{amount} تتر به کیف پول شما واریز شد.'],
    withdrawal_sent: ['برداشت ارسال شد', '{amount} تتر به آدرس شما فرستاده شد.'],
    withdrawal_rejected: ['برداشت انجام نشد', 'درخواست برداشت شما رد شد و موجودی برگشت.'],
    kyc_approved: ['احراز هویت تأیید شد', 'سطح شما به {tier} رسید.'],
    kyc_rejected: ['مدارک تأیید نشد', 'برای جزئیات صفحهٔ احراز هویت را ببینید.'],
  },
  en: {
    trade_opened: ['New trade', 'Someone opened a {amount} USDT trade on your offer.'],
    trade_request: ['Trade request', 'Someone wants to buy {amount} USDT from you. Review and accept or decline.'],
    trade_accepted: ['Seller accepted', 'Now send the payment and tap “I have paid”.'],
    trade_declined: ['Request declined', 'The seller did not accept this trade. Try another offer.'],
    trade_paid: ['Buyer has paid', 'Check your account and release the USDT if the money arrived.'],
    trade_released: ['USDT released', '{amount} USDT was added to your wallet.'],
    trade_cancelled: ['Trade cancelled', 'Trade #{tradeId} was cancelled.'],
    trade_disputed: ['Dispute opened', 'A dispute was opened on trade #{tradeId}; support is reviewing it.'],
    trade_resolved: ['Dispute decided', 'Support decided trade #{tradeId}.'],
    trade_message: ['New message', 'You have a new message in trade #{tradeId}.'],
    deposit_credited: ['Deposit received', '{amount} USDT was added to your wallet.'],
    withdrawal_sent: ['Withdrawal sent', '{amount} USDT was sent to your address.'],
    withdrawal_rejected: ['Withdrawal not sent', 'Your withdrawal was rejected and the balance returned.'],
    kyc_approved: ['Verification approved', 'You are now level {tier}.'],
    kyc_rejected: ['Documents not approved', 'See the verification page for details.'],
  },
};
// Amounts read better with at most 2 decimals in a notification ("41.96", not "41.958041").
const show = (k, v) => (k === 'amount' && v != null && Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : v);
const fill = (s, data) => s.replace(/\{(\w+)\}/g, (_, k) => (show(k, data[k]) ?? '').toString());

function urlFor(kind, data) {
  if (data.tradeId) return kind === 'trade_message' ? `/trades/${data.tradeId}/chat` : `/trades/${data.tradeId}`;
  if (kind.startsWith('deposit') || kind.startsWith('withdrawal')) return '/wallet';
  if (kind.startsWith('kyc')) return '/profile/verification';
  if (kind === 'feedback_reply') return '/profile/feedback';
  return '/notifications';
}

// deps.push(subscription, payloadString) → resolves, or rejects with { statusCode } (404/410 = gone).
function createNotifier(db, config, { push = null, log = console } = {}) {
  const now = () => Date.now();
  const sender = push || webPushSender(config, log);

  async function notify(userId, kind, data = {}) {
    if (!userId) return;
    // One unread "new message" per trade: refresh it instead of stacking.
    if (kind === 'trade_message') {
      // Push again only if the last push for this chat is more than 5 minutes old.
      const r = await db.run(
        `UPDATE notifications SET created_at = ?, pushed_at = CASE WHEN ? AND created_at < ? THEN NULL ELSE pushed_at END
         WHERE user_id = ? AND kind = 'trade_message' AND trade_id = ? AND read_at IS NULL`,
        [now(), !!sender, now() - 5 * 60_000, userId, data.tradeId]
      );
      if (r.rowCount) return;
    }
    await db.run(
      'INSERT INTO notifications (user_id, kind, data, trade_id, pushed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, kind, JSON.stringify(data), data.tradeId ?? null, PUSH_KINDS.has(kind) && sender ? null : now(), now()]
    );
  }

  const view = (r) => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data), url: urlFor(r.kind, JSON.parse(r.data)), read: !!r.read_at, createdAt: r.created_at });

  async function list(userId, before = null) {
    const rows = await db.query(
      'SELECT * FROM notifications WHERE user_id = ? AND (?::bigint IS NULL OR id < ?) ORDER BY id DESC LIMIT 50',
      [userId, before, before]
    );
    return { items: rows.map(view), unread: await unread(userId) };
  }

  const unread = async (userId) => (await db.one('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])).n;

  async function markRead(userId, ids) {
    if (ids === 'all') {
      await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [now(), userId]);
    } else {
      const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
      for (const id of list) await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', [now(), id, userId]);
    }
    return unread(userId);
  }

  // ---------- web push ----------
  async function subscribe(userId, input) {
    const endpoint = String(input?.endpoint ?? '')
    const p256dh = String(input?.keys?.p256dh ?? '')
    const auth = String(input?.keys?.auth ?? '')
    if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,100}$/.test(auth)) {
      throw bad('invalid_subscription');
    }
    const lang = input.lang === 'en' ? 'en' : 'fa';
    // An endpoint belongs to one browser: re-subscribing moves it to whoever is signed in now.
    await db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         lang = excluded.lang, failures = 0`,
      [userId, endpoint, p256dh, auth, lang, now()]
    );
  }

  const unsubscribe = (userId, endpoint) =>
    db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, String(endpoint ?? '')]);

  // Sends what is waiting in the outbox. Safe to run on every instance at once.
  async function flush(limit = 25) {
    if (!sender) return 0;
    let sent = 0;
    await db.tx(async () => {
      const rows = await db.query(
        'SELECT * FROM notifications WHERE pushed_at IS NULL ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED',
        [limit]
      );
      for (const n of rows) {
        if (n.created_at < now() - 3_600_000) {
          await db.run('UPDATE notifications SET pushed_at = ? WHERE id = ?', [now(), n.id]); // too old to be useful
          continue;
        }
        const data = JSON.parse(n.data);
        const subs = await db.query('SELECT * FROM push_subscriptions WHERE user_id = ?', [n.user_id]);
        for (const s of subs) {
          const [title, body] = (TEXT[s.lang] || TEXT.fa)[n.kind] || [n.kind, ''];
          const payload = JSON.stringify({ title: fill(title, data), body: fill(body, data), url: urlFor(n.kind, data), tag: n.trade_id ? `trade-${n.trade_id}` : n.kind });
          try {
            await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
            await db.run('UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?', [now(), s.id]);
            sent++;
          } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) await db.run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
            else await db.run('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?', [s.id]);
            log.warn(`[push] ${err.statusCode || err.message}`);
          }
        }
        await db.run('UPDATE notifications SET pushed_at = ? WHERE id = ?', [now(), n.id]);
      }
      // Devices that keep failing are dropped.
      await db.run('DELETE FROM push_subscriptions WHERE failures >= 10');
    });
    return sent;
  }

  let timer = null;
  return {
    notify, list, unread, markRead, subscribe, unsubscribe, flush,
    publicKey: () => (sender ? config.push?.publicKey || null : null),
    start() {
      if (!sender || timer) return;
      timer = setInterval(() => flush().catch((e) => log.warn(`[push] flush: ${e.message}`)), 3000);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

// Web Push with VAPID keys (npx web-push generate-vapid-keys). Without keys: in-app only.
function webPushSender(config, log) {
  const p = config.push || {};
  if (!p.publicKey || !p.privateKey) return null;
  const webpush = require('web-push');
  webpush.setVapidDetails(p.subject || 'mailto:support@example.org', p.publicKey, p.privateKey);
  log.warn?.('[push] web push enabled');
  return (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'high' });
}

module.exports = { createNotifier, PUSH_KINDS };
