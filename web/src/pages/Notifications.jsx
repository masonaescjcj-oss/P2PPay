import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Loading, TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { timeOf, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'
import { usePush } from '../lib/push.js'

const LOOK = {
  trade_opened: ['accent', 'swap'],
  trade_request: ['gold', 'user'],
  trade_accepted: ['green', 'check'],
  trade_declined: ['neutral', 'x'],
  trade_paid: ['gold', 'check'],
  trade_released: ['green', 'check'],
  trade_cancelled: ['neutral', 'x'],
  trade_disputed: ['coral', 'flag'],
  trade_resolved: ['blue', 'shieldCheck'],
  trade_message: ['accent', 'chat'],
  deposit_credited: ['green', 'down'],
  deposit_rejected: ['coral', 'down'],
  withdrawal_sent: ['blue', 'up'],
  withdrawal_rejected: ['coral', 'up'],
  kyc_approved: ['green', 'shieldCheck'],
  kyc_rejected: ['coral', 'user'],
  feedback_reply: ['accent', 'chat'],
}

function PushCard() {
  const { t, lang } = usePrefs()
  const push = usePush(lang)
  const [busy, setBusy] = useState(false)
  if (!['off', 'on', 'denied'].includes(push.state)) return null
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card between" style={{ gap: 12 }}>
      <span className="icon-tile accent"><Icon name="bell" size={20} /></span>
      <div className="grow stack" style={{ gap: 2 }}>
        <strong style={{ fontSize: 14.5 }}>{t('pushTitle')}</strong>
        <span className="caption" style={{ lineHeight: 1.7 }}>{push.state === 'denied' ? t('pushDenied') : push.state === 'on' ? t('pushOn') : t('pushSub')}</span>
      </div>
      {push.state === 'off' && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(push.enable)}>{t('pushEnable')}</button>}
      {push.state === 'on' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(push.disable)}>{t('pushDisable')}</button>}
    </section>
  )
}

export default function Notifications() {
  const { t, lang } = usePrefs()
  const navigate = useNavigate()
  const list = useApi('/notifications', { interval: 15000 })
  const items = list.data?.items || []

  async function open(n) {
    if (!n.read) api.post('/notifications/read', { ids: [n.id] }).catch(() => {})
    navigate(n.url)
  }
  async function readAll() {
    await api.post('/notifications/read', { all: true })
    list.reload()
  }

  return (
    <main className="page">
      <TopBar title={t('notificationsTitle')} back="/">
        {list.data?.unread > 0 && <button type="button" className="btn-link" onClick={readAll}>{t('markAllRead')}</button>}
      </TopBar>
      <PushCard />
      {list.loading ? (
        <Loading />
      ) : !items.length ? (
        <Empty>{t('noNotifications')}</Empty>
      ) : (
        <div className="card" style={{ padding: '2px 8px' }}>
          {items.map((n) => {
            const [tone, icon] = LOOK[n.kind] || ['neutral', 'bell']
            const data = n.data.amount ? { ...n.data, amount: usdt(n.data.amount) } : n.data
            return (
              <button key={n.id} type="button" className="menu-row notif" onClick={() => open(n)} style={{ minHeight: 70, paddingInline: 8 }}>
                <span className={`icon-tile ${tone}`}><Icon name={icon} size={18} stroke={2} /></span>
                <span className="grow stack" style={{ gap: 2 }}>
                  <span style={{ fontWeight: n.read ? 600 : 800 }}>{t(`ntf_${n.kind}`, data)}</span>
                  <span className="caption">{t(`ntfsub_${n.kind}`, data)} · <span className="num">{timeOf(n.createdAt, lang)}</span></span>
                </span>
                {!n.read && <span className="unread-dot" aria-label={t('unread')} />}
              </button>
            )
          })}
        </div>
      )}
    </main>
  )
}
