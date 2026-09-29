import './shims/globals.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/latin-800.css'
import '@fontsource/vazirmatn/arabic-400.css'
import '@fontsource/vazirmatn/arabic-500.css'
import '@fontsource/vazirmatn/arabic-600.css'
import '@fontsource/vazirmatn/arabic-700.css'
import '@fontsource/vazirmatn/arabic-800.css'
import '../src/styles/theme.css'
import '../src/styles/app.css'
import './demo.css'
import App from '../src/App.jsx'
import { AuthProvider } from '../src/lib/auth.jsx'
import { PrefsProvider } from '../src/lib/prefs.jsx'
import { installErrorReporter } from '../src/lib/report.js'
import DemoPanel from './DemoPanel.jsx'
import { handle, startDemoServer } from './server.js'

const boot = document.getElementById('boot')
const setBoot = (text) => {
  const el = document.getElementById('boot-text')
  if (el) el.textContent = text
}

// First visit: follow the viewer's light/dark theme (the app remembers the choice afterwards).
try {
  if (!localStorage.getItem('p2ppay.theme')) {
    const host = document.documentElement.dataset.theme
    const light = host ? host === 'light' : matchMedia('(prefers-color-scheme: light)').matches
    localStorage.setItem('p2ppay.theme', light ? 'light' : 'dark')
  }
} catch {
  // storage blocked
}

// /api/… calls from the app go to the server in this tab.
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url
  if (typeof url === 'string' && url.startsWith('/api/')) return handle(url, init)
  return realFetch(input, init)
}

// The database is WebAssembly; some locked-down pages refuse to compile it. Check that first.
async function wasmAllowed() {
  try {
    await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!(await wasmAllowed())) {
    boot?.classList.add('failed')
    setBoot('این صفحه اجازهٔ اجرای WebAssembly را نمی‌دهد، و پایگاه‌دادهٔ نسخهٔ آزمایشی به آن نیاز دارد. · This page does not allow WebAssembly, which the test database needs.')
    return
  }
  try {
    await startDemoServer({ onStatus: (s) => setBoot(s === 'db' ? 'در حال آماده‌سازی پایگاه‌داده… · Preparing the database…' : 'در حال ساخت معامله‌گران نمونه… · Adding sample traders…') })
  } catch (err) {
    console.error(err)
    boot?.classList.add('failed')
    setBoot(`این مرورگر نتوانست نسخهٔ آزمایشی را اجرا کند (${err?.message || err}). · This browser could not start the test version.`)
    return
  }
  installErrorReporter()
  boot?.remove()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <PrefsProvider>
        <AuthProvider>
          <MemoryRouter>
            <App />
            <DemoPanel />
          </MemoryRouter>
        </AuthProvider>
      </PrefsProvider>
    </StrictMode>
  )
}

main()
