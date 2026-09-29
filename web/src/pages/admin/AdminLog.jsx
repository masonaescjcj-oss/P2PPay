import { Link } from 'react-router-dom'
import { Empty, Loading } from '../../components/Layout.jsx'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

const TONE = { approve: 'green', reject: 'coral', buyer: 'green', seller: 'coral', block: 'coral', unblock: 'neutral' }

export default function AdminLog() {
  const { t } = usePrefs()
  const log = useApi('/admin/actions', { interval: 20000 })
  if (log.loading) return <Loading />
  if (!log.data?.length) return <Empty>{t('nothingPending')}</Empty>
  return (
    <section className="card flush">
      {log.data.map((a) => {
        const tone = TONE[a.action.split('_').pop()] || 'neutral'
        const target = a.targetType === 'trade' ? <Link to={`/admin/trades/${a.targetId}`} className="num">#{a.targetId}</Link> : <span className="num">#{a.targetId}</span>
        return (
          <div key={a.id} className="menu-row" style={{ cursor: 'default', minHeight: 64 }}>
            <span className={`pill ${tone}`}>{t(`action_${a.action}`)}</span>
            <div className="grow stack" style={{ gap: 2 }}>
              <span style={{ fontSize: 13 }}>{a.targetType} {target} · <span dir="ltr">@{a.admin}</span></span>
              {a.note && <span className="caption">{a.note}</span>}
            </div>
            <span className="caption num">{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
          </div>
        )
      })}
    </section>
  )
}
