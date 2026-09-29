// Turns dist-demo/index.html into the page fragment an Artifact publish expects
// (the publisher adds <!doctype>, <html>, <head> and <body> itself).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-demo')
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const head = html.match(/<head>([\s\S]*)<\/head>/)[1]
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
const keep = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n')
  .trim()
// The title must come first (only the start of the file is scanned for it).
const title = keep.match(/<title>[\s\S]*?<\/title>/)[0]
const rest = keep.replace(title, '').trim()
fs.writeFileSync(path.join(dist, 'artifact.html'), `${title}\n${rest}\n${body.trim()}\n`)
// Artifacts do not serve .data files: ship PGlite's file-system image under a served name.
for (const f of fs.readdirSync(path.join(dist, 'assets'))) {
  if (f.endsWith('.data')) fs.renameSync(path.join(dist, 'assets', f), path.join(dist, 'assets', 'pglite-fs.wasm'))
}
const files = fs.readdirSync(path.join(dist, 'assets')).map((f) => `assets/${f}`)
fs.writeFileSync(path.join(dist, 'files.json'), JSON.stringify(Object.fromEntries(files.map((f) => [f, path.join(dist, f)])), null, 1))
console.log(`artifact.html + ${files.length} files`)
