import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useAuth } from '../lib/auth.jsx'
import { usePrefs } from '../lib/prefs.jsx'

export default function Auth({ mode }) {
  const { t, errText } = usePrefs()
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: '', password: '', displayName: '', phone: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isLogin = mode === 'login'

  if (user) return <Navigate to={location.state?.from || '/'} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isLogin) await login(form.username.trim(), form.password)
      else
        await register({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim() || undefined,
          phone: form.phone.trim() ? `+93${form.phone.replace(/\D/g, '').replace(/^0/, '')}` : undefined,
        })
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
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
            <div className="field">
              <label htmlFor="phone" className="label">{t('phone')}</label>
              <div className="input-box" dir="ltr">
                <span className="unit">+93</span>
                <input id="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="70 123 4567" value={form.phone} onChange={set('phone')} />
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
