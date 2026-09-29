import { Link, useOutletContext } from 'react-router-dom'
import { Loading } from '../../components/Layout.jsx'
import Icon from '../../components/Icon.jsx'
import { usdt } from '../../lib/format.js'
import { copyText, useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

function Tile({ to, label, value, alert }) {
  return (
    <Link to={to} className={`tile ${alert ? 'alert' : ''}`}>
      <span className="caption">{label}</span>
      <span className="v num">{value}</span>
    </Link>
  )
}

function ChainCard() {
  const { t } = usePrefs()
  const st = useApi('/admin/chain', { interval: 20000 })
  const c = st.data
  if (!c || c.network === 'off') return null
  const sun = (v) => (v == null ? '—' : (Number(BigInt(v)) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 }))
  const age = c.lastTickAt ? Math.round((Date.now() - c.lastTickAt) / 1000) : null
  return (
    <section className="card stack" style={{ gap: 12, borderColor: c.lastError || c.hotError ? 'var(--coral-tint-line)' : undefined }}>
      <div className="between">
        <h2 className="h2">{t('chainStatus')}</h2>
        <span className="pill blue" dir="ltr">{c.network}</span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <span className="caption">{t('hotAddress')}</span>
        <div className="row" style={{ gap: 6 }}>
          <a className="mono grow" href={`${c.explorer}/#/address/${c.hotAddress}`} target="_blank" rel="noreferrer noopener">{c.hotAddress}</a>
          <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label={t('copy')} onClick={() => copyText(c.hotAddress)}><Icon name="copy" size={16} /></button>
        </div>
        {c.coldAddress && <span className="caption">{t('coldAddress')}: <span className="mono">{c.coldAddress}</span></span>}
      </div>
      <div className="tiles">
        <div className="stat"><span>{t('hotUsdt')}</span><span className="num">{sun(c.hotUsdt)}</span></div>
        <div className="stat"><span>{t('hotTrx')}</span><span className="num">{sun(c.hotTrx)}</span></div>
        <div className="stat"><span>{t('autoToday')}</span><span className="num">{sun(c.autoUsedToday)} / {sun(c.dailyAutoMax)}</span></div>
        <div className="stat"><span>{t('autoLimit')}</span><span className="num">{sun(c.autoWithdrawMax)}</span></div>
        <div className="stat"><span>{t('awaitingSweep')}</span><span className="num">{c.awaitingSweep} / {c.depositAddresses}</span></div>
        <div className="stat"><span>{t('inFlight')}</span><span className="num">{c.sending} / {c.failed}</span></div>
      </div>
      <span className="caption">{t('lastCheck')}: {age === null ? '—' : <span className="num">{age}s</span>}</span>
      {(c.lastError || c.hotError) && <p className="error-text" style={{ overflowWrap: 'anywhere' }}>{t('chainError')}: {c.hotError || c.lastError}</p>}
    </section>
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
      <ChainCard />
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
