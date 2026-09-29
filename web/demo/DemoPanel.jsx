import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../src/components/Icon.jsx'
import Sheet from '../src/components/Sheet.jsx'
import { api } from '../src/lib/api.js'
import { useAuth } from '../src/lib/auth.jsx'
import { copyText } from '../src/lib/hooks.js'
import { usePrefs } from '../src/lib/prefs.jsx'
import { BRAND } from '../src/lib/brand.js'
import { ADMIN, inbox, resetAll, topUp } from './server.js'

const TEXT = {
  fa: {
    badge: 'نسخهٔ آزمایشی',
    title: `نسخهٔ آزمایشی ${BRAND}`,
    intro: 'این نسخه کامل در مرورگر شما اجرا می‌شود: همان کد سرور، با پایگاه‌دادهٔ Postgres داخل مرورگر. تتر و پیامک‌ها آزمایشی‌اند و داده‌ها فقط در همین مرورگر می‌مانند.',
    topUp: '۵۰۰ تتر آزمایشی به کیف پولم',
    topUpDone: '۵۰۰ تتر آزمایشی واریز شد',
    loginFirst: 'برای شارژ آزمایشی اول ثبت‌نام کنید یا وارد شوید.',
    sms: 'پیامک‌های آزمایشی',
    noSms: 'هنوز پیامکی فرستاده نشده. کد تأیید موبایل و برداشت اینجا نمایش داده می‌شود.',
    smsTo: 'به {to}',
    traders: 'معامله‌گران نمونه',
    tradersText: 'کریم و احمد تتر می‌فروشند و زهرا می‌خرد. چند ثانیه بعد از هر مرحلهٔ شما، خودکار جواب می‌دهند: پرداخت می‌کنند یا تتر را آزاد می‌کنند.',
    admin: 'پنل مدیریت',
    adminText: 'برای تأیید برداشت، بررسی مدارک، داوری و صفحهٔ بتا با این حساب وارد شوید:',
    asAdmin: 'ورود به‌عنوان مدیر',
    username: 'نام کاربری',
    password: 'رمز',
    reset: 'پاک کردن همه و شروع دوباره',
    resetSure: 'همهٔ حساب‌ها، معاملات و موجودی‌های آزمایشی پاک می‌شوند.',
    resetYes: 'بله، پاک کن',
    cancel: 'انصراف',
    copied: 'کپی شد',
    smsToast: 'پیامک آزمایشی — کد: {code}',
  },
  en: {
    badge: 'Test version',
    title: `${BRAND} test version`,
    intro: 'This version runs entirely in your browser: the same server code, with a Postgres database inside the browser. USDT and SMS are test-only, and the data stays in this browser.',
    topUp: 'Add 500 test USDT to my wallet',
    topUpDone: '500 test USDT deposited',
    loginFirst: 'Sign up or log in first to add test USDT.',
    sms: 'Test SMS',
    noSms: 'No SMS sent yet. Phone and withdrawal codes appear here.',
    smsTo: 'to {to}',
    traders: 'Sample traders',
    tradersText: 'Karim and Ahmad sell USDT and Zahra buys. A few seconds after each of your steps they answer on their own: they pay or release the USDT.',
    admin: 'Admin panel',
    adminText: 'Sign in with this account to approve withdrawals, review documents, resolve disputes and see the Beta page:',
    asAdmin: 'Sign in as admin',
    username: 'Username',
    password: 'Password',
    reset: 'Erase everything and start over',
    resetSure: 'All test accounts, trades and balances will be erased.',
    resetYes: 'Yes, erase',
    cancel: 'Cancel',
    copied: 'Copied',
    smsToast: 'Test SMS — code: {code}',
  },
}

export default function DemoPanel() {
  const { lang } = usePrefs()
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const tx = (k, v) => Object.entries(v || {}).reduce((s, [a, b]) => s.replaceAll(`{${a}}`, b), TEXT[lang]?.[k] ?? TEXT.en[k])
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [, bump] = useState(0)

  useEffect(() => {
    let timer
    const onSms = (e) => {
      bump((n) => n + 1)
      if (e.detail.code) {
        setToast(e.detail.code)
        clearTimeout(timer)
        timer = setTimeout(() => setToast(null), 8000)
      }
    }
    window.addEventListener('demo-sms', onSms)
    return () => {
      window.removeEventListener('demo-sms', onSms)
      clearTimeout(timer)
    }
  }, [])

  const copy = async (text) => setNote((await copyText(text)) ? tx('copied') : text)

  async function addFunds() {
    setNote(null)
    try {
      await topUp('500')
      setNote(tx('topUpDone'))
      setOpen(false)
      navigate('/wallet')
    } catch {
      setNote(tx('loginFirst'))
    }
  }

  async function loginAdmin() {
    try {
      await api.post('/auth/logout')
    } catch {
      // not signed in
    }
    await api.post('/auth/login', ADMIN)
    await refresh()
    setOpen(false)
    navigate('/admin')
  }

  async function reset() {
    await resetAll()
    location.reload()
  }

  return (
    <>
      <button type="button" className="demo-fab" hidden={open} onClick={() => { setNote(null); setConfirmReset(false); setOpen(true) }}>
        <span className="demo-dot" aria-hidden="true" />
        {tx('badge')}
      </button>

      {toast && (
        <button type="button" className="demo-sms" onClick={() => { copy(toast); setToast(null) }}>
          <Icon name="phone" size={18} />
          <span className="num">{tx('smsToast', { code: toast })}</span>
        </button>
      )}

      {open && (
        <Sheet title={tx('title')} onClose={() => setOpen(false)}>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>{tx('intro')}</p>

          <button type="button" className="btn btn-primary" onClick={addFunds} disabled={!user}>
            <Icon name="down" size={18} stroke={2} />
            {tx('topUp')}
          </button>
          {!user && <span className="hint">{tx('loginFirst')}</span>}
          {note && <p className="caption" role="status">{note}</p>}

          <section className="stack" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{tx('sms')}</strong>
            {inbox.length === 0 ? (
              <span className="caption">{tx('noSms')}</span>
            ) : (
              inbox.slice(0, 4).map((m) => (
                <div key={m.at} className="card tight between" style={{ background: 'var(--sunken)' }}>
                  <span className="stack" style={{ gap: 2 }}>
                    <span className="caption num" dir="ltr" style={{ textAlign: 'start' }}>{tx('smsTo', { to: m.to })}</span>
                    <span className="mono num" style={{ fontSize: 20, letterSpacing: 3 }}>{m.code || '—'}</span>
                  </span>
                  {m.code && <button type="button" className="icon-btn" aria-label={tx('copied')} onClick={() => copy(m.code)}><Icon name="copy" size={18} /></button>}
                </div>
              ))
            )}
          </section>

          <section className="stack" style={{ gap: 6 }}>
            <strong style={{ fontSize: 14 }}>{tx('traders')}</strong>
            <span className="caption" style={{ lineHeight: 1.8 }}>{tx('tradersText')}</span>
          </section>

          <section className="stack" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{tx('admin')}</strong>
            <span className="caption" style={{ lineHeight: 1.8 }}>{tx('adminText')}</span>
            <div className="card tight" style={{ background: 'var(--sunken)' }}>
              <div className="kv"><span>{tx('username')}</span><button type="button" className="mono btn-link" dir="ltr" onClick={() => copy(ADMIN.username)}>{ADMIN.username}</button></div>
              <div className="kv"><span>{tx('password')}</span><button type="button" className="mono btn-link" dir="ltr" onClick={() => copy(ADMIN.password)}>{ADMIN.password}</button></div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={loginAdmin}>
              <Icon name="settings" size={18} />
              {tx('asAdmin')}
            </button>
          </section>

          {confirmReset ? (
            <div className="note coral" style={{ flexDirection: 'column', gap: 10 }}>
              <span>{tx('resetSure')}</span>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-danger btn-sm grow" onClick={reset}>{tx('resetYes')}</button>
                <button type="button" className="btn btn-secondary btn-sm grow" onClick={() => setConfirmReset(false)}>{tx('cancel')}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-link" style={{ color: 'var(--coral-text)' }} onClick={() => setConfirmReset(true)}>{tx('reset')}</button>
          )}
        </Sheet>
      )}
    </>
  )
}
