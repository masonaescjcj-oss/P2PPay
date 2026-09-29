// "Install on phone": Android/desktop Chrome offer a prompt (beforeinstallprompt); iOS Safari needs
// Share → Add to Home Screen. Capture the prompt as early as possible.
import { useEffect, useState } from 'react'

let deferred = null
const listeners = new Set()

export function startInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    listeners.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((f) => f())
  })
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

export function useInstall() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    listeners.add(f)
    return () => listeners.delete(f)
  }, [])
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    ios: isIos(),
    async prompt() {
      if (!deferred) return false
      deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null
      bump((n) => n + 1)
      return outcome === 'accepted'
    },
  }
}
