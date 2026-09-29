import { useEffect, useState } from 'react'
import { Empty, Loading } from '../../components/Layout.jsx'
import Sheet from '../../components/Sheet.jsx'
import { api } from '../../lib/api.js'
import { useApi } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

const TONE = { pending: 'gold', approved: 'green', rejected: 'coral', draft: 'neutral' }

// Documents are fetched with the staff session and shown from a blob: URL (never a public link).
function DocImage({ path, alt, style }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let url = null
    let alive = true
    fetch(`/api${path}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && alive) setSrc((url = URL.createObjectURL(b)))
      })
      .catch(() => {})
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])
  return src ? <img src={src} alt={alt} style={style} /> : <div className="skeleton" style={{ ...style, height: 'auto' }} aria-label={alt} />
}

export default function AdminKyc() {
  const { t, errText } = usePrefs()
  const [status, setStatus] = useState('pending')
  const list = useApi(`/admin/kyc${status ? `?status=${status}` : ''}`, { interval: 20000 })
  const [sheet, setSheet] = useState(null) // { item, approve, tier }
  const [photo, setPhoto] = useState(null) // { path, label } shown large
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function decide() {
    setBusy(true)
    setError(null)
    try {
      const { item, approve, tier } = sheet
      await api.post(`/admin/kyc/${item.id}/${approve ? 'approve' : 'reject'}`, approve ? { tier } : { reason })
      setSheet(null)
      list.reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={status === 'pending'} onClick={() => setStatus('pending')}>{t('pending')}</button>
        <button type="button" className="chip" aria-pressed={status === ''} onClick={() => setStatus('')}>{t('all')}</button>
      </div>
      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('nothingPending')}</Empty>
      ) : (
        <div className="cards">
          {list.data.map((k) => (
            <article key={k.id} className="card stack" style={{ gap: 10 }}>
              <div className="between">
                <strong>{k.displayName} <span className="caption" dir="ltr">@{k.username}</span></strong>
                <span className={`pill ${TONE[k.status]}`}>{t(`status_${k.status === 'approved' ? 'approved' : k.status}`)}</span>
              </div>
              <div className="card tight" style={{ background: 'var(--sunken)' }}>
                <div className="kv"><span>{t('docType')}</span><span>{t(k.docType)}</span></div>
                <div className="kv"><span>{t('fullName')}</span><span>{k.fullName}</span></div>
                <div className="kv"><span>{t('docNumber')}</span><span className="num">{k.docNumber}</span></div>
                <div className="kv"><span>{t('verificationTitle')}</span><span>{t('tier', { n: k.currentTier })}</span></div>
              </div>
              <div className="grid-3" style={{ gap: 8 }}>
                {k.files.map((f) => {
                  const label = t(f.kind === 'front' ? 'frontPhoto' : f.kind === 'back' ? 'backPhoto' : 'selfiePhoto')
                  return (
                    <button key={f.kind} type="button" className="stack plain-btn" style={{ gap: 4 }} onClick={() => setPhoto({ path: `/admin/kyc/${k.id}/files/${f.kind}`, label })}>
                      <DocImage path={`/admin/kyc/${k.id}/files/${f.kind}`} alt={label} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10, background: 'var(--surface-2)' }} />
                      <span className="caption" style={{ textAlign: 'center' }}>{label}</span>
                    </button>
                  )
                })}
              </div>
              {k.reason && <span className="caption">{t('reason')}: {k.reason}</span>}
              {k.status === 'pending' && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-buy btn-sm grow" onClick={() => { setError(null); setSheet({ item: k, approve: true, tier: 2 }) }}>{t('approveTier2')}</button>
                    <button type="button" className="btn btn-danger btn-sm grow" onClick={() => { setError(null); setReason(''); setSheet({ item: k, approve: false }) }}>{t('reject')}</button>
                  </div>
                  <button type="button" className="btn-link" onClick={() => { setError(null); setSheet({ item: k, approve: true, tier: 3 }) }}>{t('approveTier3')}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {photo && (
        <Sheet title={photo.label} onClose={() => setPhoto(null)}>
          <DocImage path={photo.path} alt={photo.label} style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 12, background: 'var(--sunken)' }} />
          <button type="button" className="btn btn-secondary" onClick={() => setPhoto(null)}>{t('close')}</button>
        </Sheet>
      )}
      {sheet && (
        <Sheet title={sheet.approve ? (sheet.tier === 3 ? t('approveTier3') : t('approveTier2')) : t('reject')} onClose={() => setSheet(null)}>
          <div className="caption"><strong style={{ color: 'var(--text)' }}>{sheet.item.fullName}</strong> · <span className="num">{sheet.item.docNumber}</span></div>
          {!sheet.approve && (
            <div className="field">
              <label htmlFor="rr" className="label">{t('rejectReason')}</label>
              <div className="input-box"><textarea id="rr" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
            </div>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className={`btn ${sheet.approve ? 'btn-buy' : 'btn-sell'}`} disabled={busy || (!sheet.approve && !reason.trim())} onClick={decide}>{t('confirm')}</button>
        </Sheet>
      )}
    </div>
  )
}
