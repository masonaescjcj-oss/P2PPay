// P2PPay service worker: makes the app installable and opens the app shell when the network is slow
// or gone. It never touches /api — balances, trades and codes always come from the server.
const CACHE = 'p2ppay-shell-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png']

const OFFLINE = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>P2PPay</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#080C1C;color:#F5EFE2;font:16px/1.9 Vazirmatn,Tahoma,sans-serif;text-align:center;padding:24px">
<div><p style="font-size:20px;font-weight:700">اتصال اینترنت برقرار نیست</p><p>وقتی دوباره آنلاین شدید، صفحه را تازه کنید. معاملات شما روی سرور محفوظ است.</p>
<p style="color:#9AA3C2" dir="ltr">You are offline. Reload when you are back online.</p></div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return

  // Pages: network first (always the newest app), cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(async () => (await caches.match('/')) || new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    )
    return
  }

  // Built files have content hashes in their names, so a cached copy is always right.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
      )
    )
  }
})
