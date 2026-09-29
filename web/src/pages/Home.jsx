import { useState } from 'react'
import { LegalText } from '../components/LegalContent.jsx'
import Sheet from '../components/Sheet.jsx'
import { api } from '../lib/api.js'
import { Link } from 'react-router-dom'
import { Girih, TetherMark } from '../components/Brand.jsx'
import Icon from '../components/Icon.jsx'
import { TabBar } from '../components/Layout.jsx'
import TradeCard from '../components/TradeCard.jsx'
import { LedgerRow } from '../components/LedgerRow.jsx'
import { useAuth } from '../lib/auth.jsx'
import { afn, initial, rate, toNum, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

export function BalanceCard({ wallet, afnPrice }) {
  const { t } = usePrefs()
  const [hidden, setHidden] = useState(false)
  const mask = (v) => (hidden ? '••••' : v)
  const total = wallet ? usdt(wallet.total) : '—'
  const [whole, frac] = total.split('.')
  return (
    <section className="balance-card" aria-label={t('totalBalance')}>
      <Girih />
      <div className="between">
        <div className="row sub" style={{ gap: 6 }}>
          {t('totalBalance')}
          <button type="button" className="icon-btn plain" style={{ width: 32, height: 32, color: 'var(--lapis-text-2)' }} aria-label={t('hideBalance')} aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
            <Icon name={hidden ? 'eyeOff' : 'eye'} size={17} />
          </button>
        </div>
        <span className="pair">
          <TetherMark size={20} />
          <span dir="ltr">USDT · TRC20</span>
        </span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <div dir="ltr" className="row" style={{ alignItems: 'baseline', gap: 8, justifyContent: 'flex-end' }}>
          <span className="big num">
            {hidden ? '••••' : whole}
            {!hidden && frac && <span style={{ color: 'var(--lapis-muted)' }}>.{frac}</span>}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#E9B44C' }}>USDT</span>
        </div>
        {wallet && afnPrice && (
          <div className="sub">{t('approxAfn', { v: mask(afn(String(Math.round(toNum(wallet.total) * afnPrice)))) })}</div>
        )}
      </div>
      <div className="row">
        <div className="mini">
          <span>{t('available')}</span>
          <span className="num" style={{ textAlign: 'end' }}>{mask(wallet ? usdt(wallet.available) : '—')}</span>
        </div>
        <div className="mini">
          <span className="row" style={{ gap: 4 }}>
            {t('inEscrow')}
            <Icon name="lock" size={12} stroke={2} style={{ color: '#E9B44C' }} />
          </span>
          <span className="num" style={{ textAlign: 'end' }}>{mask(wallet ? usdt(wallet.locked) : '—')}</span>
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  const { t } = usePrefs()
  const { user, config, refresh } = useAuth()
  const [termsOpen, setTermsOpen] = useState(false)
  const needsTerms = config?.termsVersion && user.termsCurrent === false
  async function acceptTerms() {
    await api.post('/me/accept-terms', { version: config.termsVersion })
    setTermsOpen(false)
    await refresh()
  }
  const beta = config?.beta
  const betaOn = !!(beta && (beta.inviteOnly || beta.maxTrade || beta.label))
  const wallet = useApi('/wallet', { interval: 15000 })
  const trades = useApi('/trades', { interval: 10000 })
  const buyOffers = useApi('/offers?side=buy')
  const sellOffers = useApi('/offers?side=sell')

  const bestBuy = buyOffers.data?.[0]?.price
  const bestSell = sellOffers.data?.[0]?.price
  const active = (trades.data || []).filter((tr) => ['pending_payment', 'paid', 'disputed'].includes(tr.status))
  const ledger = (wallet.data?.ledger || []).slice(0, 3)

  return (
    <>
      <main className="page with-tabs" style={{ gap: 18 }}>
        <div className="between">
          <div className="row" style={{ gap: 12 }}>
            <div className="avatar gold">{initial(user.displayName)}</div>
            <div className="stack" style={{ gap: 2 }}>
              <span className="caption">{t('greeting')}</span>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{user.displayName}</span>
            </div>
          </div>
          <Link to="/orders" className="icon-btn" aria-label={t('orders')}>
            <Icon name="bell" />
            {active.length > 0 && <span className="dot" />}
          </Link>
        </div>

        {(user.kycTier ?? 0) < 1 && (
          <Link to="/profile/verification" className="note gold" style={{ alignItems: 'center' }}>
            <Icon name="shieldCheck" size={20} />
            <span className="grow">{t('verifyToTrade')}</span>
            <span className="strong t-gold">{t('goVerify')}</span>
          </Link>
        )}

        {needsTerms && (
          <div className="note gold" style={{ alignItems: 'center' }}>
            <Icon name="flag" size={20} />
            <span className="grow">{t('termsUpdated')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTermsOpen(true)}>{t('readTerms')}</button>
          </div>
        )}
        {termsOpen && (
          <Sheet title={t('termsTitle')} onClose={() => setTermsOpen(false)}>
            <div className="sheet-scroll"><LegalText doc="terms" /><LegalText doc="privacy" /></div>
            <button type="button" className="btn btn-primary" onClick={acceptTerms}>{t('acceptTermsButton')}</button>
          </Sheet>
        )}

        {betaOn && (
          <Link to="/profile/feedback" state={{ from: '/' }} className="note blue beta-note" style={{ alignItems: 'center' }}>
            <span className="pill blue" style={{ height: 22 }}>{t('betaBadge')}</span>
            <span className="grow stack" style={{ fontSize: 13, lineHeight: 1.8, gap: 0 }}>
              <span>{beta.label || t('betaNote')}</span>
              {beta.maxTrade && <span className="caption">{t('betaCap', { max: beta.maxTrade })}</span>}
            </span>
            <span className="strong" style={{ color: 'var(--blue-text)', whiteSpace: 'nowrap' }}>{t('sendFeedbackShort')}</span>
          </Link>
        )}

        <BalanceCard wallet={wallet.data} afnPrice={toNum(bestBuy) || null} />

        <nav className="grid-4" aria-label={t('wallet')}>
          <Link to="/deposit" className="action-tile"><span className="icon-tile blue"><Icon name="down" stroke={2} /></span>{t('deposit')}</Link>
          <Link to="/withdraw" className="action-tile"><span className="icon-tile blue"><Icon name="up" stroke={2} /></span>{t('withdraw')}</Link>
          <Link to="/market?side=buy" className="action-tile"><span className="icon-tile green"><Icon name="plus" stroke={2} /></span>{t('buy')}</Link>
          <Link to="/market?side=sell" className="action-tile"><span className="icon-tile coral"><Icon name="minus" stroke={2} /></span>{t('sell')}</Link>
        </nav>

        <div className="card between" style={{ padding: '12px 16px' }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="caption">{t('bestBuy')}</span>
            <span className="t-green" style={{ fontSize: 16, fontWeight: 800 }}><span className="num">{bestBuy ? rate(bestBuy) : '—'}</span> ؋</span>
          </div>
          <span style={{ width: 1, height: 32, background: 'var(--line-strong)' }} />
          <div className="stack" style={{ gap: 2 }}>
            <span className="caption">{t('bestSell')}</span>
            <span className="t-coral" style={{ fontSize: 16, fontWeight: 800 }}><span className="num">{bestSell ? rate(bestSell) : '—'}</span> ؋</span>
          </div>
          <Link to="/market" className="icon-btn" aria-label={t('goMarket')} style={{ background: 'var(--surface-3)', border: 0 }}>
            <Icon name="forward" size={18} stroke={2} />
          </Link>
        </div>

        {active.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="between">
              <h2 className="h2">{t('activeTrades')}</h2>
              <Link to="/orders" style={{ fontSize: 13, fontWeight: 600 }}>{t('all')}</Link>
            </div>
            {active.slice(0, 2).map((tr) => <TradeCard key={tr.id} trade={tr} />)}
          </section>
        )}

        <section className="stack" style={{ gap: 4 }}>
          <div className="between">
            <h2 className="h2">{t('recentActivity')}</h2>
            <Link to="/wallet" style={{ fontSize: 13, fontWeight: 600 }}>{t('all')}</Link>
          </div>
          {ledger.length ? ledger.map((l) => <LedgerRow key={l.id} entry={l} />) : <p className="muted" style={{ fontSize: 13, lineHeight: 1.9, padding: '8px 0' }}>{t('noActivity')}</p>}
        </section>
      </main>
      <TabBar />
    </>
  )
}
