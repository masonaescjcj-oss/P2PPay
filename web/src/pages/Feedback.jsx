import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Loading, Toast, TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

const KINDS = ['bug', 'idea', 'question', 'other']
const STATUS_TONE = { new: 'neutral', seen: 'blue', done: 'green' }

// Beta testers tell the team what broke or what they would change, and read the team's answers.
export default function Feedback() {
  const { t, errText } = usePrefs()
  const location = useLocation()
  const mine = useApi('/feedback')
  const [kind, setKind] = useState(() => (KINDS.includes(location.state?.kind) ? location.state.kind : 'bug'))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, showToast] = useToast()
  const page = location.state?.from || null

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/feedback', { kind, message: message.trim(), page })
      setMessage('')
      showToast(t('feedbackThanks'))
      mine.reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <TopBar title={t('feedbackTitle')} back="/profile" />
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.9 }}>{t('feedbackSub')}</p>

      <form className="card stack" style={{ gap: 14 }} onSubmit={send}>
        <div className="chips" role="group" aria-label={t('feedbackKind')}>
          {KINDS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`fb_${k}`)}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="fbm" className="label">{t('feedbackMessage')}</label>
          <div className="input-box">
            <textarea id="fbm" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t(`fbHint_${kind}`)} />
          </div>
          <span className="hint">{t('feedbackPrivacy')}</span>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || message.trim().length < 5}>
          <Icon name="send" size={18} />
          {t('sendFeedback')}
        </button>
      </form>

      <h2 className="h2">{t('myFeedback')}</h2>
      {mine.loading ? (
        <Loading />
      ) : !mine.data?.length ? (
        <Empty>{t('noFeedbackYet')}</Empty>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {mine.data.map((f) => (
            <article key={f.id} className="card stack" style={{ gap: 8 }}>
              <div className="between">
                <span className="pill neutral">{t(`fb_${f.kind}`)}</span>
                <span className={`pill ${STATUS_TONE[f.status]}`}>{t(`fbStatus_${f.status}`)}</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>{f.message}</p>
              {f.reply && (
                <div className="note green" style={{ alignItems: 'flex-start' }}>
                  <Icon name="chat" size={18} />
                  <span><strong>{t('teamReply')}: </strong>{f.reply}</span>
                </div>
              )}
              <span className="caption num">{new Date(f.createdAt).toLocaleDateString()}</span>
            </article>
          ))}
        </div>
      )}
      <Toast msg={toast} />
    </main>
  )
}
