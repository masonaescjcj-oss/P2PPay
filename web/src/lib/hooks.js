import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

// Fetch a GET endpoint, optionally re-polling every `interval` ms while the tab is visible.
export function useApi(path, { interval = 0, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(!!enabled)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    if (!enabled || !path) return
    try {
      const d = await api.get(path)
      if (alive.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [path, enabled])

  useEffect(() => {
    alive.current = true
    reload()
    let id
    if (interval) {
      id = setInterval(() => {
        if (document.visibilityState === 'visible') reload()
      }, interval)
    }
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [reload, interval])

  return { data, error, loading, reload, setData }
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval])
  return now
}

export function useToast() {
  const [msg, setMsg] = useState(null)
  const timer = useRef()
  const show = useCallback((m) => {
    setMsg(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 2600)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [msg, show]
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
