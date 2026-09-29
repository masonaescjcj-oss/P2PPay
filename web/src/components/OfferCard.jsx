import { Link } from 'react-router-dom'
import { afn, initial, rate, usdt } from '../lib/format.js'
import { usePrefs } from '../lib/prefs.jsx'

export function VerifiedBadge() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l2.4 2.1 3.2-.3.9 3.1 2.8 1.6-1 3 1 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.9-3.1-2.8-1.6 1-3-1-3 2.8-1.6.9-3.1 3.2.3z" fill="var(--accent)" />
      <path d="m8.5 12 2.4 2.4 4.6-4.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MakerLine({ maker }) {
  const { t } = usePrefs()
  return (
    <div className="grow stack" style={{ gap: 2 }}>
      <div className="row" style={{ gap: 5, fontSize: 14, fontWeight: 700 }}>
        {maker.displayName}
        {maker.completed >= 10 && <VerifiedBadge />}
      </div>
      <div className="caption" style={{ fontSize: 11.5 }}>
        <span className="num">{maker.completed}</span> {t('trades')}
        {maker.completionRate !== null && (
          <>
            {' · '}
            <span className="num">{maker.completionRate}%</span> {t('completion')}
          </>
        )}
      </div>
    </div>
  )
}

// `side` is the visitor's side: 'buy' means the visitor buys from a sell offer.
export default function OfferCard({ offer, side }) {
  const { t, pm } = usePrefs()
  const isBuy = side === 'buy'
  return (
    <article className="offer-card">
      <div className="row">
        <div className="avatar" style={{ width: 42, height: 42, fontSize: 16 }}>
          {initial(offer.maker.displayName)}
        </div>
        <MakerLine maker={offer.maker} />
        <div className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
          <span className={`price ${isBuy ? 't-green' : 't-coral'}`}>
            <span className="num">{rate(offer.price)}</span> <span style={{ fontSize: 14 }}>؋</span>
          </span>
          <span className="caption" style={{ fontSize: 11 }}>{t('perUsdt')}</span>
        </div>
      </div>
      <div className="between" style={{ fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span>
          {t('availableAmt')}: <span className="num strong" style={{ color: 'var(--text)' }}>{usdt(offer.remaining)} USDT</span>
        </span>
        <span>
          {t('limits')}: <span className="num strong" style={{ color: 'var(--text)' }}>{afn(offer.minFiat)} – {afn(offer.maxFiat)}</span> ؋
        </span>
      </div>
      <div className="between">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {offer.paymentMethods.map((m) => (
            <span key={m} className="tag">{pm(m)}</span>
          ))}
        </div>
        <Link to={`/offers/${offer.id}`} className={`btn btn-sm ${isBuy ? 'btn-buy' : 'btn-sell'}`} style={{ flexShrink: 0 }}>
          {isBuy ? t('buy') : t('sell')}
        </Link>
      </div>
    </article>
  )
}
