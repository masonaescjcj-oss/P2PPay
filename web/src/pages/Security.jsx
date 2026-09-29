import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Toast, TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { copyText, useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

function CodeInput({ id, value, onChange, label }) {
  return (
    <div className="field">
      <label htmlFor={id} className="label">{label}</label>
      <div className="input-box sm">
        <input id={id} dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontSize: 20, letterSpacing: 5, textAlign: 'center' }} />
      </div>
    </div>
  )
}

export function PhoneSection({ sec, onChange }) {
  const { t, errText } = usePrefs()
  const [phone, setPhone] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (sec?.phoneVerified) {
    return (
      <div className="row" style={{ gap: 10 }}>
        <span className="icon-tile green" style={{ width: 36, height: 36 }}><Icon name="check" size={18} stroke={2.4} /></span>
        <span className="strong">{t('phoneVerifiedAs', { p: '' })}<span className="num">{sec.phone}</span></span>
      </div>
    )
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="caption" style={{ lineHeight: 1.8 }}>{t('phoneNotVerified')}</p>
      <div className="input-box sm" dir="ltr">
        <label htmlFor="ph" className="sr-only">{t('phone')}</label>
        <input id="ph" type="tel" inputMode="tel" autoComplete="tel" placeholder="07X XXX XXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="button" className="btn btn-secondary btn-sm" style={{ height: 40 }} disabled={busy || !phone.trim()} onClick={() => run(async () => setSentTo((await api.post('/me/phone', { phone })).phone))}>
          {sentTo ? t('resend') : t('sendCode')}
        </button>
      </div>
      {sentTo && (
        <>
          <span className="caption">{t('codeSentTo', { p: '' })}<span className="num">{sentTo}</span></span>
          <CodeInput id="phc" value={code} onChange={setCode} label={t('smsCode')} />
          <button type="button" className="btn btn-primary" disabled={busy || code.trim().length !== 6} onClick={() => run(async () => { await api.post('/me/phone/verify', { code }); onChange() })}>
            {t('verify')}
          </button>
        </>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  )
}

function TotpSection({ sec, onChange }) {
  const { t, errText } = usePrefs()
  const [setup, setSetup] = useState(null)
  const [qr, setQr] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [disabling, setDisabling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!setup) return
    QRCode.toDataURL(setup.uri, { margin: 1, width: 360, color: { dark: '#080C1C', light: '#F5EFE2' } }).then(setQr, () => setQr(null))
  }, [setup])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (codes) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <strong>{t('backupCodesTitle')}</strong>
        <div className="note gold"><Icon name="alert" size={18} /><span>{t('backupCodesNote')}</span></div>
        <div className="grid-2" style={{ gap: 8 }}>
          {codes.map((c) => <span key={c} className="mono" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--sunken)', fontSize: 14, textAlign: 'center' }}>{c}</span>)}
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => copyText(codes.join('\n'))}><Icon name="copy" size={18} />{t('copy')}</button>
        <button type="button" className="btn btn-primary" onClick={() => { setCodes(null); onChange() }}>{t('done')}</button>
      </div>
    )
  }

  if (sec?.totpEnabled) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="icon-tile green" style={{ width: 36, height: 36 }}><Icon name="shieldCheck" size={18} /></span>
          <span className="strong">{t('totpOn')}</span>
        </div>
        <span className="caption">{t('backupLeft', { n: sec.backupCodesLeft })}</span>
        {disabling ? (
          <>
            <CodeInput id="tdc" value={code} onChange={setCode} label={t('authenticatorCode')} />
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm grow" disabled={busy || !code.trim()} onClick={() => run(async () => setCodes((await api.post('/me/totp/backup-codes', { code })).backupCodes))}>{t('newBackupCodes')}</button>
              <button type="button" className="btn btn-danger btn-sm grow" disabled={busy || !code.trim()} onClick={() => run(async () => { await api.post('/me/totp/disable', { code }); setDisabling(false); setCode(''); onChange() })}>{t('disableTotp')}</button>
            </div>
          </>
        ) : (
          <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => setDisabling(true)}>{t('newBackupCodes')} / {t('disableTotp')}</button>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    )
  }

  if (setup) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <span className="label">{t('scanQr')}</span>
        <div style={{ alignSelf: 'center', width: 190, height: 190, borderRadius: 18, background: '#F5EFE2', padding: 8 }}>
          {qr && <img src={qr} alt="2FA QR" style={{ width: '100%', height: '100%' }} />}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="mono grow" style={{ fontSize: 13 }}>{setup.secret}</span>
          <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label={t('copy')} onClick={() => copyText(setup.secret)}><Icon name="copy" size={16} /></button>
        </div>
        <CodeInput id="tec" value={code} onChange={setCode} label={t('enterAppCode')} />
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="button" className="btn btn-primary" disabled={busy || code.trim().length !== 6} onClick={() => run(async () => { setCodes((await api.post('/me/totp/enable', { code })).backupCodes); setSetup(null); setCode('') })}>{t('verify')}</button>
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="caption" style={{ lineHeight: 1.8 }}>{t('totpOff')}</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => setSetup(await api.post('/me/totp/setup')))}>
        <Icon name="shieldCheck" size={18} />
        {t('enableTotp')}
      </button>
    </div>
  )
}

function PasswordSection({ onDone }) {
  const { t, errText } = usePrefs()
  const [f, setF] = useState({ current: '', next: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/me/password', f)
      setF({ current: '', next: '' })
      onDone()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
      <input type="text" autoComplete="username" hidden readOnly />
      <div className="field">
        <label htmlFor="cp" className="label">{t('currentPassword')}</label>
        <div className="input-box sm"><input id="cp" type="password" dir="ltr" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></div>
      </div>
      <div className="field">
        <label htmlFor="np" className="label">{t('newPassword')}</label>
        <div className="input-box sm"><input id="np" type="password" dir="ltr" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></div>
        <span className="hint">{t('passwordHint')}</span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="submit" className="btn btn-secondary" disabled={busy || !f.current || f.next.length < 8}>{t('save')}</button>
    </form>
  )
}

export default function Security() {
  const { t } = usePrefs()
  const { refresh } = useAuth()
  const sec = useApi('/me/security')
  const [toast, showToast] = useToast()
  const reload = () => {
    sec.reload()
    refresh()
  }
  return (
    <main className="page">
      <TopBar title={t('securityTitle')} back="/profile" />
      <section className="card stack" style={{ gap: 12 }}>
        <h2 className="h2 row" style={{ gap: 8 }}><Icon name="phone" size={18} />{t('phoneSection')}</h2>
        <PhoneSection sec={sec.data} onChange={reload} />
      </section>
      <section className="card stack" style={{ gap: 12 }}>
        <h2 className="h2 row" style={{ gap: 8 }}><Icon name="shieldCheck" size={18} />{t('authenticatorSection')}</h2>
        <TotpSection sec={sec.data} onChange={reload} />
      </section>
      <section className="card stack" style={{ gap: 12 }}>
        <h2 className="h2 row" style={{ gap: 8 }}><Icon name="lock" size={18} />{t('passwordSection')}</h2>
        <PasswordSection onDone={() => { showToast(t('passwordChanged')); sec.reload() }} />
      </section>
      {sec.data?.events?.length > 0 && (
        <section className="stack" style={{ gap: 0 }}>
          <h2 className="h2" style={{ paddingBottom: 6 }}>{t('recentSecurity')}</h2>
          {sec.data.events.map((e, i) => (
            <div key={i} className="list-row" style={{ minHeight: 52 }}>
              <span className={`icon-tile ${/failed/.test(e.kind) ? 'coral' : 'neutral'}`} style={{ width: 34, height: 34 }}><Icon name={/failed/.test(e.kind) ? 'alert' : 'shield'} size={16} /></span>
              <div className="grow stack" style={{ gap: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t(`ev_${e.kind}`)}</span>
                <span className="caption num" style={{ textAlign: 'start' }}>{new Date(e.createdAt).toISOString().slice(0, 16).replace('T', ' ')} · {e.ip || '—'}</span>
              </div>
            </div>
          ))}
        </section>
      )}
      <Toast msg={toast} />
    </main>
  )
}
