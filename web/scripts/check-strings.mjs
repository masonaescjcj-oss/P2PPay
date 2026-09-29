// Copy check for the beta: every UI string exists in Dari and English, every literal t('key')
// used in the app is defined, and every error code the server can return has a message.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strings, paymentMethodLabels } from '../src/lib/strings.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const webSrc = path.join(here, '..', 'src')
const serverSrc = path.join(here, '..', '..', 'server', 'src')
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(jsx?|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : [])

const problems = []
const langs = Object.keys(strings)
const all = new Set(langs.flatMap((l) => Object.keys(strings[l])))
for (const l of langs) {
  for (const k of all) if (!(k in strings[l])) problems.push(`missing ${l}.${k}`)
  for (const [k, v] of Object.entries(strings[l])) if (typeof v !== 'string' || !v.trim()) problems.push(`empty ${l}.${k}`)
}
// Placeholders like {n} must match between languages.
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
for (const k of all) {
  const v = langs.map((l) => vars(strings[l][k] ?? ''))
  if (new Set(v).size > 1) problems.push(`placeholders differ for ${k}: ${langs.map((l, i) => `${l}={${v[i]}}`).join(' ')}`)
}
for (const l of Object.keys(paymentMethodLabels)) {
  for (const k of Object.keys(paymentMethodLabels.en)) if (!paymentMethodLabels[l][k]) problems.push(`missing payment method ${l}.${k}`)
}

// Literal keys used in the web app.
for (const f of walk(webSrc)) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) {
    if (!all.has(m[1])) problems.push(`undefined key '${m[1]}' used in ${path.relative(webSrc, f)}`)
  }
}

// Error codes the server can send.
const codes = new Set()
for (const f of walk(serverSrc)) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\b(?:bad|forbidden|conflict|notFound)\(\s*'([a-z0-9_]+)'/g)) codes.add(m[1])
  for (const m of src.matchAll(/ApiError\(\s*\d+\s*,\s*'([a-z0-9_]+)'/g)) codes.add(m[1])
  for (const m of src.matchAll(/json\(\{\s*error:\s*'([a-z0-9_]+)'/g)) codes.add(m[1])
}
for (const c of [...codes].sort()) {
  for (const l of langs) if (!strings[l][`err_${c}`]) problems.push(`no ${l} message for server error '${c}' (err_${c})`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s)`)
  process.exit(1)
}
console.log(`strings ok: ${all.size} keys × ${langs.length} languages, ${codes.size} server error codes covered`)
