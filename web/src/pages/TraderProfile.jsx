import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Loading, Toast, TopBar } from '../components/Layout.jsx'
import OfferCard from '../components/OfferCard.jsx'
import Sheet from '../components/Sheet.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateOf, initial } from '../lib/format.js'
import { useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

// Public page of a trader: what a counterparty wants to know before trading.
export default function TraderProfile() {
  const { username } = useParams()
  const { t, lang, errText } = usePrefs()
  const { user } = useAuth()
  const p = useApi(`/users/${encodeURIComponent(username)}`)
  const [toast, showToast] = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const d = p.data

  async function setBlocked(on) {
    setBusy(true)
    try {
      await api.post(`/users/${encodeURIComponent(d.username)}/${on ? 'block' : 'unblock'}`)
      showToast(t(on ? 'blockedToast' : 'unblockedToast'))
      setConfirm(false)
      p.reload()
    } catch (err) {
      showToast(errText(err))
    } finally {
      setBusy(false)
    }
  }
  if (p.loading) return <main className="page"><Loading /></main>
  if (!d) return <main className="page"><TopBar title={t('traderProfile')} /><p className="error-text">{errText(p.error)}</p></main>
  const since = dateOf(d.memberSince, lang, { year: 'numeric', month: 'long' })
  return (
    <main className="page">
      <TopBar title={t('traderProfile')} />
      <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
        <div className="avatar gold" style={{ width: 80, height: 80, fontSize: 30 }}>{initial(d.displayName)}</div>
        <strong style={{ fontSize: 21, fontWeight: 800, marginTop: 6 }}>{d.displayName}</strong>
        <span dir="ltr" className="caption">@{d.username}</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
          {d.verified && <span className="pill green"><Icon name="check" size={12} stroke={2.4} />{t('verified')}</span>}
          <span className="pill neutral">{t('memberSince', { d: since })}</span>
        </div>
      </div>

      <div className="grid-3" style={{ gap: 8 }}>
        <div className="stat"><span>{t('memberTrades')}</span><span className="num">{d.completed}</span></div>
        <div className="stat"><span>{t('completionRate')}</span><span className="num">{d.completionRate != null ? `${d.completionRate}%` : '—'}</span></div>
        <div className="stat"><span>{t('positiveRatings')}</span><span className="num t-green">{d.ratings.positivePct != null ? `${d.ratings.positivePct}%` : '—'}</span></div>
      </div>
      {d.medianReleaseMinutes != null && (
        <div className="note accent" style={{ alignItems: 'center' }}>
          <Icon name="clock" size={18} />
          <span>{t('medianRelease', { n: d.medianReleaseMinutes })}</span>
        </div>
      )}

      {d.offers.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2 className="h2">{t('activeOffers')}</h2>
          {d.offers.map((o) => <OfferCard key={o.id} offer={o} side={o.side === 'sell' ? 'buy' : 'sell'} />)}
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <div className="between">
          <h2 className="h2">{t('reviews')}</h2>
          <span className="caption"><Icon name="thumbUp" size={13} /> <span className="num">{d.ratings.up}</span> · <span className="num">{d.ratings.down}</span></span>
        </div>
        {!d.reviews.length ? (
          <Empty>{t('noReviews')}</Empty>
        ) : (
          <div className="card" style={{ padding: '4px 16px' }}>
            {d.reviews.map((r, i) => (
              <div key={i} className="list-row" style={{ alignItems: 'flex-start', paddingBlock: 12 }}>
                <span className={`icon-tile ${r.positive ? 'green' : 'coral'}`} style={{ width: 34, height: 34 }}>
                  <Icon name="thumbUp" size={16} style={r.positive ? undefined : { transform: 'scaleY(-1)' }} />
                </span>
                <div className="grow stack" style={{ gap: 2 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.8 }}>{r.comment || (r.positive ? t('rateGood') : t('rateBad'))}</span>
                  <span className="caption">{t(r.from === 'buyer' ? 'fromBuyer' : 'fromSeller')} · <span>{dateOf(r.createdAt, lang)}</span></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {user && !d.isMe && (
        d.blockedByMe ? (
          <div className="note coral" style={{ alignItems: 'center' }}>
            <Icon name="x" size={18} />
            <span className="grow">{t('blockedNote')}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setBlocked(false)}>{t('unblockUser')}</button>
          </div>
        ) : (
          <button type="button" className="btn-link" style={{ color: 'var(--coral-text)', textAlign: 'center' }} onClick={() => setConfirm(true)}>
            {t('blockUser')}
          </button>
        )
      )}
      {confirm && (
        <Sheet title={t('blockUser')} onClose={() => setConfirm(false)}>
          <p style={{ fontSize: 14, lineHeight: 1.9 }}>{t('blockConfirm')}</p>
          <button type="button" className="btn btn-sell" disabled={busy} onClick={() => setBlocked(true)}>{t('blockUser')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>{t('cancel')}</button>
        </Sheet>
      )}
      <Toast msg={toast} />
    </main>
  )
}
