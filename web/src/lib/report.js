// Sends browser crashes to the server (grouped there by fingerprint). Best effort, a few per page load.
const sent = new Set()
let budget = 10

export function reportError(error, extra = {}) {
  try {
    const message = String(error?.message || error || 'unknown').slice(0, 500)
    const stack = String(error?.stack || extra.componentStack || '').slice(0, 4000)
    const key = message + stack.slice(0, 200)
    if (sent.has(key) || budget <= 0) return
    sent.add(key)
    budget--
    fetch('/api/client-errors', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, stack, page: location.pathname }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // never let reporting break the app
  }
}

export function installErrorReporter() {
  window.addEventListener('error', (e) => {
    // Resource load errors (img/script) have no error object; skip those.
    if (e.error) reportError(e.error)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    if (r?.name === 'ApiError' || r?.constructor?.name === 'ApiError' || typeof r?.status === 'number') return // API errors are expected
    reportError(r instanceof Error ? r : new Error(String(r)))
  })
}
