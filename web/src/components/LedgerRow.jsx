import { timeOf, usdt, dayKey } from '../lib/format.js'
import { usePrefs } from '../lib/prefs.jsx'
import Icon from './Icon.jsx'

const LOOK = {
  deposit: ['blue', 'down'],
  withdraw_lock: ['gold', 'up'],
  withdrawal: ['gold', 'up'],
  withdraw_refund: ['neutral', 'down'],
  offer_lock: ['gold', 'lock'],
  offer_unlock: ['neutral', 'lock'],
  trade_lock: ['gold', 'lock'],
  trade_refund: ['neutral', 'swap'],
  escrow_release: ['coral', 'swap'],
  trade_receive: ['green', 'swap'],
}

// Net effect on the user's total (available + locked).
export function ledgerDelta(l) {
  const a = Number(l.available)
  const k = Number(l.locked)
  return a + k
}

export function LedgerRow({ entry }) {
  const { t, lang } = usePrefs()
  const [tone, icon] = LOOK[entry.kind] || ['neutral', 'swap']
  const total = ledgerDelta(entry)
  const moved = total === 0 ? Math.abs(Number(entry.locked)) : total
  const shown = total === 0 ? usdt(String(moved)) : (total > 0 ? '+' : '') + usdt(String(total))
  const day = dayKey(entry.createdAt)
  return (
    <div className="list-row">
      <span className={`icon-tile ${tone}`}><Icon name={icon} size={18} stroke={2} /></span>
      <div className="grow stack" style={{ gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t(`kind_${entry.kind}`)}</span>
        <span className="caption">
          {day === 'today' || day === 'yesterday' ? t(day) : <span className="num">{day}</span>} · <span className="num">{timeOf(entry.createdAt, lang)}</span>
        </span>
      </div>
      <div className="end">
        <span className={`num ${total > 0 ? 't-green' : ''}`} style={{ fontSize: 14, fontWeight: 800, color: total === 0 ? 'var(--muted)' : undefined }}>{shown}</span>
        <span className="caption">USDT</span>
      </div>
    </div>
  )
}
