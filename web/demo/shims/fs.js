// Only what the server reads from disk in the demo: the SQL migrations.
const { byName } = require('./migrations.js')
const base = (p) => String(p).split('/').pop()

const readdirSync = (dir) => (String(dir).endsWith('migrations') ? Object.keys(byName) : [])
function readFileSync(p) {
  const name = base(p)
  if (name in byName) return byName[name]
  const err = new Error(`ENOENT: ${p}`)
  err.code = 'ENOENT'
  throw err
}
const existsSync = (p) => base(p) in byName
const noop = () => {}
module.exports = { readdirSync, readFileSync, existsSync, mkdirSync: noop, writeFileSync: noop, rmSync: noop }
