import { useEffect, useState } from 'react'
import { Empty, Loading } from '../../components/Layout.jsx'
import { api } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.jsx'
import { initial, usdt } from '../../lib/format.js'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

export default function AdminUsers() {
  const { t, errText } = usePrefs()
  const { user: me } = useAuth()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350)
    return () => clearTimeout(id)
  }, [q])
  const list = useApi(`/admin/users?q=${encodeURIComponent(query)}`)

  async function toggle(u) {
    setError(null)
    try {
      await api.post(`/admin/users/${u.id}/block`, { blocked: !u.blocked })
      list.reload()
    } catch (err) {
      setError(errText(err))
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="input-box sm">
        <label htmlFor="uq" className="sr-only">{t('searchUsers')}</label>
        <input id="uq" placeholder={t('searchUsers')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('nothingPending')}</Empty>
      ) : (
        <div className="cards">
          {list.data.map((u) => (
            <article key={u.id} className="card stack" style={{ gap: 10, borderColor: u.blocked ? 'var(--coral-tint-line)' : undefined }}>
              <div className="row">
                <div className="avatar">{initial(u.displayName)}</div>
                <div className="grow stack" style={{ gap: 2 }}>
                  <strong>{u.displayName} {u.role === 'admin' && <span className="pill gold">{t('admin')}</span>} {u.blocked && <span className="pill coral">{t('blocked')}</span>}</strong>
                  <span className="caption" dir="ltr" style={{ textAlign: 'start' }}>@{u.username}{u.phone ? ` · ${u.phone}` : ''}</span>
                </div>
              </div>
              <div className="grid-3" style={{ gap: 8 }}>
                <div className="stat"><span>{t('available')}</span><span className="num">{usdt(u.available)}</span></div>
                <div className="stat"><span>{t('inEscrow')}</span><span className="num">{usdt(u.locked)}</span></div>
                <div className="stat"><span>{t('memberTrades')}</span><span className="num">{u.completed}{u.completionRate != null ? ` · ${u.completionRate}%` : ''}</span></div>
              </div>
              <div className="between">
                <span className="caption">{t('joined')}: <span className="num">{new Date(u.createdAt).toISOString().slice(0, 10)}</span></span>
                {u.id !== me.id && u.role !== 'admin' && (
                  <button type="button" className={`btn btn-sm ${u.blocked ? 'btn-secondary' : 'btn-danger'}`} style={{ height: 36 }} onClick={() => toggle(u)}>
                    {u.blocked ? t('unblock') : t('block')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
