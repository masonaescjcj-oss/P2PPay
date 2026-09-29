import { Link, Navigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { StarMark, TetherMark, Wordmark } from '../components/Brand.jsx'
import { rate } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { useAuth } from '../lib/auth.jsx'
import { usePrefs } from '../lib/prefs.jsx'

// Gradient panel with the two currencies and a live best price, in the style of the balance panel.
function Hero({ price }) {
  const { t } = usePrefs()
  return (
    <div className="welcome-hero" aria-hidden="true">
      <div className="coins">
        <span className="coin tether"><TetherMark size={64} /></span>
        <span className="swap"><Icon name="swap" size={22} stroke={2.2} /></span>
        <span className="coin afn">؋</span>
      </div>
      <div className="rate">
        <span className="caption">{t('bestBuy')}</span>
        <span className="num">1 USDT ≈ {price ? rate(price) : '—'} ؋</span>
      </div>
    </div>
  )
}

export default function Welcome() {
  const { t, lang, setLang } = usePrefs()
  const { user } = useAuth()
  const offers = useApi('/offers?side=buy')
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

      <Hero price={offers.data?.[0]?.price} />

      <div className="stack" style={{ gap: 12 }}>
        <h1 className="display" style={{ fontSize: 30, lineHeight: 1.5 }}>
          {t('welcomeTitle')}
          <br />
          <span className="accent-text">{t('brandTagline')}</span>
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
        <nav className="row caption footer-links" aria-label={t('helpTitle')}>
          <Link to="/help">{t('helpTitle')}</Link>
          <Link to="/terms">{t('termsTitle')}</Link>
          <Link to="/privacy">{t('privacyTitle')}</Link>
          <Link to="/support">{t('supportTitle')}</Link>
        </nav>
      </div>
    </main>
  )
}
