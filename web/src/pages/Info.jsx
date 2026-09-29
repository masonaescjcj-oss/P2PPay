import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Faq, LegalText } from '../components/LegalContent.jsx'
import { Toast, TopBar } from '../components/Layout.jsx'
import { useAuth } from '../lib/auth.jsx'
import { copyText, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

// Public pages: terms, privacy, help (FAQ) and support. Reachable without an account.
export function LegalPage({ doc }) {
  const { t } = usePrefs()
  const { config } = useAuth()
  return (
    <main className="page">
      <TopBar title={t(doc === 'terms' ? 'termsTitle' : 'privacyTitle')} sub={config?.termsVersion ? t('termsVersionLabel', { v: config.termsVersion }) : undefined} />
      <LegalText doc={doc} />
    </main>
  )
}

export function HelpPage() {
  const { t } = usePrefs()
  return (
    <main className="page">
      <TopBar title={t('helpTitle')} />
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.9 }}>{t('helpSub')}</p>
      <Faq />
      <Link to="/support" className="btn btn-secondary"><Icon name="headset" size={18} />{t('stillNeedHelp')}</Link>
    </main>
  )
}

function Channel({ icon, label, value, dir = 'ltr' }) {
  const { t } = usePrefs()
  const [toast, showToast] = useToast()
  return (
    <div className="menu-row" style={{ cursor: 'default' }}>
      <span className="icon-tile blue" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name={icon} size={18} /></span>
      <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="caption">{label}</span>
        <span className="strong" dir={dir} style={{ textAlign: 'start', userSelect: 'all', overflowWrap: 'anywhere' }}>{value}</span>
      </span>
      <button type="button" className="icon-btn" aria-label={t('copy')} onClick={async () => showToast((await copyText(value)) ? t('copied') : value)}>
        <Icon name="copy" size={18} />
      </button>
      <Toast msg={toast} />
    </div>
  )
}

export function SupportPage() {
  const { t } = usePrefs()
  const { user, config } = useAuth()
  const navigate = useNavigate()
  const s = config?.support || {}
  return (
    <main className="page">
      <TopBar title={t('supportTitle')} />
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.9 }}>{t('supportSub')}</p>

      <button type="button" className="btn btn-primary" onClick={() => navigate(user ? '/profile/feedback' : '/login', { state: user ? { from: '/support', kind: 'question' } : { from: '/profile/feedback' } })}>
        <Icon name="chat" size={18} />
        {t('supportMessage')}
      </button>
      <p className="caption" style={{ lineHeight: 1.8 }}>{t('supportTradeHint')}</p>

      {(s.email || s.phone || s.telegram) && (
        <section className="card flush">
          {s.phone && <Channel icon="phone" label={t('supportPhone')} value={s.phone} />}
          {s.telegram && <Channel icon="send" label="Telegram" value={s.telegram} />}
          {s.email && <Channel icon="chat" label={t('supportEmail')} value={s.email} />}
        </section>
      )}
      {s.hours && (
        <div className="note blue"><Icon name="clock" size={18} /><span>{t('supportHours')}: {s.hours}</span></div>
      )}

      <div className="note gold">
        <Icon name="shieldCheck" size={20} />
        <span>{t('supportSafety')}</span>
      </div>
      <Link to="/help" className="btn-link" style={{ textAlign: 'center' }}>{t('helpTitle')}</Link>
    </main>
  )
}
