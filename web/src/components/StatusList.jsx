import { dayKey, usdt } from '../lib/format.js'
import { usePrefs } from '../lib/prefs.jsx'

const TONE = { pending: 'gold', sending: 'blue', approved: 'green', sent: 'green', failed: 'coral', rejected: 'coral' }

export default function StatusList({ title, items, showAddress }) {
  const { t } = usePrefs()
  if (!items?.length) return null
  return (
    <section className="stack" style={{ gap: 0 }}>
      <h2 className="h2" style={{ paddingBottom: 6 }}>{title}</h2>
      {items.slice(0, 5).map((x) => (
        <div key={x.id} className="list-row">
          <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="num strong" style={{ fontSize: 14, textAlign: 'start' }}>{usdt(x.amount)} USDT</span>
            <span className="caption num" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>
              {showAddress ? x.address : x.txid}
            </span>
          </div>
          <div className="end">
            <span className={`pill ${TONE[x.status]}`}>{t(`status_${x.status}`)}</span>
            <span className="caption">{(() => { const k = dayKey(x.createdAt); return k === 'today' || k === 'yesterday' ? t(k) : k })()}</span>
          </div>
        </div>
      ))}
    </section>
  )
}
