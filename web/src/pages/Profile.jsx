import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { TabBar } from '../components/Layout.jsx'
import { useAuth } from '../lib/auth.jsx'
import { initial } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { useState } from 'react'
import Sheet from '../components/Sheet.jsx'
import { useInstall } from '../lib/install.js'
import { usePrefs } from '../lib/prefs.jsx'

function Row({ icon, tone = 'neutral', label, value, to, onClick, children }) {
  const inner = (
    <>
      <span className={`icon-tile ${tone}`} style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name={icon} size={18} /></span>
      <span className="grow">{label}</span>
      {value && <span className="caption">{value}</span>}
      {children}
      {(to || onClick) && !children && <Icon name="forward" size={16} stroke={2} style={{ color: 'var(--placeholder)' }} />}
    </>
  )
  if (to) return <Link to={to} className="menu-row">{inner}</Link>
  if (onClick) return <button type="button" className="menu-row" onClick={onClick}>{inner}</button>
  return <div className="menu-row" style={{ cursor: 'default' }}>{inner}</div>
}

export default function Profile() {
  const { t, pm, lang, setLang, theme, setTheme } = usePrefs()
  const { user, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const accounts = useApi('/payment-accounts')
  const me = useApi('/me')
  const stats = me.data || user
  const install = useInstall()
  const [iosHelp, setIosHelp] = useState(false)

  return (
    <>
      <main className="page with-tabs">
        <div className="stack" style={{ alignItems: 'center', gap: 6, paddingTop: 8 }}>
          <div className="avatar gold" style={{ width: 84, height: 84, fontSize: 32 }}>{initial(user.displayName)}</div>
          <div className="stack" style={{ alignItems: 'center', gap: 2, marginTop: 6 }}>
            <strong style={{ fontSize: 22, fontWeight: 800 }}>{user.displayName}</strong>
            <span dir="ltr" className="caption">@{user.username}</span>
            {(user.kycTier ?? 0) >= 2 && (
              <span className="pill green" style={{ height: 24, marginTop: 4 }}><Icon name="check" size={12} stroke={2.4} />{t('verified')}</span>
            )}
          </div>
        </div>

        <div className="grid-3" style={{ gap: 8 }}>
          <div className="stat card" style={{ padding: 12 }}><span>{t('memberTrades')}</span><span className="num" style={{ fontSize: 18 }}>{stats.completed ?? 0}</span></div>
          <div className="stat card" style={{ padding: 12 }}><span>{t('completionRate')}</span><span className="num t-green" style={{ fontSize: 18 }}>{stats.completionRate ?? '—'}{stats.completionRate != null ? '%' : ''}</span></div>
          <div className="stat card" style={{ padding: 12 }}><span>{t('myPaymentAccounts')}</span><span className="num" style={{ fontSize: 18 }}>{accounts.data?.length ?? 0}</span></div>
        </div>

        {user.perms?.length > 0 && (
          <Link to="/admin" className="btn btn-secondary" style={{ color: 'var(--gold-text)' }}>
            <Icon name="settings" size={18} />
            {t('adminPanel')}
          </Link>
        )}

        <section className="card flush">
          <Row icon="user" tone="green" label={t('verificationTitle')} value={`${t('tier', { n: user.kycTier ?? 0 })} · ${t(`tierName${user.kycTier ?? 0}`)}`} to="/profile/verification" />
          <Row icon="grid" tone="gold" label={t('myOffers')} to="/orders?tab=offers" />
          <Row icon="card" tone="blue" label={t('myPaymentAccounts')} value={accounts.data?.map((a) => pm(a.method)).join('، ')} to="/profile/accounts" />
        </section>

        <section className="card flush">
          <Row icon="moon" label={t('appearance')}>
            <span className="seg sm">
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t('dark')}</button>
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t('light')}</button>
            </span>
          </Row>
          <Row icon="globe" label={t('language')}>
            <span className="seg sm">
              <button type="button" aria-pressed={lang === 'fa'} onClick={() => setLang('fa')}>دری</button>
              <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
            </span>
          </Row>
          <Row icon="shieldCheck" tone="green" label={t('securityTitle')} value={user.totpEnabled ? '2FA ✓' : undefined} to="/profile/security" />
          <Row icon="x" tone="coral" label={t('blockedUsers')} to="/profile/blocked" />
          <Row icon="chat" tone="blue" label={t('feedbackTitle')} to="/profile/feedback" />
          {!install.installed && (install.canPrompt || install.ios) && (
            <Row icon="phone" tone="gold" label={t('installApp')} onClick={() => (install.canPrompt ? install.prompt() : setIosHelp(true))} />
          )}
        </section>

        <section className="card flush">
          <Row icon="search" label={t('helpTitle')} to="/help" />
          <Row icon="headset" label={t('supportTitle')} to="/support" />
          <Row icon="receipt" label={t('termsTitle')} to="/terms" />
          <Row icon="lock" label={t('privacyTitle')} to="/privacy" />
        </section>

        {iosHelp && (
          <Sheet title={t('installApp')} onClose={() => setIosHelp(false)}>
            <ol className="howto">
              <li>{t('iosStep1')}</li>
              <li>{t('iosStep2')}</li>
              <li>{t('iosStep3')}</li>
            </ol>
            <button type="button" className="btn btn-primary" onClick={() => setIosHelp(false)}>{t('done')}</button>
          </Sheet>
        )}

        <button
          type="button"
          className="btn btn-danger"
          style={{ height: 52 }}
          onClick={async () => {
            await logout()
            await refresh()
            navigate('/welcome', { replace: true })
          }}
        >
          <Icon name="logout" size={18} />
          {t('logout')}
        </button>
      </main>
      <TabBar />
    </>
  )
}
