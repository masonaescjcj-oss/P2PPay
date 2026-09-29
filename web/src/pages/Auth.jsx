import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useAuth } from '../lib/auth.jsx'
import { usePrefs } from '../lib/prefs.jsx'

export default function Auth({ mode }) {
  const { t, errText } = usePrefs()
  const { user, config, login, loginSecondFactor, register } = useAuth()
  const [params] = useSearchParams()
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  // Invite links look like /register?invite=ABCD-EFGH
  const [form, setForm] = useState(() => ({ username: '', password: '', displayName: '', inviteCode: params.get('invite') || '' }))
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isLogin = mode === 'login'
  const inviteOnly = !!config?.beta?.inviteOnly

  // New accounts continue to verification; logins go back where they came from.
  if (user) return <Navigate to={isLogin ? location.state?.from || '/' : '/profile/verification'} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (challenge) {
        await loginSecondFactor(challenge, code.trim())
      } else if (isLogin) {
        const r = await login(form.username.trim(), form.password)
        if (r.challenge) {
          setChallenge(r.challenge)
          return
        }
      } else {
        await register({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim() || undefined,
          inviteCode: form.inviteCode.trim() || undefined,
        })
        navigate('/profile/verification', { replace: true })
        return
      }
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      if (err.code === 'challenge_expired') setChallenge(null)
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (challenge) {
    return (
      <main className="page" style={{ gap: 22 }}>
        <div className="between">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => { setChallenge(null); setCode(''); setError(null) }}>
            <Icon name="back" />
          </button>
        </div>
        <div className="stack">
          <span className="icon-tile green" style={{ width: 56, height: 56, borderRadius: 18 }}><Icon name="shieldCheck" size={28} /></span>
          <h1 className="display" style={{ fontSize: 26, lineHeight: 1.5 }}>{t('twoFactorTitle')}</h1>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.9 }}>{t('twoFactorSub')}</p>
        </div>
        <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
          <label htmlFor="code2fa" className="label">{t('code')}</label>
          <div className="input-box">
            <input id="code2fa" dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 6}>{t('verify')}</button>
        </form>
      </main>
    )
  }

  return (
    <main className="page" style={{ gap: 22 }}>
      <div className="between">
        <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => navigate('/welcome')}>
          <Icon name="back" />
        </button>
      </div>

      <div className="stack">
        <h1 className="display" style={{ fontSize: 28, lineHeight: 1.5 }}>{isLogin ? t('welcomeBack') : t('registerTitle')}</h1>
        <p className="muted" style={{ fontSize: 15 }}>{isLogin ? t('loginSub') : t('registerSub')}</p>
      </div>

      <div className="seg">
        <button type="button" aria-pressed={isLogin} onClick={() => navigate('/login', { replace: true, state: location.state })}>{t('login')}</button>
        <button type="button" aria-pressed={!isLogin} onClick={() => navigate('/register', { replace: true, state: location.state })}>{t('register')}</button>
      </div>

      <form className="stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
        {!isLogin && (inviteOnly || form.inviteCode) && (
          <div className="field">
            <label htmlFor="invite" className="label">{t('inviteCode')}</label>
            <div className="input-box">
              <input id="invite" dir="ltr" autoCapitalize="characters" autoComplete="off" placeholder="XXXX-XXXX" value={form.inviteCode} onChange={set('inviteCode')} style={{ letterSpacing: 2 }} />
            </div>
            <span className="hint">{t('inviteHint')}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="username" className="label">{t('username')}</label>
          <div className="input-box">
            <input id="username" dir="ltr" autoComplete="username" autoCapitalize="none" value={form.username} onChange={set('username')} required />
          </div>
          {!isLogin && <span className="hint">{t('usernameHint')}</span>}
        </div>

        {!isLogin && (
          <>
            <div className="field">
              <label htmlFor="displayName" className="label">{t('displayName')}</label>
              <div className="input-box">
                <input id="displayName" autoComplete="nickname" value={form.displayName} onChange={set('displayName')} maxLength={40} />
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="password" className="label">{t('password')}</label>
          <div className="input-box" style={{ paddingInlineEnd: 6 }}>
            <input
              id="password"
              type={show ? 'text' : 'password'}
              dir="ltr"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={set('password')}
              required
            />
            <button type="button" className="icon-btn plain" aria-label={t('showPassword')} aria-pressed={show} onClick={() => setShow(!show)}>
              <Icon name={show ? 'eyeOff' : 'eye'} />
            </button>
          </div>
          {!isLogin && <span className="hint">{t('passwordHint')}</span>}
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {isLogin ? t('login') : t('register')}
        </button>
      </form>

      <div className="stack push-end" style={{ gap: 14 }}>
        <div className="note green">
          <Icon name="lock" size={20} />
          <span>{t('secureNote')}</span>
        </div>
        <Link to="/market" className="btn-link" style={{ textAlign: 'center' }}>{t('browseMarket')}</Link>
      </div>
    </main>
  )
}
