import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Loading, Toast, TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { dateOf, initial } from '../lib/format.js'
import { useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

// People the user blocked: they can't see the user's offers or trade with them.
export default function BlockedUsers() {
  const { t, lang, errText } = usePrefs()
  const list = useApi('/me/blocks')
  const [toast, showToast] = useToast()
  const [busy, setBusy] = useState(null)

  async function unblock(username) {
    setBusy(username)
    try {
      await api.post(`/users/${encodeURIComponent(username)}/unblock`)
      showToast(t('unblockedToast'))
      list.reload()
    } catch (err) {
      showToast(errText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="page">
      <TopBar title={t('blockedUsers')} back="/profile" />
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.9 }}>{t('blockedUsersSub')}</p>
      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('noBlocked')}</Empty>
      ) : (
        <div className="card" style={{ padding: '4px 16px' }}>
          {list.data.map((b) => (
            <div key={b.username} className="list-row" style={{ paddingBlock: 12 }}>
              <div className="avatar">{initial(b.displayName)}</div>
              <Link to={`/u/${b.username}`} className="grow stack" style={{ gap: 2, color: 'inherit' }}>
                <span className="strong" style={{ fontSize: 14 }}>{b.displayName}</span>
                <span className="caption"><span dir="ltr">@{b.username}</span> · {dateOf(b.blockedAt, lang)}</span>
              </Link>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy === b.username} onClick={() => unblock(b.username)}>{t('unblockUser')}</button>
            </div>
          ))}
        </div>
      )}
      <Toast msg={toast} />
    </main>
  )
}
