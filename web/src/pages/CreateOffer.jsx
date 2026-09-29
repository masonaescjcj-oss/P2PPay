import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { afn, rate, toNum, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

const WINDOWS = [15, 30, 45, 60]
const num = (s) => s.replace(/[,٬\s]/g, '')

export default function CreateOffer() {
  const { t, pm, errText } = usePrefs()
  const { config } = useAuth()
  const navigate = useNavigate()
  const wallet = useApi('/wallet')
  const accounts = useApi('/payment-accounts')
  const [side, setSide] = useState('sell')
  const best = useApi(`/offers?side=${side === 'sell' ? 'buy' : 'sell'}`)
  const [f, setF] = useState({ price: '', total: '', minFiat: '', maxFiat: '', terms: '' })
  const [methods, setMethods] = useState([])
  const [payWindow, setPayWindow] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const toggle = (m) => setMethods(methods.includes(m) ? methods.filter((x) => x !== m) : methods.length >= 3 ? methods : [...methods, m])
  const bump = (d) => setF({ ...f, price: (Math.max(0, toNum(num(f.price)) + d)).toFixed(2) })

  const bestPrice = best.data?.[0]?.price
  const value = toNum(num(f.total)) * toNum(num(f.price))
  const missing = side === 'sell' && accounts.data ? methods.filter((m) => !accounts.data.some((a) => a.method === m)) : []
  const all = config?.paymentMethods || ['hesabpay', 'mpaisa', 'mhawala', 'bank', 'hawala', 'cash']

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/offers', {
        side,
        price: num(f.price),
        total: num(f.total),
        minFiat: num(f.minFiat),
        maxFiat: num(f.maxFiat),
        paymentMethods: methods,
        paymentWindow: payWindow,
        terms: f.terms,
      })
      navigate('/orders?tab=offers', { replace: true })
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ gap: 14 }}>
      <TopBar title={t('createOffer')} back="/market" />
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <div className="seg">
          <button type="button" className="buy" aria-pressed={side === 'buy'} onClick={() => setSide('buy')}>{t('iWantBuy')}</button>
          <button type="button" className="sell" aria-pressed={side === 'sell'} onClick={() => setSide('sell')}>{t('iWantSell')}</button>
        </div>

        <div className="field" style={{ gap: 6 }}>
          <label htmlFor="price" className="label">{t('pricePerUsdt')}</label>
          <div className="input-box" style={{ padding: '0 6px' }}>
            <button type="button" className="icon-btn" style={{ background: 'var(--surface-2)', border: 0 }} aria-label="−" onClick={() => bump(-0.05)}><Icon name="minus" stroke={2} /></button>
            <input id="price" dir="ltr" inputMode="decimal" placeholder="0.00" value={f.price} onChange={set('price')} style={{ textAlign: 'center', fontSize: 22, fontWeight: 800 }} required />
            <span className="unit">؋</span>
            <button type="button" className="icon-btn" style={{ background: 'var(--surface-2)', border: 0 }} aria-label="+" onClick={() => bump(0.05)}><Icon name="plus" stroke={2} /></button>
          </div>
          {bestPrice && <span className="hint">{t('marketBest', { v: rate(bestPrice) })}</span>}
        </div>

        <div className="field" style={{ gap: 6 }}>
          <label htmlFor="total" className="label">{side === 'sell' ? t('totalToSell') : t('totalToBuy')}</label>
          <div className="input-box" style={{ paddingInlineEnd: 8 }}>
            <input id="total" dir="ltr" inputMode="decimal" placeholder="0" value={f.total} onChange={set('total')} style={{ textAlign: 'end', fontSize: 20, fontWeight: 800 }} required />
            <span className="unit" style={{ fontSize: 13 }}>USDT</span>
            {side === 'sell' && (
              <button type="button" className="chip square" style={{ height: 36 }} onClick={() => setF({ ...f, total: wallet.data?.available || '' })}>{t('all')}</button>
            )}
          </div>
          <span className="hint">
            {side === 'sell' && <>{t('available')}: <span className="num">{usdt(wallet.data?.available)}</span> USDT · </>}
            ≈ <span className="num">{value ? afn(String(Math.round(value))) : '—'}</span> ؋
          </span>
        </div>

        <div className="field" style={{ gap: 6 }}>
          <span className="label">{t('perTradeLimits')}</span>
          <div className="row" style={{ gap: 8 }}>
            <label className="input-box sm grow">
              <span className="caption">{t('min')}</span>
              <input dir="ltr" inputMode="decimal" value={f.minFiat} onChange={set('minFiat')} style={{ textAlign: 'end', fontSize: 15, fontWeight: 700 }} required />
            </label>
            <span className="caption">–</span>
            <label className="input-box sm grow">
              <span className="caption">{t('max')}</span>
              <input dir="ltr" inputMode="decimal" value={f.maxFiat} onChange={set('maxFiat')} style={{ textAlign: 'end', fontSize: 15, fontWeight: 700 }} required />
            </label>
          </div>
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{side === 'sell' ? t('receiveMethods') : t('payMethods')} <span className="caption">(≤ 3)</span></legend>
          <div className="chips wrap">
            {all.map((m) => (
              <button key={m} type="button" className="chip square" aria-pressed={methods.includes(m)} onClick={() => toggle(m)}>
                {methods.includes(m) && <Icon name="check" size={14} stroke={2.6} />}
                {pm(m)}
              </button>
            ))}
          </div>
          {missing.length > 0 && (
            <div className="note gold" style={{ marginTop: 8 }}>
              <Icon name="card" size={20} />
              <span>{t('missingAccounts', { m: missing.map(pm).join('، ') })} <Link to="/profile/accounts">{t('addAccount')}</Link></span>
            </div>
          )}
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>{t('buyerWindow')}</legend>
          <div className="grid-4" style={{ gap: 8 }}>
            {WINDOWS.map((w) => (
              <button key={w} type="button" className="chip square" style={{ justifyContent: 'center' }} aria-pressed={payWindow === w} onClick={() => setPayWindow(w)}>{t('minutes', { n: w })}</button>
            ))}
          </div>
        </fieldset>

        <div className="field" style={{ gap: 6 }}>
          <label htmlFor="terms" className="label">{t('terms')}</label>
          <div className="input-box">
            <textarea id="terms" rows={3} maxLength={1000} placeholder={t('termsPlaceholder')} value={f.terms} onChange={set('terms')} />
          </div>
        </div>

        {side === 'sell' && toNum(num(f.total)) > 0 && (
          <div className="note gold">
            <Icon name="lock" size={18} />
            <span>{t('lockNote', { v: usdt(num(f.total)) })}</span>
          </div>
        )}

        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !methods.length || missing.length > 0}>{t('publishOffer')}</button>
      </form>
    </main>
  )
}
