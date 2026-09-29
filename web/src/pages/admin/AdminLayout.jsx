import { Link, Navigate, NavLink, Outlet } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { StarMark } from '../../components/Brand.jsx'
import { useAuth } from '../../lib/auth.jsx'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

export function RequireAdmin({ children }) {
  const { user } = useAuth()
  if (user === undefined) return <div className="page"><div className="skeleton" /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: '/admin' }} />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

function Badge({ n }) {
  return n ? <span className="badge num">{n}</span> : null
}

export default function AdminLayout() {
  const { t } = usePrefs()
  const ov = useApi('/admin/overview', { interval: 15000 })
  const o = ov.data
  const cur = ({ isActive }) => (isActive ? 'page' : undefined)
  return (
    <main className="page" style={{ gap: 16 }}>
      <header className="between">
        <div className="row">
          <StarMark size={30} />
          <h1 className="h1">{t('admin')}</h1>
        </div>
        <Link to="/" className="btn btn-secondary btn-sm" style={{ height: 40 }}>
          <Icon name="back" size={16} />
          {t('backToApp')}
        </Link>
      </header>
      <nav className="admin-nav" aria-label={t('admin')}>
        <NavLink to="/admin" end aria-current={cur}>{t('overview')}</NavLink>
        <NavLink to="/admin/deposits" aria-current={cur}>{t('deposits')}<Badge n={o?.pendingDeposits} /></NavLink>
        <NavLink to="/admin/withdrawals" aria-current={cur}>{t('withdrawals')}<Badge n={o?.pendingWithdrawals} /></NavLink>
        <NavLink to="/admin/disputes" aria-current={cur}>{t('disputes')}<Badge n={o?.disputes} /></NavLink>
        <NavLink to="/admin/users" aria-current={cur}>{t('users')}</NavLink>
        <NavLink to="/admin/log" aria-current={cur}>{t('auditLog')}</NavLink>
      </nav>
      <Outlet context={{ overview: ov }} />
    </main>
  )
}
