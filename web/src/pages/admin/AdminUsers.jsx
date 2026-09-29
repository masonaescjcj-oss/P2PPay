import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Empty, Loading } from '../../components/Layout.jsx'
import { api } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.jsx'
import { dateOf, initial, usdt } from '../../lib/format.js'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

export default function AdminUsers() {
  const { t, lang, errText } = usePrefs()
  const { user: me } = useAuth()
  const { perms } = useOutletContext()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350)
    return () => clearTimeout(id)
  }, [q])
  const list = useApi(`/admin/users?q=${encodeURIComponent(query)}`)

  async function set(path, body) {
    setError(null)
    try {
      await api.post(path, body)
      list.reload()
    } catch (err) {
      setError(errText(err))
    }
  }

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
                  <strong className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {u.displayName}
                    {u.role !== 'user' && <span className="pill gold">{t(`role_${u.role}`)}</span>}
                    <span className="pill neutral">{t('tier', { n: u.kycTier })}</span>
                    {u.totpEnabled && <span className="pill green">2FA</span>}
                    {u.blocked && <span className="pill coral">{t('blocked')}</span>}
                    {u.tradeFrozenUntil && <span className="pill gold">{t('frozenUntil', { d: dateOf(u.tradeFrozenUntil, lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</span>}
                  </strong>
                  <span className="caption" dir="ltr" style={{ textAlign: 'start' }}>@{u.username}{u.phone ? ` · ${u.phone}` : ''}</span>
                </div>
              </div>
              <div className="grid-3" style={{ gap: 8 }}>
                <div className="stat"><span>{t('available')}</span><span className="num">{usdt(u.available)}</span></div>
                <div className="stat"><span>{t('inEscrow')}</span><span className="num">{usdt(u.locked)}</span></div>
                <div className="stat"><span>{t('memberTrades')}</span><span className="num">{u.completed}{u.completionRate != null ? ` · ${u.completionRate}%` : ''}</span></div>
              </div>
              {u.id !== me.id && (perms.includes('kyc') || perms.includes('staff')) && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {perms.includes('kyc') && (
                    <label className="input-box sm grow" style={{ minHeight: 40 }}>
                      <span className="caption">{t('setTier')}</span>
                      <select value={u.kycTier} onChange={(e) => set(`/admin/users/${u.id}/tier`, { tier: Number(e.target.value) })} style={{ height: 38, fontSize: 13 }}>
                        {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{t('tier', { n })}</option>)}
                      </select>
                    </label>
                  )}
                  {perms.includes('staff') && (
                    <label className="input-box sm grow" style={{ minHeight: 40 }}>
                      <span className="caption">{t('setRole')}</span>
                      <select value={u.role} onChange={(e) => set(`/admin/users/${u.id}/role`, { role: e.target.value })} style={{ height: 38, fontSize: 13 }}>
                        {['user', 'support', 'finance', 'admin'].map((r) => <option key={r} value={r}>{t(`role_${r}`)}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {u.tradeFrozenUntil && u.id !== me.id && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ height: 36, alignSelf: 'flex-start' }} onClick={() => set(`/admin/users/${u.id}/unfreeze`, {})}>
                  {t('unfreeze')}
                </button>
              )}
              <div className="between">
                <span className="caption">{t('joined')}: <span className="num">{new Date(u.createdAt).toISOString().slice(0, 10)}</span></span>
                {u.id !== me.id && u.role === 'user' && (
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
