import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Loading } from '../../components/Layout.jsx'
import { afn, usdt } from '../../lib/format.js'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

const TONE = { pending_payment: 'gold', paid: 'blue', disputed: 'coral', completed: 'green', cancelled: 'neutral' }

export default function AdminDisputes() {
  const { t, pm } = usePrefs()
  const [status, setStatus] = useState('disputed')
  const list = useApi(`/admin/trades${status ? `?status=${status}` : ''}`, { interval: 15000 })
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="chips">
        {[['disputed', t('disputes')], ['paid', t('st_paid')], ['pending_payment', t('st_pending_payment')], ['', t('all')]].map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{label}</button>
        ))}
      </div>
      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('nothingPending')}</Empty>
      ) : (
        <div className="cards">
          {list.data.map((tr) => (
            <Link key={tr.id} to={`/admin/trades/${tr.id}`} className="card stack" style={{ gap: 8, color: 'var(--text)' }}>
              <div className="between">
                <span className="strong">{t('order')} <span className="num">#{tr.id}</span></span>
                <span className={`pill ${TONE[tr.status]}`}>{t(`st_${tr.status}`)}</span>
              </div>
              <div className="between" style={{ fontSize: 13 }}>
                <span><span className="caption">{t('buyer')}:</span> {tr.buyer.username}</span>
                <span><span className="caption">{t('seller')}:</span> {tr.seller.username}</span>
              </div>
              <div className="between">
                <span style={{ fontSize: 18, fontWeight: 800 }}><span className="num">{usdt(tr.amount)}</span> <span className="caption">USDT</span></span>
                <span className="strong"><span className="num">{afn(tr.fiat)}</span> ؋ · {pm(tr.paymentMethod)}</span>
              </div>
              {tr.disputeReason && <p className="caption" style={{ lineHeight: 1.8 }}>{t('reason')}: {tr.disputeReason}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
