import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Loading, TabBar } from '../components/Layout.jsx'
import TradeCard from '../components/TradeCard.jsx'
import { api } from '../lib/api.js'
import { afn, rate, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

const OPEN = ['pending_payment', 'paid', 'disputed']

function MyOffer({ offer, onChange }) {
  const { t, pm, errText } = usePrefs()
  const [error, setError] = useState(null)
  const set = async (status) => {
    setError(null)
    try {
      onChange(await api.post(`/offers/${offer.id}/status`, { status }))
    } catch (err) {
      setError(errText(err))
    }
  }
  const isSell = offer.side === 'sell'
  const tone = { active: 'green', paused: 'gold', closed: 'neutral' }[offer.status]
  return (
    <article className="card stack" style={{ gap: 10, opacity: offer.status === 'closed' ? 0.7 : 1 }}>
      <div className="between">
        <div className="row" style={{ gap: 8 }}>
          <span className={`pill ${isSell ? 'coral' : 'green'}`} style={{ borderRadius: 8 }}>{isSell ? t('sell') : t('buy')}</span>
          <span className="caption num">#{offer.id}</span>
        </div>
        <span className={`pill ${tone}`}>{t(`offer_${offer.status}`)}</span>
      </div>
      <div className="between" style={{ alignItems: 'baseline' }}>
        <span style={{ fontSize: 20, fontWeight: 800 }}><span className="num">{rate(offer.price)}</span> <span className="muted" style={{ fontSize: 13 }}>؋ / USDT</span></span>
        <span className="caption">{t('remaining')}: <span className="num strong" style={{ color: 'var(--text)' }}>{usdt(offer.remaining)}</span> / <span className="num">{usdt(offer.total)}</span></span>
      </div>
      <div className="between caption" style={{ flexWrap: 'wrap' }}>
        <span>{t('limits')}: <span className="num">{afn(offer.minFiat)} – {afn(offer.maxFiat)}</span> ؋</span>
        <span className="row" style={{ gap: 6 }}>{offer.paymentMethods.map((m) => <span key={m} className="tag">{pm(m)}</span>)}</span>
      </div>
      {offer.status !== 'closed' && (
        <div className="row" style={{ gap: 8 }}>
          {offer.status === 'active' ? (
            <button type="button" className="btn btn-secondary btn-sm grow" onClick={() => set('paused')}>{t('pause')}</button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm grow" onClick={() => set('active')}>{t('resume')}</button>
          )}
          <button type="button" className="btn btn-danger btn-sm grow" onClick={() => set('closed')}>{t('closeOffer')}</button>
        </div>
      )}
      {error && <span className="error-text">{error}</span>}
    </article>
  )
}

export default function Orders() {
  const { t } = usePrefs()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'active'
  const trades = useApi('/trades', { interval: 8000 })
  const offers = useApi('/offers/mine', { enabled: tab === 'offers' })

  const list = trades.data || []
  const active = list.filter((x) => OPEN.includes(x.status))
  const done = list.filter((x) => !OPEN.includes(x.status))

  return (
    <>
      <main className="page with-tabs" style={{ gap: 14 }}>
        <div className="between">
          <h1 className="h1">{t('orders')}</h1>
          <Link to="/offers/new" className="btn btn-secondary btn-sm" style={{ color: 'var(--gold-text)', height: 40 }}>
            <Icon name="plus" size={16} stroke={2.2} />
            {t('newOffer')}
          </Link>
        </div>

        <div className="seg" style={{ height: 46 }}>
          <button type="button" aria-pressed={tab === 'active'} onClick={() => setParams({}, { replace: true })}>
            {t('active')}
            {active.length > 0 && <span className="pill gold num" style={{ height: 20, padding: '0 7px', background: 'var(--gold)', color: 'var(--on-gold)' }}>{active.length}</span>}
          </button>
          <button type="button" aria-pressed={tab === 'done'} onClick={() => setParams({ tab: 'done' }, { replace: true })}>{t('completed')}</button>
          <button type="button" aria-pressed={tab === 'offers'} onClick={() => setParams({ tab: 'offers' }, { replace: true })}>{t('myOffers')}</button>
        </div>

        {tab !== 'offers' && trades.loading && <Loading />}
        {tab === 'active' && !trades.loading && (active.length ? active.map((tr) => <TradeCard key={tr.id} trade={tr} />) : <Empty action={<Link to="/market" className="btn btn-secondary btn-sm">{t('goMarket')}</Link>}>{t('noActive')}</Empty>)}
        {tab === 'done' && !trades.loading && (done.length ? done.map((tr) => <TradeCard key={tr.id} trade={tr} />) : <Empty>{t('noCompleted')}</Empty>)}
        {tab === 'offers' &&
          (offers.loading ? (
            <Loading />
          ) : offers.data?.length ? (
            offers.data.map((o) => (
              <MyOffer key={o.id} offer={o} onChange={(n) => offers.setData(offers.data.map((x) => (x.id === n.id ? n : x)))} />
            ))
          ) : (
            <Empty action={<Link to="/offers/new" className="btn btn-primary btn-sm">{t('createOffer')}</Link>}>{t('noMyOffers')}</Empty>
          ))}
      </main>
      <TabBar />
    </>
  )
}
