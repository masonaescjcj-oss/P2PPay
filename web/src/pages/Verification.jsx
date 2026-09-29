import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Loading, TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { toNum, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { toUploadJpeg } from '../lib/image.js'
import { usePrefs } from '../lib/prefs.jsx'
import { PhoneSection } from './Security.jsx'

function Meter({ used, limit }) {
  const pct = toNum(limit) > 0 ? Math.min(100, (toNum(used) / toNum(limit)) * 100) : 0
  return (
    <div className="meter" style={{ background: 'var(--surface-2)' }} role="img" aria-label={`${pct.toFixed(0)}%`}>
      <span style={{ width: `${pct}%`, background: pct > 85 ? 'var(--coral)' : 'var(--gold)' }} />
    </div>
  )
}

function PhotoPicker({ label, kind, uploaded, onPick, capture }) {
  const { t } = usePrefs()
  const [preview, setPreview] = useState(null)
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])
  return (
    <label className="card row" style={{ gap: 12, cursor: 'pointer', padding: 12, borderStyle: uploaded ? 'solid' : 'dashed', borderColor: uploaded ? 'var(--green-tint-line)' : undefined }}>
      <span style={{ width: 64, height: 48, borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={kind === 'selfie' ? 'user' : 'card'} size={22} />}
      </span>
      <span className="grow stack" style={{ gap: 2 }}>
        <strong style={{ fontSize: 14 }}>{label}</strong>
        <span className={`caption ${uploaded ? 't-green' : ''}`}>{uploaded ? t('uploaded') : t('choosePhoto')}</span>
      </span>
      {uploaded && <Icon name="check" size={18} stroke={2.4} className="t-green" />}
      <input
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setPreview(URL.createObjectURL(f))
          onPick(kind, f)
        }}
      />
    </label>
  )
}

function IdentityForm({ kyc, onChange }) {
  const { t, errText } = usePrefs()
  const sub = kyc.submission
  const editable = !sub || sub.status === 'draft' || sub.status === 'rejected'
  const [f, setF] = useState({ docType: sub?.docType || 'tazkira', fullName: sub?.fullName || '', docNumber: sub?.docNumber || '' })
  const [draft, setDraft] = useState(sub?.status === 'draft' ? sub : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const has = (k) => draft?.files?.some((x) => x.kind === k)

  const ensureDraft = async () => {
    const d = await api.post('/kyc/submission', f)
    setDraft(d)
    return d
  }

  async function pick(kind, file) {
    setBusy(true)
    setError(null)
    try {
      const d = draft && draft.status === 'draft' ? draft : await ensureDraft()
      const blob = await toUploadJpeg(file)
      setDraft(await api.upload(`/kyc/submission/${d.id}/files/${kind}`, blob))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const d = await ensureDraft() // saves the latest name/number
      await api.post(`/kyc/submission/${d.id}/submit`)
      onChange()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (sub?.status === 'pending') return <div className="note gold"><Icon name="clock" size={18} /><span>{t('kycPendingNote')}</span></div>
  if (sub?.status === 'approved' && kyc.tier >= 2) return <div className="note green"><Icon name="shieldCheck" size={18} /><span>{t('kycApprovedNote')}</span></div>
  if (!editable) return null

  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
      {sub?.status === 'rejected' && <div className="note coral"><Icon name="alert" size={18} /><span>{t('kycRejectedNote', { r: sub.reason || '' })}</span></div>}
      <div className="seg">
        <button type="button" aria-pressed={f.docType === 'tazkira'} onClick={() => setF({ ...f, docType: 'tazkira' })}>{t('tazkira')}</button>
        <button type="button" aria-pressed={f.docType === 'passport'} onClick={() => setF({ ...f, docType: 'passport' })}>{t('passport')}</button>
      </div>
      <div className="field">
        <label htmlFor="fn" className="label">{t('fullName')}</label>
        <div className="input-box sm"><input id="fn" autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} maxLength={100} /></div>
      </div>
      <div className="field">
        <label htmlFor="dn" className="label">{t('docNumber')}</label>
        <div className="input-box sm"><input id="dn" dir="ltr" value={f.docNumber} onChange={(e) => setF({ ...f, docNumber: e.target.value })} maxLength={40} /></div>
      </div>
      <PhotoPicker label={t('frontPhoto')} kind="front" uploaded={has('front')} onPick={pick} capture="environment" />
      <PhotoPicker label={t('backPhoto')} kind="back" uploaded={has('back')} onPick={pick} capture="environment" />
      <PhotoPicker label={t('selfiePhoto')} kind="selfie" uploaded={has('selfie')} onPick={pick} capture="user" />
      <div className="note green"><Icon name="lock" size={18} /><span>{t('kycPrivacy')}</span></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !has('front') || !has('selfie') || f.fullName.trim().length < 3 || f.docNumber.trim().length < 4}>
        {t('submitForReview')}
      </button>
    </form>
  )
}

export default function Verification() {
  const { t } = usePrefs()
  const { refresh } = useAuth()
  const kyc = useApi('/kyc')
  const sec = useApi('/me/security')
  const reload = () => {
    kyc.reload()
    sec.reload()
    refresh()
  }
  const k = kyc.data
  if (!k) return <main className="page"><TopBar title={t('verificationTitle')} back="/profile" /><Loading /></main>

  return (
    <main className="page">
      <TopBar title={t('verificationTitle')} back="/profile" />

      <section className="balance-card" style={{ gap: 12 }}>
        <div className="between">
          <span className="sub">{t('tier', { n: k.tier })}</span>
          <span className="pair" style={{ paddingInline: 10 }}>{t(`tierName${k.tier}`)}</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="between" style={{ fontSize: 13 }}><span className="sub">{t('dailyTrade')}</span><span className="num strong">{usdt(k.limits.trade)} USDT</span></div>
          <Meter used={k.used.trade} limit={k.limits.trade} />
          <span className="sub" style={{ fontSize: 11.5 }}>{t('usedToday', { u: usdt(k.used.trade), l: usdt(k.limits.trade) })}</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="between" style={{ fontSize: 13 }}><span className="sub">{t('dailyWithdraw')}</span><span className="num strong">{usdt(k.limits.withdraw)} USDT</span></div>
          <Meter used={k.used.withdraw} limit={k.limits.withdraw} />
        </div>
      </section>

      <section className="card flush">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="menu-row" style={{ cursor: 'default', minHeight: 64 }}>
            <span className={`icon-tile ${k.tier >= n ? 'green' : 'neutral'}`} style={{ width: 36, height: 36, borderRadius: 11 }}>
              {k.tier >= n ? <Icon name="check" size={18} stroke={2.4} /> : <span className="num strong">{n}</span>}
            </span>
            <div className="grow stack" style={{ gap: 2 }}>
              <strong style={{ fontSize: 14 }}>{t('tier', { n })} · {t(`tierName${n}`)}</strong>
              <span className="caption">{t(`tierReq${n}`)}</span>
            </div>
            <span className="caption num" style={{ textAlign: 'end' }}>{usdt(k.tiers[n].trade)}</span>
          </div>
        ))}
      </section>

      {k.tier < 1 && (
        <section className="card stack" style={{ gap: 12 }}>
          <h2 className="h2">{t('verifyPhoneCta')}</h2>
          <PhoneSection sec={sec.data} onChange={reload} />
        </section>
      )}

      {k.tier >= 1 && (
        <section className="card stack" style={{ gap: 12 }}>
          <h2 className="h2">{t('identitySection')}</h2>
          <IdentityForm kyc={k} onChange={reload} />
        </section>
      )}
    </main>
  )
}
