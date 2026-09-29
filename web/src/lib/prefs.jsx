import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { paymentMethodLabels, strings } from './strings.js'

const PrefsContext = createContext(null)

function load(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private mode) — keep the in-memory value
  }
}

export function PrefsProvider({ children }) {
  const [lang, setLangState] = useState(() => load('ariapay.lang', 'fa', ['fa', 'en']))
  const [theme, setThemeState] = useState(() => load('ariapay.theme', 'dark', ['dark', 'light']))

  useEffect(() => {
    const el = document.documentElement
    el.lang = lang
    el.dir = lang === 'en' ? 'ltr' : 'rtl'
  }, [lang])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0A0A0D' : '#F3F3F6')
  }, [theme])

  const setLang = useCallback((v) => {
    setLangState(v)
    save('ariapay.lang', v)
  }, [])
  const setTheme = useCallback((v) => {
    setThemeState(v)
    save('ariapay.theme', v)
  }, [])

  const t = useCallback(
    (key, vars) => {
      let s = strings[lang][key] ?? strings.en[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v)
      return s
    },
    [lang]
  )
  const pm = useCallback((code) => paymentMethodLabels[lang][code] ?? code, [lang])
  const errText = useCallback((err) => t(`err_${err?.code || 'server_error'}`, err?.data || undefined), [t])

  const value = useMemo(() => ({ lang, setLang, theme, setTheme, t, pm, errText }), [lang, setLang, theme, setTheme, t, pm, errText])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs() {
  return useContext(PrefsContext)
}
