import { Link, useOutletContext } from 'react-router-dom'
import { Loading } from '../../components/Layout.jsx'
import { usdt } from '../../lib/format.js'
import { usePrefs } from '../../lib/prefs.jsx'

function Tile({ to, label, value, alert }) {
  return (
    <Link to={to} className={`tile ${alert ? 'alert' : ''}`}>
      <span className="caption">{label}</span>
      <span className="v num">{value}</span>
    </Link>
  )
}

export default function AdminOverview() {
  const { t } = usePrefs()
  const { overview } = useOutletContext()
  const o = overview.data
  if (!o) return <Loading />
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="tiles">
        <Tile to="/admin/deposits" label={t('pendingDeposits')} value={o.pendingDeposits} alert={o.pendingDeposits > 0} />
        <Tile to="/admin/withdrawals" label={t('pendingWithdrawals')} value={o.pendingWithdrawals} alert={o.pendingWithdrawals > 0} />
        <Tile to="/admin/disputes" label={t('openDisputes')} value={o.disputes} alert={o.disputes > 0} />
        <Tile to="/admin/disputes" label={t('openTrades')} value={o.openTrades} />
        <Tile to="/admin/users" label={t('userCount')} value={o.users} />
      </div>
      <div className="grid-2">
        <div className="balance-card" style={{ gap: 6 }}>
          <span className="sub">{t('userBalances')}</span>
          <span dir="ltr" className="num" style={{ fontSize: 30, fontWeight: 800, textAlign: 'end' }}>{usdt(o.userBalances)} <span style={{ fontSize: 14, color: '#E9B44C' }}>USDT</span></span>
        </div>
        <div className="card stack" style={{ gap: 6, justifyContent: 'center' }}>
          <span className="caption">{t('feesEarned')}</span>
          <span className="num t-green" style={{ fontSize: 30, fontWeight: 800 }}>{usdt(o.fees)} <span style={{ fontSize: 14 }}>USDT</span></span>
        </div>
      </div>
    </div>
  )
}
