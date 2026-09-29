// Builds dist-demo/assets/pglite-snapshot.wasm: a PGlite data directory with every migration applied, the
// admin, the sample traders with their offers, and a few ready-made account histories (demo/seed.js).
// A first visit loads it instead of creating all that in the page, which takes long on phones.
// (".wasm" only so every static host serves it; it is a gzipped tarball.)
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { botTick, makeTemplates, seed } from './seed.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { createApp } = require('../../server/src/app.js')
const baseConfig = require('../../server/src/config.js')

const kycDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariapay-snapshot-'))
const quiet = { log() {}, info() {}, warn() {}, error: console.error }
// Same settings as the page (demo/server.js) where they matter for the data.
const app = await createApp(
  {
    ...baseConfig,
    databaseUrl: '',
    pgliteDir: ':memory:',
    dataKey: crypto.randomBytes(32).toString('hex'),
    nodeEnv: 'development',
    requireStaff2fa: false,
    adminUsername: '',
    adminPassword: '',
    storage: { provider: 'local' },
    kycDir,
    tron: { ...baseConfig.tron, network: 'off' },
    beta: { inviteOnly: false, maxTradeMicro: 0, maxOfferMicro: 0, label: '' },
  },
  { sms: async () => {}, log: quiet, autoStartChain: false, autoStartPush: false }
)
const db = app.locals.db
const services = app.locals.services
await seed(db)
await botTick(db, services)
await makeTemplates(db, services, 5)
const tar = await db.dumpDataDir('gzip')
await app.locals.close()
fs.rmSync(kycDir, { recursive: true, force: true })
const out = path.join(here, '..', 'dist-demo', 'assets', 'pglite-snapshot.wasm')
fs.writeFileSync(out, Buffer.from(await tar.arrayBuffer()))
console.log(`database snapshot: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
