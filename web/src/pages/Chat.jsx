import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { statusText } from '../components/TradeCard.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { afn, initial, timeOf, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

export default function Chat() {
  const { id } = useParams()
  const { t, lang, errText } = usePrefs()
  const { user } = useAuth()
  const navigate = useNavigate()
  const trade = useApi(`/trades/${id}`, { interval: 8000 })
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const last = useRef(0)
  const bottom = useRef(null)

  const poll = useCallback(async () => {
    try {
      const fresh = await api.get(`/trades/${id}/messages?after=${last.current}`)
      if (fresh.length) {
        last.current = Math.max(last.current, fresh[fresh.length - 1].id)
        // Overlapping polls can return the same rows; keep ids strictly increasing.
        setMsgs((m) => {
          const maxId = m.length ? m[m.length - 1].id : 0
          return [...m, ...fresh.filter((x) => x.id > maxId)]
        })
      }
    } catch (err) {
      setError(errText(err))
    }
  }, [id, errText])

  useEffect(() => {
    last.current = 0
    setMsgs([])
    poll()
    const iv = setInterval(() => document.visibilityState === 'visible' && poll(), 3000)
    return () => clearInterval(iv)
  }, [poll])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [msgs.length])

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError(null)
    try {
      await api.post(`/trades/${id}/messages`, { body: text })
      setText('')
      await poll()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSending(false)
    }
  }

  const tr = trade.data
  const other = tr ? (tr.role === 'buyer' ? tr.seller : tr.buyer) : null

  return (
    <main style={{ display: 'flex', flexDirection: 'column' }}>
      <header className="chat-head">
        <div className="row" style={{ gap: 12 }}>
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => navigate(`/trades/${id}`)}>
            <Icon name="back" />
          </button>
          <div className="avatar">{initial(other?.displayName)}</div>
          <div className="grow stack" style={{ gap: 1 }}>
            <strong style={{ fontSize: 15 }}>{other?.displayName || '…'}</strong>
            <span className="caption">{t('order')} <span className="num">#{id}</span></span>
          </div>
        </div>
        {tr && (
          <Link to={`/trades/${id}`} className="between" style={{ minHeight: 44, padding: '8px 14px', borderRadius: 14, background: 'var(--surface)', color: 'var(--text)', flexWrap: 'wrap', rowGap: 6 }}>
            <span className="nowrap" style={{ fontSize: 13, fontWeight: 700 }}>
              <span className="num">{afn(tr.fiat)}</span> ؋ ⇄ <span className="num">{usdt(tr.amount)}</span> USDT
            </span>
            <span className="pill blue">{statusText(t, tr)}</span>
          </Link>
        )}
      </header>

      <div className="chat-body" aria-live="polite">
        {msgs.length === 0 && <p className="caption" style={{ textAlign: 'center', padding: 24 }}>{t('noMessages')}</p>}
        {msgs.map((m) => {
          if (m.userId === null) {
            const fromAdmin = m.body.startsWith('admin: ')
            return (
              <div key={m.id} className="sys-msg" style={fromAdmin ? { background: 'var(--gold-tint-2)', borderColor: 'var(--gold-tint-line)', color: 'var(--gold-tint-text)' } : undefined}>
                {fromAdmin ? <><strong>{t('support')}:</strong> {m.body.slice(7)}</> : t(`sys_${m.body}`)}
              </div>
            )
          }
          const mine = m.userId === user.id
          return (
            <div key={m.id} className={`bubble ${mine ? 'me' : 'them'}`}>
              {m.fromAdmin && !mine && (
                <span className="caption strong t-gold row" style={{ gap: 4 }}>
                  <Icon name="shieldCheck" size={13} stroke={2} />
                  {t('support')}
                </span>
              )}
              <div className="b" style={m.fromAdmin && !mine ? { border: '1px solid var(--gold-tint-line)' } : undefined}>{m.body}</div>
              <span className="time num">{timeOf(m.createdAt, lang)}</span>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={send}>
        {error && <span className="error-text">{error}</span>}
        <span className="caption row" style={{ gap: 6, fontSize: 11.5 }}>
          <Icon name="shield" size={13} stroke={2} className="t-green" />
          {t('chatSafety')}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <label htmlFor="msg" className="sr-only">{t('writeMessage')}</label>
          <div className="input-box grow" style={{ minHeight: 48, borderRadius: 14 }}>
            <input id="msg" placeholder={t('writeMessage')} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} autoComplete="off" />
          </div>
          <button type="submit" className="icon-btn" style={{ width: 48, height: 48, background: 'var(--accent)', color: 'var(--on-accent)', border: 0 }} aria-label={t('send')} disabled={sending || !text.trim()}>
            <Icon name="send" stroke={2} />
          </button>
        </div>
      </form>
    </main>
  )
}
