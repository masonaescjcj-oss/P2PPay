// Sample data for the in-browser test version, shared by the page (demo/server.js) and the build
// (demo/make-snapshot.mjs): the admin, three sample traders who answer trades on their own, and ready-made
// account histories. Everything goes through the real server modules, so balances and ledgers add up.

export const ADMIN = { username: 'admin', password: 'admin-test-1405' }
// scrypt hash (N=1024, as in shims/crypto.js) of ADMIN.password, made ahead of time.
const ADMIN_HASH = 'scrypt$bcadd78f7d2e7ed75ba228d0425f6ead$98b20d881517e7684d51f758cdba074eb7deceef1bae7e0fe7bc9c4ec8c383152f8c46e4745de5389880bf05ee4b2650baa0ae9e963ef98e851bcf72604f974e'

// ---------- sample traders ----------
const BOTS = [
  { username: 'demo_karim', name: 'کریم (نمونه)', phone: '+93700000101', method: 'hesabpay', account: '0700 000 101',
    offer: { side: 'sell', price: '71.5', total: '400', minFiat: '500', maxFiat: '28000', paymentMethods: ['hesabpay', 'mpaisa', 'cash'],
      terms: 'حساب نمونه برای آزمایش: پس از «پرداخت کردم» چند ثانیه بعد خودکار آزاد می‌کند.' } },
  { username: 'demo_ahmad', name: 'احمد (نمونه)', phone: '+93700000102', method: 'mhawala', account: '0700 000 102',
    offer: { side: 'sell', price: '71.9', total: '150', minFiat: '1000', maxFiat: '10000', paymentMethods: ['mhawala', 'hawala'],
      terms: 'حساب نمونه برای آزمایش.' } },
  { username: 'demo_zahra', name: 'زهرا (نمونه)', phone: '+93700000103', method: 'bank', account: 'AF00 0000 0000 0103',
    offer: { side: 'buy', price: '70.8', total: '300', minFiat: '500', maxFiat: '21000', paymentMethods: ['hesabpay', 'bank'],
      terms: 'حساب نمونه برای آزمایش: بعد از باز شدن معامله، چند ثانیه بعد «پرداخت کردم» را می‌زند؛ شما آزاد کنید.' } },
]
const EXTRA_ACCOUNTS = { demo_karim: ['mpaisa', 'cash'], demo_ahmad: ['hawala'], demo_zahra: ['hesabpay'] }

export async function seed(db) {
  const now = Date.now()
  await db.run(
    "INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, 'Admin', ?, 'admin', ?) ON CONFLICT DO NOTHING",
    [ADMIN.username, ADMIN_HASH, now]
  )
  for (const b of BOTS) {
    let u = await db.one('SELECT id FROM users WHERE username = ?', [b.username])
    if (!u) {
      u = await db.one(
        `INSERT INTO users (username, display_name, password_hash, phone, phone_verified_at, kyc_tier, created_at)
         VALUES (?, ?, ?, ?, ?, 2, ?) RETURNING id`,
        // Sample traders never sign in: no usable password (and no slow hashing at startup).
        [b.username, b.name, 'disabled', b.phone, now, now - 30 * 86_400_000]
      )
      for (const method of [b.method, ...EXTRA_ACCOUNTS[b.username]]) {
        await db.run(
          `INSERT INTO payment_accounts (user_id, method, holder_name, account, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, method) DO NOTHING`,
          [u.id, method, b.name.replace(' (نمونه)', ''), b.account, now]
        )
      }
    }
    b.id = u.id
  }
}

// Keeps each sample trader's offer available and answers trades a few seconds after each step.
const seen = new Map()
export async function botTick(db, s) {
  const { wallet, market } = s
  for (const b of BOTS) {
    const bal = await wallet.balance(b.id)
    if (bal.available < 2_000_000_000) await wallet.credit(b.id, 5_000_000_000, 'deposit', { type: 'demo', id: null })
    const active = await db.one(
      "SELECT id FROM offers WHERE user_id = ? AND status = 'active' AND remaining >= 50000000 LIMIT 1",
      [b.id]
    )
    if (!active) {
      // Close what is left of the old offer (its escrow goes back to the balance), then post a fresh one.
      for (const o of await db.query("SELECT id FROM offers WHERE user_id = ? AND status <> 'closed'", [b.id])) {
        await market.setOfferStatus(b.id, o.id, 'closed').catch(() => {})
      }
      await market.createOffer(b.id, b.offer).catch((e) => console.debug('[demo] offer', e.code || e.message))
    }
  }
  const ids = BOTS.map((b) => b.id)
  const list = ids.map(Number).join(',') // ids come from the database
  const trades = await db.query(
    `SELECT id, buyer_id, seller_id, status, accepted_at FROM trades
     WHERE status IN ('pending_payment','paid') AND (buyer_id IN (${list}) OR seller_id IN (${list}))`
  )
  const t0 = Date.now()
  for (const t of trades) {
    const waiting = t.status === 'pending_payment' && !t.accepted_at
    const key = `${t.id}:${t.status}:${waiting ? 'request' : 'open'}`
    if (!seen.has(key)) {
      seen.set(key, t0)
      if (waiting) {
        if (ids.includes(t.seller_id)) {
          await market.postMessage(t.seller_id, t.id, 'سلام! درخواست شما را دیدم؛ چند ثانیه دیگر می‌پذیرم تا حساب پرداخت برایتان نمایش داده شود. (آزمایشی)').catch(() => {})
        }
      } else if (t.status === 'pending_payment') {
        const bot = ids.includes(t.seller_id) ? t.seller_id : t.buyer_id
        await market.postMessage(bot, t.id, ids.includes(t.seller_id)
          ? 'سلام! من حساب نمونه‌ام. پول را به حسابی که در معامله نشان داده شده بفرستید (در آزمایش لازم نیست واقعاً بفرستید) و «پرداخت کردم» را بزنید.'
          : 'سلام! من حساب نمونه‌ام. چند ثانیه دیگر «پرداخت کردم» را می‌زنم؛ بعد شما تتر را آزاد کنید.').catch(() => {})
      }
      continue
    }
    if (t0 - seen.get(key) < 5000) continue
    if (waiting) {
      // Sample sellers approve every request (a real seller would look at the buyer first).
      if (ids.includes(t.seller_id)) await market.action(t.seller_id, t.id, 'accept', {}).catch(() => {})
    } else if (t.status === 'pending_payment' && ids.includes(t.buyer_id)) {
      await market.postMessage(t.buyer_id, t.id, 'پرداخت کردم ✓ (آزمایشی)').catch(() => {})
      await market.action(t.buyer_id, t.id, 'pay', {}).catch(() => {})
    } else if (t.status === 'paid' && ids.includes(t.seller_id)) {
      await market.postMessage(t.seller_id, t.id, 'پول رسید، آزاد کردم ✓ (آزمایشی)').catch(() => {})
      await market.action(t.seller_id, t.id, 'release', {}).catch(() => {})
    }
  }
}


// ---------- a ready-made history for every new test account ----------
// So the app never looks empty: a deposit, a finished buy and sell with the sample traders, a payment
// account, ratings and notifications, dated over the last days. Runs through the real server modules.
const HOUR = 3_600_000
const DAY = 24 * HOUR
const txid = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')

async function needsHistory(db, userId) {
  const u = await db.one("SELECT role FROM users WHERE id = ?", [userId])
  if (!u || u.role !== 'user') return false
  const l = await db.one('SELECT COUNT(*) AS n FROM ledger WHERE user_id = ?', [userId])
  return l.n === 0
}

export async function seedHistory(db, services, userId) {
  if (!(await needsHistory(db, userId))) return
  const { market, funds } = services
  const bot = (name) => BOTS.find((b) => b.username === name)
  // An active offer with room for `micro`; the sample trader posts a fresh one when it runs low.
  const offerOf = async (b, side, micro) => {
    const find = () =>
      db.one("SELECT id FROM offers WHERE user_id = ? AND side = ? AND status = 'active' AND remaining >= ? ORDER BY id DESC LIMIT 1", [b.id, side, micro])
    let o = await find()
    if (!o) {
      for (const x of await db.query("SELECT id FROM offers WHERE user_id = ? AND status = 'active'", [b.id])) {
        await services.market.setOfferStatus(b.id, x.id, 'closed')
      }
      await botTick(db, services)
      o = await find()
    }
    return o.id
  }
  const now = Date.now()
  const user = await db.one('SELECT display_name, kyc_tier FROM users WHERE id = ?', [userId])
  // Trading needs a verified phone (tier 1). Borrow it for the history, then give the account back as it
  // was, so the "verify your phone" step still works. The account is dated back two weeks.
  // One transaction: the browser database writes to IndexedDB once instead of after every statement.
  await db.tx(async () => {
  await db.run('UPDATE users SET kyc_tier = GREATEST(kyc_tier, 1), created_at = ? WHERE id = ?', [now - 14 * DAY, userId])
  try {
    const dep = await funds.requestDeposit(userId, { amount: '1000', txid: txid() })
    await funds.reviewDeposit(dep.id, true, { note: 'شارژ آزمایشی' }, null)
    await db.run(
      `INSERT INTO payment_accounts (user_id, method, holder_name, account, created_at) VALUES (?, 'hesabpay', ?, '0799 123 456', ?)
       ON CONFLICT (user_id, method) DO NOTHING`,
      [userId, user.display_name, now]
    )

    const karim = bot('demo_karim')
    const buy = await market.openTrade(userId, await offerOf(karim, 'sell', 100_000_000), { amount: '100', paymentMethod: 'hesabpay' })
    await market.action(karim.id, buy.id, 'accept')
    await market.postMessage(karim.id, buy.id, 'سلام! پذیرفتم، به همین حساب HesabPay بفرستید.')
    await market.postMessage(userId, buy.id, 'فرستادم، ممنون.')
    await market.action(userId, buy.id, 'pay')
    await market.action(karim.id, buy.id, 'release')
    await market.rate(userId, buy.id, { positive: true, comment: 'سریع آزاد کرد، ممنون' })
    await market.rate(karim.id, buy.id, { positive: true, comment: 'خریدار خوش‌حساب' })

    const zahra = bot('demo_zahra')
    const sell = await market.openTrade(userId, await offerOf(zahra, 'buy', 60_000_000), { amount: '60', paymentMethod: 'hesabpay' })
    await market.postMessage(zahra.id, sell.id, 'سلام، الان پرداخت می‌کنم.')
    await market.action(zahra.id, sell.id, 'pay')
    await market.action(userId, sell.id, 'release')
    await market.rate(zahra.id, sell.id, { positive: true, comment: 'فروشندهٔ مطمئن' })

    // An open sell offer of the account's own (its USDT waits in escrow).
    await market.createOffer(userId, {
      side: 'sell', price: '72.2', total: '200', minFiat: '1000', maxFiat: '14440', paymentMethods: ['hesabpay'],
      terms: 'پرداخت فقط از حساب به نام خودتان.', requireAccept: true,
    })

    // Spread it over the last days (and out of the 24h trading limit window).
    const dated = [[buy.id, now - 2 * DAY - 5 * HOUR], [sell.id, now - 31 * HOUR]]
    await db.run('UPDATE deposits SET created_at = ?, reviewed_at = ? WHERE id = ?', [now - 3 * DAY, now - 3 * DAY + 60_000, dep.id])
    await db.run("UPDATE ledger SET created_at = ? WHERE ref_type = 'deposit' AND ref_id = ?", [now - 3 * DAY + 60_000, dep.id])
    await db.run("UPDATE notifications SET created_at = ? WHERE user_id = ? AND kind = 'deposit_credited'", [now - 3 * DAY + 60_000, userId])
    for (const [id, t] of dated) {
      await db.run(
        `UPDATE trades SET created_at = ?, accepted_at = ?, revealed_at = ?, paid_at = ?, closed_at = ?, expires_at = ? WHERE id = ?`,
        [t, t + 60_000, t + 60_000, t + 5 * 60_000, t + 9 * 60_000, t + 31 * 60_000, id]
      )
      await db.run('UPDATE trade_messages SET created_at = ? + (id - (SELECT MIN(id) FROM trade_messages WHERE trade_id = ?)) * 60000 WHERE trade_id = ?', [t, id, id])
      await db.run("UPDATE ledger SET created_at = ? WHERE ref_type = 'trade' AND ref_id = ?", [t + 9 * 60_000, id])
      await db.run('UPDATE notifications SET created_at = ? WHERE trade_id = ?', [t + 9 * 60_000, id])
      await db.run('UPDATE trade_ratings SET created_at = ? WHERE trade_id = ?', [t + 12 * 60_000, id])
    }
  } finally {
    await db.run('UPDATE users SET kyc_tier = ? WHERE id = ?', [user.kyc_tier, userId])
  }
  })
}

// ---------- histories prepared at build time ----------
// Creating a history in the page takes long on a phone (the whole database runs in the page), so the
// build prepares a few in the snapshot, owned by hidden placeholder accounts. A new sign-up takes one
// over: a handful of updates that move it to the new account and shift its dates to "the last days".
const TEMPLATE = 'template-history'

export async function makeTemplates(db, services, n = 5) {
  const now = Date.now()
  for (let i = 1; i <= n; i++) {
    const u = await db.one(
      `INSERT INTO users (username, display_name, password_hash, is_blocked, created_at) VALUES (?, 'AriaPay', ?, 1, ?) RETURNING id`,
      [`history_${i}`, TEMPLATE, now]
    )
    await seedHistory(db, services, u.id)
  }
}

// Gives userId a prepared history; false when none is left.
export async function claimHistory(db, userId) {
  if (!(await needsHistory(db, userId))) return true
  return db.tx(async () => {
    const tpl = await db.one('SELECT id, created_at FROM users WHERE password_hash = ? ORDER BY id LIMIT 1 FOR UPDATE', [TEMPLATE])
    if (!tpl) return false
    const me = await db.one('SELECT display_name FROM users WHERE id = ?', [userId])
    const t = tpl.id
    const d = Date.now() - 14 * DAY - tpl.created_at // template accounts are dated 14 days back
    const swap = (col) => `${col} = CASE WHEN ${col} = ${Number(t)} THEN ${Number(userId)} ELSE ${col} END`
    const tradesOf = `(SELECT id FROM trades WHERE buyer_id = ${Number(t)} OR seller_id = ${Number(t)})`
    await db.run(`UPDATE trade_messages SET created_at = created_at + ?, ${swap('user_id')} WHERE trade_id IN ${tradesOf}`, [d])
    await db.run(`UPDATE trade_ratings SET created_at = created_at + ?, ${swap('rater_id')}, ${swap('ratee_id')} WHERE trade_id IN ${tradesOf}`, [d])
    await db.run(`UPDATE notifications SET created_at = created_at + ?, ${swap('user_id')} WHERE user_id = ? OR trade_id IN ${tradesOf}`, [d, t])
    await db.run(`UPDATE ledger SET created_at = created_at + ?, ${swap('user_id')} WHERE user_id = ? OR (ref_type = 'trade' AND ref_id IN ${tradesOf})`, [d, t])
    await db.run('UPDATE deposits SET created_at = created_at + ?, reviewed_at = reviewed_at + ?, user_id = ? WHERE user_id = ?', [d, d, userId, t])
    await db.run(
      `UPDATE payment_accounts SET user_id = ?, holder_name = ?, created_at = created_at + ?
       WHERE user_id = ? AND method NOT IN (SELECT method FROM payment_accounts WHERE user_id = ?)`,
      [userId, me.display_name, d, t, userId]
    )
    await db.run('DELETE FROM payment_accounts WHERE user_id = ?', [t])
    await db.run('DELETE FROM balances WHERE user_id = ?', [userId]) // empty: the account has no ledger yet
    await db.run('UPDATE balances SET user_id = ? WHERE user_id = ?', [userId, t])
    await db.run(
      `UPDATE trades SET created_at = created_at + ?, accepted_at = accepted_at + ?, revealed_at = revealed_at + ?, paid_at = paid_at + ?,
         closed_at = closed_at + ?, expires_at = expires_at + ?, ${swap('buyer_id')}, ${swap('seller_id')}, ${swap('maker_id')}, ${swap('taker_id')}
       WHERE buyer_id = ? OR seller_id = ?`,
      [d, d, d, d, d, d, t, t]
    )
    await db.run('UPDATE offers SET user_id = ?, created_at = created_at + ? WHERE user_id = ?', [userId, d, t])
    await db.run('UPDATE alerts SET user_id = ? WHERE user_id = ?', [userId, t])
    await db.run('UPDATE users SET created_at = LEAST(created_at, ?) WHERE id = ?', [tpl.created_at + d, userId])
    await db.run("UPDATE users SET password_hash = 'template-used' WHERE id = ?", [t])
    return true
  })
}
