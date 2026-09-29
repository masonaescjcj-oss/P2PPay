// Amounts arrive from the API as decimal strings ("1248.5"). Format with grouping, no float math.
export function fmt(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const s = String(value)
  const neg = s.startsWith('-')
  const [whole, frac = ''] = s.replace('-', '').split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const f = frac.slice(0, decimals).padEnd(decimals, '0')
  return (neg ? '−' : '') + grouped + (decimals ? '.' + f : '')
}

export const usdt = (v) => fmt(v, 2)
export const afn = (v) => fmt(v, 0)
export const rate = (v) => fmt(v, 2)

// Compare decimal strings via numbers is fine for display-only logic (sorting, "best price").
export const toNum = (v) => Number(v || 0)

export function initial(name = '') {
  return (name.trim()[0] || '?').toUpperCase()
}

export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function timeOf(ts, lang) {
  return new Date(ts).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function dayKey(ts) {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'today'
  if (d.toDateString() === y.toDateString()) return 'yesterday'
  return d.toISOString().slice(0, 10)
}

// Dates as people in Afghanistan read them: Solar Hijri months (حمل، ثور …) in Dari, Latin digits.
export function dateOf(ts, lang, opts = { year: 'numeric', month: 'long', day: 'numeric' }) {
  try {
    return new Date(ts).toLocaleDateString(lang === 'fa' ? 'fa-AF-u-nu-latn' : 'en-GB', opts)
  } catch {
    return new Date(ts).toISOString().slice(0, 10)
  }
}
