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
  if (!user.perms?.length) return <Navigate to="/" replace />
  return children
}

function Badge({ n }) {
  return n ? <span className="badge num">{n}</span> : null
}

export default function AdminLayout() {
  const { t } = usePrefs()
  const ov = useApi('/admin/overview', { interval: 15000 })
  const o = ov.data
  const perms = o?.perms || []
  const can = (p) => perms.includes(p)
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
      {ov.error?.code === 'staff_2fa_required' ? (
        <div className="note gold">
          <Icon name="shieldCheck" size={20} />
          <span>{t('staffNeeds2fa')} <Link to="/profile/security">{t('securityTitle')}</Link></span>
        </div>
      ) : (
        <>
          <nav className="admin-nav" aria-label={t('admin')}>
            <NavLink to="/admin" end aria-current={cur}>{t('overview')}</NavLink>
            {can('funds') && <NavLink to="/admin/deposits" aria-current={cur}>{t('deposits')}<Badge n={o?.pendingDeposits} /></NavLink>}
            {can('funds') && <NavLink to="/admin/withdrawals" aria-current={cur}>{t('withdrawals')}<Badge n={o?.pendingWithdrawals} /></NavLink>}
            {can('disputes') && <NavLink to="/admin/disputes" aria-current={cur}>{t('disputes')}<Badge n={o?.disputes} /></NavLink>}
            {can('kyc') && <NavLink to="/admin/kyc" aria-current={cur}>{t('kyc')}<Badge n={o?.pendingKyc} /></NavLink>}
            {can('alerts') && <NavLink to="/admin/alerts" aria-current={cur}>{t('alerts')}<Badge n={o?.openAlerts} /></NavLink>}
            {can('users') && <NavLink to="/admin/users" aria-current={cur}>{t('users')}</NavLink>}
            {can('beta') && <NavLink to="/admin/beta" aria-current={cur}>{t('beta')}<Badge n={(o?.newFeedback || 0) + (o?.openErrors || 0)} /></NavLink>}
            {can('audit') && <NavLink to="/admin/log" aria-current={cur}>{t('auditLog')}</NavLink>}
          </nav>
          <Outlet context={{ overview: ov, perms }} />
        </>
      )}
    </main>
  )
}
