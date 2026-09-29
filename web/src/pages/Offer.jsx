import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Loading, TopBar } from '../components/Layout.jsx'
import { MakerLine } from '../components/OfferCard.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { afn, initial, rate, toNum, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

const clean = (s) => s.replace(/[,٬\s]/g, '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace('٫', '.')

export default function Offer() {
  const { id } = useParams()
  const { t, pm, errText } = usePrefs()
  const { user, config } = useAuth()
  const navigate = useNavigate()
  const offer = useApi(`/offers/${id}`)
  const accounts = useApi('/payment-accounts', { enabled: !!user })
  const [mode, setMode] = useState('fiat')
  const [value, setValue] = useState('')
  const [method, setMethod] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [errCode, setErrCode] = useState(null)

  const o = offer.data
  const visitorBuys = o?.side === 'sell'
  const chosen = method || o?.paymentMethods[0]
  const feeBps = config?.tradeFeeBps ?? 10

  const calc = useMemo(() => {
    if (!o) return null
    const price = toNum(o.price)
    const v = toNum(clean(value))
    if (!v) return null
    const usdtAmt = mode === 'fiat' ? Math.floor((v / price) * 1e6) / 1e6 : v
    const fiatAmt = mode === 'fiat' ? v : Math.round(v * price * 100) / 100
    const fee = Math.floor(usdtAmt * feeBps) / 10000
    return { usdtAmt, fiatAmt, fee, net: usdtAmt - fee }
  }, [o, value, mode, feeBps])

  if (offer.loading) return <main className="page"><Loading /></main>
  if (!o) return <main className="page"><TopBar title={t('market')} back="/market" /><p className="error-text">{errText(offer.error)}</p></main>

  const outOfRange = calc && (calc.fiatAmt < toNum(o.minFiat) || calc.fiatAmt > toNum(o.maxFiat))
  const needsAccount = user && !visitorBuys && accounts.data && !accounts.data.some((a) => a.method === chosen)
  const quick = [toNum(o.minFiat), Math.round((toNum(o.minFiat) + toNum(o.maxFiat)) / 2), toNum(o.maxFiat)]

  async function submit() {
    if (!user) return navigate('/login', { state: { from: `/offers/${id}` } })
    setBusy(true)
    setError(null)
    try {
      const body = { paymentMethod: chosen }
      if (mode === 'fiat') body.fiat = clean(value)
      else body.amount = clean(value)
      const trade = await api.post(`/offers/${id}/trades`, body)
      navigate(`/trades/${trade.id}`, { replace: true })
    } catch (err) {
      setError(errText(err))
      setErrCode(err.code)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ gap: 14 }}>
      <TopBar title={visitorBuys ? t('buyUsdt') : t('sellUsdt')} back="/market">
        <span className="pill green"><Icon name="shield" size={14} stroke={2} />{t('escrow')}</span>
      </TopBar>

      <section className="card stack" style={{ gap: 12, padding: 14 }}>
        <div className="row">
          <div className="avatar">{initial(o.maker.displayName)}</div>
          <MakerLine maker={o.maker} />
          <div className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
            <span className={`price ${visitorBuys ? 't-green' : 't-coral'}`}><span className="num">{rate(o.price)}</span> ؋</span>
            <span className="caption" style={{ fontSize: 11 }}>{t('perUsdt')}</span>
          </div>
        </div>
        <div className="grid-3" style={{ gap: 8 }}>
          <div className="stat"><span>{t('availableAmt')}</span><span className="num">{usdt(o.remaining)}</span></div>
          <div className="stat"><span>{t('payWindow')}</span><span>{t('minutes', { n: o.paymentWindow })}</span></div>
          <div className="stat"><span>{t('completion')}</span><span className="num">{o.maker.completionRate ?? '—'}{o.maker.completionRate !== null ? '%' : ''}</span></div>
        </div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <div className="between">
          <label htmlFor="pay" className="label">{visitorBuys ? t('youPay') : t('youSell')}</label>
          <div className="seg sm">
            <button type="button" aria-pressed={mode === 'fiat'} onClick={() => { setMode('fiat'); setValue('') }}>{t('inAfn')}</button>
            <button type="button" aria-pressed={mode === 'usdt'} onClick={() => { setMode('usdt'); setValue('') }}>USDT</button>
          </div>
        </div>
        <div className="input-box big stack" style={{ alignItems: 'stretch', gap: 10 }}>
          <div className="row">
            <input id="pay" dir="ltr" inputMode="decimal" placeholder="0" value={value} onChange={(e) => setValue(e.target.value)} style={{ textAlign: 'end' }} />
            <span className="unit" style={{ fontSize: mode === 'fiat' ? 22 : 15 }}>{mode === 'fiat' ? '؋' : 'USDT'}</span>
          </div>
          <div style={{ height: 1, background: 'var(--line)' }} />
          <div className="between" style={{ fontSize: 13 }}>
            <span className="muted">{visitorBuys ? t('youReceive') : t('amountToReceive')}</span>
            <span className="strong t-green">
              {mode === 'fiat' ? (
                <><span className="num">{calc ? usdt(String(visitorBuys ? calc.net : calc.usdtAmt)) : '—'}</span> USDT</>
              ) : (
                <><span className="num">{calc ? afn(String(calc.fiatAmt)) : '—'}</span> ؋</>
              )}
            </span>
          </div>
        </div>
        {mode === 'fiat' && (
          <div className="grid-3" style={{ gap: 8 }}>
            {quick.map((q, i) => (
              <button key={i} type="button" className="chip square" style={{ justifyContent: 'center' }} aria-pressed={toNum(clean(value)) === q} onClick={() => setValue(String(q))}>
                {i === 2 ? t('max') : <span className="num">{afn(String(q))}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="between caption" style={{ flexWrap: 'wrap' }}>
          <span>{t('limits')}: <span className="num">{afn(o.minFiat)} – {afn(o.maxFiat)}</span> ؋</span>
          <span>{t('fee')} <span className="num">{(feeBps / 100).toString()}%</span>{calc && visitorBuys ? <>: <span className="num">{usdt(String(calc.fee))}</span> USDT</> : null}</span>
        </div>
        {outOfRange && <span className="error-text">{t('err_outside_limits')}</span>}
      </section>

      <section className="stack">
        <span className="label">{t('paymentMethod')}</span>
        <div className="grid-2" style={{ gap: 8 }}>
          {o.paymentMethods.map((m) => (
            <label key={m} className="input-box sm" style={{ cursor: 'pointer', borderColor: chosen === m ? 'var(--gold-line)' : undefined, background: chosen === m ? 'var(--gold-tint)' : undefined }}>
              <input type="radio" name="pm" checked={chosen === m} onChange={() => setMethod(m)} style={{ flexGrow: 0, accentColor: 'var(--gold)', width: 18, height: 18 }} />
              <span style={{ fontSize: 14, fontWeight: 700 }}>{pm(m)}</span>
            </label>
          ))}
        </div>
      </section>

      {o.terms && (
        <section className="card stack" style={{ gap: 6 }}>
          <span className="label">{t('sellerTerms')}</span>
          <p style={{ fontSize: 13.5, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>{o.terms}</p>
        </section>
      )}

      {needsAccount ? (
        <div className="note gold">
          <Icon name="card" size={20} />
          <span>
            {t('needAccountFor', { m: pm(chosen) })} <Link to="/profile/accounts">{t('addAccount')}</Link>
          </span>
        </div>
      ) : (
        <div className="note green">
          <Icon name="shieldCheck" size={20} />
          <span>{t('escrowNote')}</span>
        </div>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error} {/limit|kyc|counterparty/.test(errCode || '') && <Link to="/profile/verification">{t('goVerify')}</Link>}
        </p>
      )}

      <div className="push-end">
        <button type="button" className={`btn ${visitorBuys ? 'btn-buy' : 'btn-sell'}`} disabled={busy || (user && (!calc || outOfRange || needsAccount))} onClick={submit}>
          {!user
            ? t('loginToTrade')
            : visitorBuys
              ? t('buyAmount', { v: calc ? usdt(String(calc.net)) : '' })
              : t('sellAmount', { v: calc ? usdt(String(calc.usdtAmt)) : '' })}
        </button>
      </div>
    </main>
  )
}
