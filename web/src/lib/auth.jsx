import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading, null = logged out
  const [config, setConfig] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setUser(await api.get('/me'))
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    refresh()
    api.get('/config').then(setConfig, () => {})
  }, [refresh])

  // Returns { challenge } when the account has 2FA; finish with loginSecondFactor.
  const login = useCallback(async (username, password) => {
    const r = await api.post('/auth/login', { username, password })
    if (r.twoFactor) return { challenge: r.challenge }
    await refresh()
    return {}
  }, [refresh])

  const loginSecondFactor = useCallback(async (challenge, code) => {
    await api.post('/auth/login/2fa', { challenge, code })
    await refresh()
  }, [refresh])

  const register = useCallback(async (body) => {
    await api.post('/auth/register', body)
    await refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(() => ({ user, config, refresh, login, loginSecondFactor, register, logout }), [user, config, refresh, login, loginSecondFactor, register, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export function RequireAuth({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) return <div className="page"><div className="skeleton" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}
