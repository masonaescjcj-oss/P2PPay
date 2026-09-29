import { useState } from 'react'
import { Empty, Loading } from '../../components/Layout.jsx'
import Sheet from '../../components/Sheet.jsx'
import { api } from '../../lib/api.js'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

const TONE = { info: 'blue', low: 'neutral', medium: 'gold', high: 'coral' }

export default function AdminAlerts() {
  const { t, errText } = usePrefs()
  const [status, setStatus] = useState('open')
  const list = useApi(`/admin/alerts${status ? `?status=${status}` : ''}`, { interval: 20000 })
  const [sheet, setSheet] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)

  async function close() {
    setError(null)
    try {
      await api.post(`/admin/alerts/${sheet.id}/close`, { note })
      setSheet(null)
      list.reload()
    } catch (err) {
      setError(errText(err))
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={status === 'open'} onClick={() => setStatus('open')}>{t('active')}</button>
        <button type="button" className="chip" aria-pressed={status === ''} onClick={() => setStatus('')}>{t('all')}</button>
      </div>
      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('nothingPending')}</Empty>
      ) : (
        <div className="cards">
          {list.data.map((a) => (
            <article key={a.id} className="card stack" style={{ gap: 8, borderColor: a.severity === 'high' ? 'var(--coral-tint-line)' : undefined, opacity: a.status === 'closed' ? 0.7 : 1 }}>
              <div className="between">
                <span className={`pill ${TONE[a.severity]}`}>{t(`severity_${a.severity}`)}</span>
                <span className="caption num">{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
              </div>
              <strong style={{ fontSize: 14 }}>{t(`rule_${a.rule}`)}</strong>
              <span className="caption" dir="ltr" style={{ textAlign: 'start' }}>@{a.username}</span>
              <div className="card tight" style={{ background: 'var(--sunken)' }}>
                {Object.entries(a.details).map(([k, v]) => (
                  <div key={k} className="kv"><span dir="ltr">{k}</span><span className="mono" style={{ fontSize: 12 }}>{Array.isArray(v) ? v.join(', ') : String(v)}</span></div>
                ))}
              </div>
              {a.status === 'closed' ? (
                <span className="caption">✓ @{a.closedBy}{a.note ? ` — ${a.note}` : ''}</span>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNote(''); setError(null); setSheet(a) }}>{t('closeAlert')}</button>
              )}
            </article>
          ))}
        </div>
      )}
      {sheet && (
        <Sheet title={t('closeAlert')} onClose={() => setSheet(null)}>
          <strong>{t(`rule_${sheet.rule}`)} · @{sheet.username}</strong>
          <div className="field">
            <label htmlFor="an" className="label">{t('alertNote')}</label>
            <div className="input-box"><textarea id="an" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className="btn btn-primary" disabled={!note.trim()} onClick={close}>{t('confirm')}</button>
        </Sheet>
      )}
    </div>
  )
}
