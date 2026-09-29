// Phone notifications (Web Push). Works in browsers with service workers and PushManager; on iPhone only
// after the app is installed to the home screen. The server key comes from /api/push/key.
import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function usePush(lang) {
  const [state, setState] = useState('unknown') // unsupported | unavailable | off | on | denied
  const refresh = useCallback(async () => {
    if (!supported()) return setState('unsupported')
    try {
      const { publicKey } = await api.get('/push/key')
      if (!publicKey) return setState('unavailable')
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    } catch {
      setState('unavailable')
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function enable() {
    const { publicKey } = await api.get('/push/key')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return refresh()
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }))
    await api.post('/push/subscribe', { ...sub.toJSON(), lang })
    return refresh()
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
      await sub.unsubscribe()
    }
    return refresh()
  }

  return { state, enable, disable }
}
