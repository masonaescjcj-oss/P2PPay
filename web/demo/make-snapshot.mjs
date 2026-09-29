// Builds dist-demo/assets/pglite-snapshot.wasm: a PGlite data directory with every migration applied.
// A first visit loads it instead of creating and migrating an empty database, which takes long on phones.
// (".wasm" only so every static host serves it; it is a gzipped tarball.)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { openDb } = require('../../server/src/db.js')

const quiet = { log() {}, info() {}, warn() {}, error: console.error }
const db = await openDb({ databaseUrl: '', pgliteDir: ':memory:' }, { log: quiet })
const tar = await db.dumpDataDir('gzip')
await db.close()
const out = path.join(here, '..', 'dist-demo', 'assets', 'pglite-snapshot.wasm')
fs.writeFileSync(out, Buffer.from(await tar.arrayBuffer()))
console.log(`database snapshot: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
