import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { usePrefs } from '../lib/prefs.jsx'
import Icon from './Icon.jsx'

export function TabBar() {
  const { t } = usePrefs()
  const cur = ({ isActive }) => (isActive ? 'page' : undefined)
  return (
    <nav className="tabbar" aria-label="main">
      <NavLink to="/" end aria-current={cur}>
        <Icon name="home" size={24} />
        {t('home')}
      </NavLink>
      <NavLink to="/orders" aria-current={cur}>
        <Icon name="receipt" size={24} />
        {t('orders')}
      </NavLink>
      <NavLink to="/market" className="fab" aria-current={cur}>
        <span className="fab-circle">
          <Icon name="swap" size={24} stroke={2.2} />
        </span>
        {t('market')}
      </NavLink>
      <NavLink to="/wallet" aria-current={cur}>
        <Icon name="wallet" size={24} />
        {t('wallet')}
      </NavLink>
      <NavLink to="/profile" aria-current={cur}>
        <Icon name="user" size={24} />
        {t('profile')}
      </NavLink>
    </nav>
  )
}

export function TopBar({ title, sub, back = -1, children }) {
  const { t } = usePrefs()
  const navigate = useNavigate()
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => (typeof back === 'string' ? navigate(back) : navigate(back))}>
        <Icon name="back" />
      </button>
      <div className="grow stack" style={{ gap: 1 }}>
        <h1 className="title">{title}</h1>
        {sub && <span className="caption">{sub}</span>}
      </div>
      {children}
    </header>
  )
}

// A thin bar while the device is offline; the app keeps its screens and retries when back online.
export function OfflineBar() {
  const { t } = usePrefs()
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (online) return null
  return (
    <div className="offline-bar" role="status">
      <Icon name="globe" size={16} />
      {t('offlineNote')}
    </div>
  )
}

export function Toast({ msg }) {
  if (!msg) return null
  return (
    <div className="toast" role="status">
      {msg}
    </div>
  )
}

export function Empty({ children, action }) {
  return (
    <div className="empty">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="16" y="16" width="32" height="32" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
        <rect x="16" y="16" width="32" height="32" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" transform="rotate(45 32 32)" />
      </svg>
      <div>{children}</div>
      {action}
    </div>
  )
}

export function Loading() {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  )
}
