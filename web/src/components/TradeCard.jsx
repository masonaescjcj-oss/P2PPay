import { Link } from 'react-router-dom'
import { afn, clock, usdt } from '../lib/format.js'
import { useNow } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'
import Icon from './Icon.jsx'

export function statusText(t, trade) {
  const s = trade.status
  if (s === 'pending_payment' && trade.role === 'buyer') return t('st_pending_payment_buyer')
  if (s === 'paid' && trade.role === 'seller') return t('st_paid_seller')
  return t(`st_${s}`)
}

const TONE = { pending_payment: 'gold', paid: 'blue', disputed: 'coral', completed: 'green', cancelled: 'neutral' }

export default function TradeCard({ trade }) {
  const { t } = usePrefs()
  const now = useNow()
  const isBuy = trade.role === 'buyer'
  const other = isBuy ? trade.seller : trade.buyer
  const left = trade.expiresAt - now
  const tone = TONE[trade.status]
  return (
    <Link to={`/trades/${trade.id}`} className="card stack" style={{ gap: 10, color: 'var(--text)', borderColor: trade.status === 'disputed' ? 'var(--coral-tint-line)' : undefined }}>
      <div className="between">
        <div className="row" style={{ gap: 8 }}>
          <span className={`pill ${isBuy ? 'green' : 'coral'}`}>{isBuy ? t('buy') : t('sell')}</span>
          <span className="caption">
            <span className="num">#{trade.id}</span> · {other.displayName}
          </span>
        </div>
        {trade.status === 'pending_payment' && left > 0 && (
          <span className="row t-gold strong" style={{ gap: 4, fontSize: 13 }}>
            <span className="num">{clock(left)}</span>
            <Icon name="clock" size={14} stroke={2} />
          </span>
        )}
      </div>
      <div className="between" style={{ alignItems: 'baseline' }}>
        <span style={{ fontSize: 20, fontWeight: 800 }}>
          <span className="num">{usdt(trade.amount)}</span> <span className="muted" style={{ fontSize: 13 }}>USDT</span>
        </span>
        <span className="strong" style={{ color: 'var(--text-2)' }}>
          <span className="num">{afn(trade.fiat)}</span> ؋
        </span>
      </div>
      <span className={`pill ${tone}`} style={{ alignSelf: 'flex-start' }}>{statusText(t, trade)}</span>
    </Link>
  )
}
