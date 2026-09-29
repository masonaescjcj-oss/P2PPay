// The AriaPay server, running in this browser tab: the real server modules (server/src) on PGlite
// (Postgres compiled to WebAssembly, stored in IndexedDB). Requests from the web app reach it
// through a fetch bridge instead of the network. For testing only: no real money, no real SMS.
import appModule from '../../server/src/app.js'
import baseConfig from '../../server/src/config.js'
import { BRAND } from '../src/lib/brand.js'
import { ADMIN, botTick, claimHistory, seed } from './seed.js'

export { ADMIN }

const { createApp } = appModule

const KEY_STORE = 'ariapay.demo.key'
const COOKIE_STORE = 'ariapay.demo.cookie'
// A new name whenever the snapshot's contents change, so browsers start from the new one.
const DB_NAME = 'ariapay-demo-2'
const OLD_DBS = ['/pglite/ariapay-demo', 'ariapay-demo']

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
        const r = indexedDB.open('ariapay-demo-files', 1)
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

// A prepared history from the snapshot (building one in the page would take long on a phone; once the
// prepared ones are used up in this browser, a new account simply starts empty).
const giveHistory = (userId) => claimHistory(app.locals.db, userId)

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
    const r = indexedDB.open('ariapay-demo-probe')
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
async function asset(name) {
  const res = await fetch(new URL(`assets/${name}`, document.baseURI))
  if (!res.ok) throw new Error(`database files: HTTP ${res.status}`)
  return new Blob([await res.arrayBuffer()])
}
const fsBundle = () => asset('pglite-fs.wasm')

// true / false when the browser can list its databases, null when it can't tell.
async function savedDbExists() {
  try {
    if (indexedDB.databases) return (await indexedDB.databases()).some((d) => d.name === `/pglite/${DB_NAME}`)
  } catch {
    // listing not allowed
  }
  return null
}

export async function startDemoServer() {
  const persistent = await canUseIndexedDb()
  if (persistent) for (const name of OLD_DBS) { try { indexedDB.deleteDatabase(name) } catch { /* ignore */ } }
  // A new database starts from a snapshot with every migration applied (built by make-snapshot.mjs).
  const fresh = !persistent || (await savedDbExists()) !== true
  const [bundle, snapshot] = await Promise.all([fsBundle(), fresh ? asset('pglite-snapshot.wasm') : null])
  const config = {
    ...baseConfig,
    databaseUrl: '',
    pgliteDir: persistent ? `idb://${DB_NAME}` : ':memory:',
    // relaxedDurability: write to IndexedDB after answering, not before (much faster on phones).
    pgliteOptions: { fsBundle: bundle, ...(snapshot && { loadDataDir: snapshot }) },
    dataKey: dataKey(),
    nodeEnv: 'development',
    requireStaff2fa: false,
    // The admin account is created by seed() with a ready-made hash.
    adminUsername: '',
    adminPassword: '',
    otpResendMs: 5000,
    cookieSecure: false,
    storage: { provider: 'local' },
    tron: { ...baseConfig.tron, network: 'off' },
    appName: BRAND,
    // No beta banner or beta caps in the test version (the new-account limit still applies).
    beta: { inviteOnly: false, maxTradeMicro: 0, maxOfferMicro: 0, label: '' },
  }
  const quiet = { log() {}, info() {}, warn: (...a) => console.debug(...a), error: (...a) => console.error(...a) }
  // Background timers inside the app (trade expiry) also take the one-at-a-time lane.
  const realSetInterval = globalThis.setInterval
  globalThis.setInterval = (fn, ms, ...a) => realSetInterval(() => serial(() => fn(...a)), ms)
  try {
    try {
      app = await createApp(config, { sms, storage: blobStore(), log: quiet, autoStartChain: false })
    } catch (err) {
      // The browser couldn't tell us a saved database existed: open that one instead.
      if (!snapshot || !/already exists/.test(err?.message)) throw err
      app = await createApp({ ...config, pgliteOptions: { fsBundle: bundle } }, { sms, storage: blobStore(), log: quiet, autoStartChain: false })
    }
  } finally {
    globalThis.setInterval = realSetInterval
  }
  services = app.locals.services
  const db = app.locals.db
  await serial(() => seed(db))
  // First round runs in the background; the app's own requests queue behind it.
  serial(() => botTick(db, services)).catch((e) => console.error('[demo] sample traders', e))
  // Someone who signed up before test accounts came with a history gets one now.
  if (cookie) {
    serial(async () => {
      const me = await app.dispatch({ method: 'GET', url: '/api/me', headers: { cookie }, body: {} })
      if (me.status === 200) await giveHistory(JSON.parse(me.body).id)
    }).catch((e) => console.error('[demo] sample history', e))
  }
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
  if (method === 'POST' && url.startsWith('/api/auth/register') && out.status === 201) {
    const { id } = JSON.parse(out.body)
    await serial(() => giveHistory(id)).catch((e) => console.error('[demo] sample history', e))
  }
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
  for (const name of [`/pglite/${DB_NAME}`, DB_NAME, 'ariapay-demo-files']) {
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
