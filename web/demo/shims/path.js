function normalize(p) {
  const abs = p.startsWith('/')
  const out = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return (abs ? '/' : '') + out.join('/')
}
const join = (...parts) => normalize(parts.filter(Boolean).join('/'))
const dirname = (p) => normalize(p).split('/').slice(0, -1).join('/') || '/'
const basename = (p) => normalize(p).split('/').pop()
const relative = (_from, to) => to
module.exports = { join, dirname, basename, relative }
