// The P2PPay server, running in this browser tab: the real server modules (server/src) on PGlite
// (Postgres compiled to WebAssembly, stored in IndexedDB). Requests from the web app reach it
// through a fetch bridge instead of the network. For testing only: no real money, no real SMS.
import appModule from '../../server/src/app.js'
import baseConfig from '../../server/src/config.js'
import authModule from '../../server/src/auth.js'

const { createApp } = appModule
const { hashPassword } = authModule

export const ADMIN = { username: 'admin', password: 'admin-test-1405' }
const KEY_STORE = 'p2ppay.demo.key'
const COOKIE_STORE = 'p2ppay.demo.cookie'
const DB_NAME = 'p2ppay-demo'

const safe = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      // storage blocked: keep going in memory
    }
  },
}

// One request or background task at a time (see shims/async_hooks.js).
let tail = Promise.resolve()
const serial = (fn) => {
  const run = tail.then(fn, fn)
  tail = run.then(() => {}, () => {})
  return run
}

// ---------- test SMS inbox ----------
export const inbox = []
const sms = async (to, text) => {
  const msg = { to, text, code: text.match(/Your code: (\d{6})/)?.[1] || null, at: Date.now() }
  inbox.unshift(msg)
  inbox.length = Math.min(inbox.length, 20)
  window.dispatchEvent(new CustomEvent('demo-sms', { detail: msg }))
}

// ---------- KYC files: IndexedDB, falling back to memory ----------
function blobStore() {
  const mem = new Map()
  let dbp = null
  const open = () =>
    (dbp ??= new Promise((resolve) => {
      try {
        const r = indexedDB.open('p2ppay-demo-files', 1)
        r.onupgradeneeded = () => r.result.createObjectStore('files')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    }))
  const tx = async (mode, fn) => {
    const idb = await open()
    if (!idb) return null
    return new Promise((resolve) => {
      const t = idb.transaction('files', mode)
      const req = fn(t.objectStore('files'))
      t.oncomplete = () => resolve(req?.result ?? true)
      t.onerror = () => resolve(null)
    })
  }
  return {
    kind: 'browser',
    async put(name, buf) {
      mem.set(name, buf)
      await tx('readwrite', (s) => s.put(new Uint8Array(buf), name))
    },
    async get(name) {
      if (mem.has(name)) return mem.get(name)
      const v = await tx('readonly', (s) => s.get(name))
      if (!v || v === true) throw new Error('file not found')
      return Buffer.from(v)
    },
    async remove(name) {
      mem.delete(name)
      await tx('readwrite', (s) => s.delete(name))
    },
  }
}

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

async function seed(db) {
  const now = Date.now()
  for (const b of BOTS) {
    let u = await db.one('SELECT id FROM users WHERE username = ?', [b.username])
    if (!u) {
      const pw = crypto.getRandomValues(new Uint8Array(18)).join('')
      u = await db.one(
        `INSERT INTO users (username, display_name, password_hash, phone, phone_verified_at, kyc_tier, created_at)
         VALUES (?, ?, ?, ?, ?, 2, ?) RETURNING id`,
        [b.username, b.name, hashPassword(pw), b.phone, now, now - 30 * 86_400_000]
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
async function botTick(db, s) {
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
    `SELECT id, buyer_id, seller_id, status FROM trades
     WHERE status IN ('pending_payment','paid') AND (buyer_id IN (${list}) OR seller_id IN (${list}))`
  )
  const t0 = Date.now()
  for (const t of trades) {
    const key = `${t.id}:${t.status}`
    if (!seen.has(key)) {
      seen.set(key, t0)
      if (t.status === 'pending_payment') {
        const bot = ids.includes(t.seller_id) ? t.seller_id : t.buyer_id
        await market.postMessage(bot, t.id, ids.includes(t.seller_id)
          ? 'سلام! من حساب نمونه‌ام. پول را به حسابی که در معامله نشان داده شده بفرستید (در آزمایش لازم نیست واقعاً بفرستید) و «پرداخت کردم» را بزنید.'
          : 'سلام! من حساب نمونه‌ام. چند ثانیه دیگر «پرداخت کردم» را می‌زنم؛ بعد شما تتر را آزاد کنید.').catch(() => {})
      }
      continue
    }
    if (t0 - seen.get(key) < 5000) continue
    if (t.status === 'pending_payment' && ids.includes(t.buyer_id)) {
      await market.postMessage(t.buyer_id, t.id, 'پرداخت کردم ✓ (آزمایشی)').catch(() => {})
      await market.action(t.buyer_id, t.id, 'pay', {}).catch(() => {})
    } else if (t.status === 'paid' && ids.includes(t.seller_id)) {
      await market.postMessage(t.seller_id, t.id, 'پول رسید، آزاد کردم ✓ (آزمایشی)').catch(() => {})
      await market.action(t.seller_id, t.id, 'release', {}).catch(() => {})
    }
  }
}

// ---------- the server ----------
let app = null
let services = null
let cookie = safe.get(COOKIE_STORE) || ''

function dataKey() {
  let k = safe.get(KEY_STORE)
  if (!/^[0-9a-f]{64}$/.test(k || '')) {
    k = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    safe.set(KEY_STORE, k)
  }
  return k
}

async function canUseIndexedDb() {
  try {
    const r = indexedDB.open('p2ppay-demo-probe')
    return await new Promise((res) => {
      r.onsuccess = () => {
        r.result.close()
        res(true)
      }
      r.onerror = () => res(false)
    })
  } catch {
    return false
  }
}

// PGlite's file-system image, published as assets/pglite-fs.wasm (a byte file under a served name).
async function fsBundle() {
  const res = await fetch(new URL('assets/pglite-fs.wasm', document.baseURI))
  if (!res.ok) throw new Error(`database files: HTTP ${res.status}`)
  return new Blob([await res.arrayBuffer()])
}

export async function startDemoServer({ onStatus } = {}) {
  const persistent = await canUseIndexedDb()
  const config = {
    ...baseConfig,
    databaseUrl: '',
    pgliteDir: persistent ? `idb://${DB_NAME}` : ':memory:',
    pgliteOptions: { fsBundle: await fsBundle() },
    dataKey: dataKey(),
    nodeEnv: 'development',
    requireStaff2fa: false,
    adminUsername: ADMIN.username,
    adminPassword: ADMIN.password,
    otpResendMs: 5000,
    cookieSecure: false,
    storage: { provider: 'local' },
    tron: { ...baseConfig.tron, network: 'off' },
    beta: { inviteOnly: false, maxTradeMicro: 100_000_000, maxOfferMicro: 500_000_000, label: '' },
  }
  const quiet = { log() {}, info() {}, warn: (...a) => console.debug(...a), error: (...a) => console.error(...a) }
  onStatus?.('db')
  // Background timers inside the app (trade expiry) also take the one-at-a-time lane.
  const realSetInterval = globalThis.setInterval
  globalThis.setInterval = (fn, ms, ...a) => realSetInterval(() => serial(() => fn(...a)), ms)
  try {
    app = await createApp(config, { sms, storage: blobStore(), log: quiet, autoStartChain: false })
  } finally {
    globalThis.setInterval = realSetInterval
  }
  services = app.locals.services
  const db = app.locals.db
  onStatus?.('seed')
  await serial(() => seed(db))
  await serial(() => botTick(db, services))
  setInterval(() => serial(() => botTick(db, services)).catch((e) => console.error('[demo] sample traders', e)), 2500)
  return { persistent }
}

// Handles a fetch() to /api/… inside the page.
export async function handle(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase()
  const headers = { ...(init.headers || {}) }
  if (cookie) headers.cookie = cookie
  let body
  if (init.body instanceof Blob) body = Buffer.from(await init.body.arrayBuffer())
  else if (typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body)
    } catch {
      body = init.body
    }
  } else body = init.body ?? {}
  const out = await serial(() => app.dispatch({ method, url, headers, body: body ?? {} }))
  const set = out.headers['set-cookie']
  if (set) {
    const pair = set.split(';')[0]
    cookie = /Max-Age=0/.test(set) || pair.endsWith('=') ? '' : pair
    safe.set(COOKIE_STORE, cookie || null)
  }
  const resHeaders = new Headers()
  for (const [k, v] of Object.entries(out.headers)) if (k !== 'set-cookie') resHeaders.set(k, String(v))
  const noBody = out.status === 204 || out.body === null
  const payload = noBody ? null : typeof out.body === 'string' ? out.body : new Uint8Array(out.body)
  return new Response(payload, { status: out.status, headers: resHeaders })
}

// ---------- test helpers for the demo panel ----------
export async function topUp(amount = '500') {
  return serial(async () => {
    const me = await app.dispatch({ method: 'GET', url: '/api/me', headers: { cookie }, body: {} })
    if (me.status !== 200) throw new Error('login_required')
    const user = JSON.parse(me.body)
    const txid = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const d = await services.funds.requestDeposit(user.id, { amount, txid })
    await services.funds.reviewDeposit(d.id, true, { note: 'شارژ آزمایشی' }, null)
  })
}

export async function resetAll() {
  safe.set(COOKIE_STORE, null)
  safe.set(KEY_STORE, null)
  for (const name of [`/pglite/${DB_NAME}`, DB_NAME, 'p2ppay-demo-files']) {
    await new Promise((res) => {
      try {
        const r = indexedDB.deleteDatabase(name)
        r.onsuccess = r.onerror = r.onblocked = () => res()
      } catch {
        res()
      }
    })
  }
}
