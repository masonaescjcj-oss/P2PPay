import { Link, Navigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { StarMark, Wordmark } from '../components/Brand.jsx'
import { useAuth } from '../lib/auth.jsx'
import { usePrefs } from '../lib/prefs.jsx'

function Hero() {
  return (
    <svg viewBox="0 0 342 320" width="100%" style={{ maxWidth: 342, maxHeight: 320 }} aria-hidden="true">
      <circle cx="171" cy="160" r="150" fill="none" stroke="var(--line-strong)" strokeDasharray="2 6" />
      <circle cx="171" cy="160" r="112" fill="none" stroke="var(--line)" />
      <g stroke="var(--gold-text)" fill="none" strokeWidth="1.2" opacity="0.55">
        <rect x="71" y="60" width="200" height="200" />
        <rect x="71" y="60" width="200" height="200" transform="rotate(45 171 160)" />
      </g>
      <g stroke="var(--gold-text)" fill="none" opacity="0.25">
        <rect x="111" y="100" width="120" height="120" />
        <rect x="111" y="100" width="120" height="120" transform="rotate(45 171 160)" />
      </g>
      <g fill="none" stroke="var(--text)" strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M150 104c28-14 58-6 74 18M218 116l7 7 2-10" />
        <path d="M192 216c-28 14-58 6-74-18M124 204l-7-7-2 10" />
      </g>
      <circle cx="122" cy="136" r="46" fill="var(--tether)" stroke="var(--bg)" strokeWidth="4" />
      <g transform="translate(96 110) scale(1.62)">
        <rect x="8" y="8" width="16" height="3.6" rx="1" fill="#fff" />
        <rect x="14" y="8" width="4" height="17" rx="1" fill="#fff" />
        <ellipse cx="16" cy="15.6" rx="8.5" ry="2.6" fill="none" stroke="#fff" strokeWidth="1.8" />
      </g>
      <circle cx="220" cy="184" r="46" fill="var(--gold)" stroke="var(--bg)" strokeWidth="4" />
      <text x="220" y="202" textAnchor="middle" fontFamily="Vazirmatn, sans-serif" fontSize="50" fontWeight="800" fill="#1B1405">؋</text>
      <circle cx="171" cy="10" r="3" fill="var(--gold)" />
      <circle cx="321" cy="160" r="3" fill="var(--blue-text)" />
      <circle cx="21" cy="160" r="3" fill="var(--green)" />
    </svg>
  )
}

export default function Welcome() {
  const { t, lang, setLang } = usePrefs()
  const { user } = useAuth()
  if (user) return <Navigate to="/" replace />
  return (
    <main className="page" style={{ gap: 20, paddingTop: 28 }}>
      <div className="between">
        <div className="row">
          <StarMark />
          <Wordmark />
        </div>
        <button type="button" className="chip" aria-label={t('language')} onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}>
          <Icon name="globe" size={16} />
          {lang === 'fa' ? 'English' : 'دری'}
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Hero />
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <h1 className="display" style={{ fontSize: 30, lineHeight: 1.5 }}>
          {t('welcomeTitle')}
          <br />
          <span className="t-gold">{t('brandTagline')}</span>
        </h1>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.9 }}>{t('welcomeSub')}</p>
      </div>

      <div className="stack push-end" style={{ gap: 12 }}>
        <Link to="/register" className="btn btn-primary">
          {t('createAccount')}
          <Icon name="forward" size={18} stroke={2.2} />
        </Link>
        <Link to="/login" className="btn btn-secondary">{t('haveAccount')}</Link>
        <Link to="/market" className="btn-link" style={{ textAlign: 'center' }}>{t('browseMarket')}</Link>
        <div className="row caption" style={{ justifyContent: 'center' }}>
          <Icon name="shieldCheck" size={15} className="t-green" />
          HesabPay · M-Paisa · M-Hawala · {lang === 'fa' ? 'بانک · حواله' : 'Bank · Hawala'}
        </div>
      </div>
    </main>
  )
}
