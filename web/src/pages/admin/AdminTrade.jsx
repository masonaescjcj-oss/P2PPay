import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Loading } from '../../components/Layout.jsx'
import Sheet from '../../components/Sheet.jsx'
import { api } from '../../lib/api.js'
import { afn, rate, timeOf, usdt } from '../../lib/format.js'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

function Party({ label, user, tone }) {
  const { t } = usePrefs()
  const stats = useApi(`/admin/users?q=${encodeURIComponent(user.username)}`)
  const u = stats.data?.find((x) => x.id === user.id)
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <span className={`pill ${tone}`} style={{ alignSelf: 'flex-start', borderRadius: 8 }}>{label}</span>
      <strong>{user.displayName} <span className="caption" dir="ltr">@{user.username}</span></strong>
      {u && (
        <span className="caption row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span><span className="num">{u.completed}</span> {t('trades')}</span>
          {u.completionRate != null && <span>· <span className="num">{u.completionRate}%</span> {t('completion')}</span>}
          {u.blocked && <span className="pill coral">{t('blocked')}</span>}
        </span>
      )}
    </div>
  )
}

export default function AdminTrade() {
  const { id } = useParams()
  const { t, pm, lang, errText } = usePrefs()
  const trade = useApi(`/trades/${id}`, { interval: 10000 })
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sheet, setSheet] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const loadMsgs = useCallback(() => api.get(`/trades/${id}/messages`).then(setMsgs, (e) => setError(errText(e))), [id, errText])
  useEffect(() => {
    loadMsgs()
    const iv = setInterval(loadMsgs, 5000)
    return () => clearInterval(iv)
  }, [loadMsgs])

  const tr = trade.data
  if (trade.loading) return <Loading />
  if (!tr) return <p className="error-text">{errText(trade.error)}</p>

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    try {
      await api.post(`/trades/${id}/messages`, { body: text })
      setText('')
      loadMsgs()
    } catch (err) {
      setError(errText(err))
    }
  }

  async function resolve() {
    setBusy(true)
    setError(null)
    try {
      trade.setData(await api.post(`/admin/trades/${id}/resolve`, { winner: sheet, note: note || undefined }))
      setSheet(null)
      loadMsgs()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const canResolve = tr.status === 'disputed' || tr.status === 'paid'
  const nameOf = (uid) => (uid === tr.buyer.id ? `${t('buyer')} · ${tr.buyer.username}` : uid === tr.seller.id ? `${t('seller')} · ${tr.seller.username}` : t('support'))

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row">
        <Link to="/admin/disputes" className="icon-btn" aria-label={t('back')}><Icon name="back" /></Link>
        <h2 className="title grow">{t('order')} <span className="num">#{tr.id}</span></h2>
        <span className="pill coral">{t(`st_${tr.status}`)}</span>
      </div>

      {tr.disputeReason && (
        <div className="note coral">
          <Icon name="alert" size={20} />
          <span><strong>{t('reason')}:</strong> {tr.disputeReason}</span>
        </div>
      )}

      <div className="grid-2">
        <Party label={t('buyer')} user={tr.buyer} tone="green" />
        <Party label={t('seller')} user={tr.seller} tone="coral" />
      </div>

      <section className="card tight">
        <div className="kv"><span>USDT</span><span className="num">{usdt(tr.amount)}</span></div>
        <div className="kv"><span>{t('amountToPay')}</span><span><span className="num">{afn(tr.fiat)}</span> ؋</span></div>
        <div className="kv"><span>{t('price')}</span><span><span className="num">{rate(tr.price)}</span> ؋</span></div>
        <div className="kv"><span>{t('paymentMethod')}</span><span>{pm(tr.paymentMethod)}</span></div>
        {tr.paymentAccount && <div className="kv"><span>{t('accountNumber')}</span><span>{tr.paymentAccount.holderName} · <span className="num">{tr.paymentAccount.account}</span></span></div>}
        {tr.paidAt && <div className="kv"><span>{t('paid')}</span><span className="num">{new Date(tr.paidAt).toISOString().slice(0, 16).replace('T', ' ')}</span></div>}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 className="h2">{t('chat')}</h3>
        <div className="stack" style={{ gap: 8, maxHeight: 420, overflowY: 'auto' }}>
          {msgs.map((m) =>
            m.userId === null ? (
              <div key={m.id} className="sys-msg">{m.body.startsWith('admin: ') ? m.body.slice(7) : t(`sys_${m.body}`)}</div>
            ) : (
              <div key={m.id} className="stack" style={{ gap: 2, padding: '8px 12px', borderRadius: 12, background: m.fromAdmin ? 'var(--gold-tint)' : 'var(--surface-2)' }}>
                <span className="caption strong">{nameOf(m.userId)} · <span className="num">{timeOf(m.createdAt, lang)}</span></span>
                <span style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</span>
              </div>
            )
          )}
        </div>
        <form className="row" style={{ gap: 8 }} onSubmit={send}>
          <label htmlFor="amsg" className="sr-only">{t('messageAsSupport')}</label>
          <div className="input-box sm grow"><input id="amsg" placeholder={t('messageAsSupport')} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} /></div>
          <button type="submit" className="icon-btn" style={{ width: 50, height: 50, background: 'var(--accent)', color: 'var(--on-accent)', border: 0 }} aria-label={t('send')} disabled={!text.trim()}><Icon name="send" stroke={2} /></button>
        </form>
      </section>

      {error && <p className="error-text" role="alert">{error}</p>}

      {canResolve && (
        <div className="grid-2">
          <button type="button" className="btn btn-buy" onClick={() => { setNote(''); setSheet('buyer') }}>{t('resolveBuyer')}</button>
          <button type="button" className="btn btn-sell" onClick={() => { setNote(''); setSheet('seller') }}>{t('resolveSeller')}</button>
        </div>
      )}

      {sheet && (
        <Sheet title={sheet === 'buyer' ? t('resolveBuyer') : t('resolveSeller')} onClose={() => setSheet(null)}>
          <p style={{ fontSize: 14, lineHeight: 1.9 }}>{sheet === 'buyer' ? t('confirmResolveBuyer') : t('confirmResolveSeller')}</p>
          <div className="field">
            <label htmlFor="dn" className="label">{t('decisionNote')}</label>
            <div className="input-box"><textarea id="dn" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className={`btn ${sheet === 'buyer' ? 'btn-buy' : 'btn-sell'}`} disabled={busy || !note.trim()} onClick={resolve}>{t('confirm')}</button>
        </Sheet>
      )}
    </div>
  )
}
