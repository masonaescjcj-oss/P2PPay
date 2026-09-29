import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Loading, Toast, TopBar } from '../components/Layout.jsx'
import Sheet from '../components/Sheet.jsx'
import { api } from '../lib/api.js'
import { afn, clock, rate, usdt } from '../lib/format.js'
import { copyText, useApi, useNow, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

function Step({ n, stage, label }) {
  return (
    <div className={`step ${stage >= n ? 'on' : ''}`}>
      <span className="n">{stage > n ? <Icon name="check" size={13} stroke={3} /> : <span className="num">{n}</span>}</span>
      <span>{label}</span>
    </div>
  )
}

function Steps({ trade }) {
  const { t } = usePrefs()
  const stage = trade.status === 'pending_payment' ? 1 : trade.status === 'completed' ? 3 : 2
  return (
    <div className="steps">
      <Step n={1} stage={stage} label={t('stepPay')} />
      <span className={`line ${stage > 1 ? 'done' : ''}`} />
      <Step n={2} stage={stage} label={t('stepConfirm')} />
      <span className={`line ${stage > 2 ? 'done' : ''}`} />
      <Step n={3} stage={stage} label={t('stepReceive')} />
    </div>
  )
}

function Ring({ left, total }) {
  const c = 2 * Math.PI * 33
  const frac = Math.max(0, Math.min(1, left / total))
  return (
    <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r="33" fill="none" stroke="var(--gold-tint-line)" strokeWidth="5" />
        <circle cx="38" cy="38" r="33" fill="none" stroke="var(--gold)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 38 38)" />
      </svg>
      <div className="num t-gold" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800 }} role="timer">
        {clock(left)}
      </div>
    </div>
  )
}

// After a completed trade each side rates the other once.
function RateCard({ trade, onRated }) {
  const { t, errText } = usePrefs()
  const [choice, setChoice] = useState(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const other = trade.role === 'buyer' ? trade.seller : trade.buyer
  if (trade.myRating) {
    return (
      <div className="note green" style={{ alignItems: 'center' }}>
        <Icon name="thumbUp" size={18} />
        <span>{t('ratedThanks')}</span>
      </div>
    )
  }
  async function send() {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/trades/${trade.id}/rate`, { positive: choice, comment: comment.trim() || undefined })
      onRated()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <strong style={{ fontSize: 15 }}>{t('rateTitle', { n: other.displayName })}</strong>
      <div className="grid-2">
        <button type="button" className="rate-btn up" aria-pressed={choice === true} onClick={() => setChoice(true)}>
          <Icon name="thumbUp" size={20} />{t('rateGood')}
        </button>
        <button type="button" className="rate-btn down" aria-pressed={choice === false} onClick={() => setChoice(false)}>
          <Icon name="thumbUp" size={20} style={{ transform: 'scaleY(-1)' }} />{t('rateBad')}
        </button>
      </div>
      {choice !== null && (
        <>
          <div className="input-box sm">
            <label htmlFor="rc" className="sr-only">{t('rateComment')}</label>
            <input id="rc" maxLength={300} placeholder={t('rateComment')} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>{t('rateSend')}</button>
        </>
      )}
    </section>
  )
}

function Result({ trade, onChange }) {
  const { t, pm } = usePrefs()
  const ok = trade.status === 'completed'
  const isBuyer = trade.role === 'buyer'
  const other = isBuyer ? trade.seller : trade.buyer
  return (
    <main className="page" style={{ gap: 14 }}>
      <div className="between">
        <span />
        <Link to="/" className="icon-btn" aria-label={t('close')}><Icon name="x" stroke={2} /></Link>
      </div>
      <div className="stack" style={{ alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <svg width="112" height="112" viewBox="0 0 150 150" aria-hidden="true">
          <circle cx="75" cy="75" r="72" fill={ok ? 'var(--green-tint)' : 'var(--surface-2)'} />
          <circle cx="75" cy="75" r="44" fill={ok ? 'var(--green)' : 'var(--surface-3)'} />
          {ok ? (
            <path d="m57 76 12 12 25-27" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M63 63l24 24M87 63 63 87" fill="none" stroke="var(--muted)" strokeWidth="5" strokeLinecap="round" />
          )}
        </svg>
        <h1 className="display" style={{ fontSize: 22 }}>{ok ? t('tradeDone') : t('tradeCancelled')}</h1>
        {ok && (
          <div dir="ltr" className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <span className={`num ${isBuyer ? 't-green' : ''}`} style={{ fontSize: 40, fontWeight: 800 }}>{isBuyer ? '+' : '−'}{usdt(isBuyer ? trade.receive : trade.amount)}</span>
            <span className="muted strong">USDT</span>
          </div>
        )}
        <p className="muted" style={{ fontSize: 14 }}>{ok ? (isBuyer ? t('addedToWallet') : t('soldDone')) : t('tradeCancelledSub')}</p>
      </div>
      <section className="card tight">
        <div className="kv"><span>{t('orderNo')}</span><span className="num">#{trade.id}</span></div>
        <div className="kv"><span>{t('counterparty')}</span><Link to={`/u/${other.username}`}>{other.displayName}</Link></div>
        <div className="kv"><span>{t('paid')}</span><span><span className="num">{afn(trade.fiat)}</span> ؋ · {pm(trade.paymentMethod)}</span></div>
        <div className="kv"><span>{t('price')}</span><span><span className="num">{rate(trade.price)}</span> ؋</span></div>
        {ok && <div className="kv"><span>{t('fee')}</span><span><span className="num">{usdt(trade.fee)}</span> USDT</span></div>}
      </section>
      {ok && trade.myRating !== null && <RateCard trade={trade} onRated={onChange} />}
      <div className="stack push-end" style={{ gap: 10 }}>
        <Link to="/wallet" className="btn btn-primary">{t('viewWallet')}</Link>
        <Link to="/market" className="btn btn-secondary">{t('newTrade')}</Link>
        <Link to={`/trades/${trade.id}/chat`} className="btn-link" style={{ textAlign: 'center' }}>{t('chat')}</Link>
      </div>
    </main>
  )
}

export default function Trade() {
  const { id } = useParams()
  const { t, pm, errText } = usePrefs()
  const trade = useApi(`/trades/${id}`, { interval: 4000 })
  const now = useNow()
  const [toast, showToast] = useToast()
  const [sheet, setSheet] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const tr = trade.data
  if (trade.loading) return <main className="page"><Loading /></main>
  if (!tr) return <main className="page"><TopBar title={t('order')} back="/orders" /><p className="error-text">{errText(trade.error)}</p></main>
  if (tr.status === 'completed' || tr.status === 'cancelled') return <Result trade={tr} onChange={trade.reload} />

  const isBuyer = tr.role === 'buyer'
  const other = isBuyer ? tr.seller : tr.buyer
  const left = tr.expiresAt - now
  const windowMs = tr.expiresAt - tr.createdAt

  async function act(action, body) {
    setBusy(true)
    setError(null)
    try {
      trade.setData(await api.post(`/trades/${id}/${action}`, body))
      setSheet(null)
    } catch (err) {
      setError(errText(err))
      trade.reload()
    } finally {
      setBusy(false)
    }
  }

  const copy = async (v) => showToast((await copyText(v)) ? t('copied') : v)

  let head
  if (tr.status === 'pending_payment') head = isBuyer ? [t('payNow'), t('payNowSub')] : [t('waitBuyer'), t('waitBuyerSub')]
  else if (tr.status === 'paid') head = isBuyer ? [t('waitSeller'), t('waitSellerSub')] : [t('checkPayment'), t('checkPaymentSub')]
  else head = [t('disputed'), t('disputedSub')]

  return (
    <main className="page" style={{ gap: 12 }}>
      <TopBar title={isBuyer ? t('buyFrom', { n: other.displayName }) : t('sellTo', { n: other.displayName })} sub={<>{t('order')} <span className="num">#{tr.id}</span></>} back="/orders">
        <Link to={`/trades/${tr.id}/chat`} className="icon-btn" aria-label={t('chat')}><Icon name="chat" /></Link>
      </TopBar>

      <section className="timer-card" style={tr.status === 'disputed' ? { background: 'var(--coral-tint-2)', borderColor: 'var(--coral-tint-line)' } : undefined}>
        {tr.status === 'pending_payment' ? (
          <Ring left={left} total={windowMs} />
        ) : (
          <span className={`icon-tile ${tr.status === 'disputed' ? 'coral' : 'blue'}`} style={{ width: 56, height: 56, borderRadius: 18 }}>
            <Icon name={tr.status === 'disputed' ? 'alert' : 'clock'} size={26} />
          </span>
        )}
        <div className="stack" style={{ gap: 4 }}>
          <strong style={{ fontSize: 15 }}>{head[0]}</strong>
          <span className="sub" style={tr.status === 'disputed' ? { color: 'var(--coral-tint-text)' } : undefined}>{head[1]}</span>
        </div>
      </section>

      <Steps trade={tr} />

      <section className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <div className="stack" style={{ gap: 2 }}>
            <span className="caption">{isBuyer ? t('amountToPay') : t('amountToReceive')}</span>
            <span style={{ fontSize: 26, fontWeight: 800 }}><span className="num">{afn(tr.fiat)}</span> <span className="muted">؋</span></span>
          </div>
          <button type="button" className="icon-btn" style={{ background: 'var(--surface-3)', border: 0 }} aria-label={t('copy')} onClick={() => copy(tr.fiat)}>
            <Icon name="copy" size={18} />
          </button>
        </div>
        <div style={{ height: 1, background: 'var(--line)' }} />
        <div className="grid-3" style={{ gap: 8, fontSize: 12 }}>
          <div className="stack" style={{ gap: 2 }}><span className="caption">{t('price')}</span><span className="strong"><span className="num">{rate(tr.price)}</span> ؋</span></div>
          <div className="stack" style={{ gap: 2 }}><span className="caption">USDT</span><span className="strong num">{usdt(tr.amount)}</span></div>
          <div className="stack" style={{ gap: 2 }}><span className="caption">{t('receiveNet')}</span><span className="strong t-green"><span className="num">{usdt(tr.receive)}</span></span></div>
        </div>
      </section>

      <section className="card tight">
        <div className="kv"><span>{t('paymentMethod')}</span><span className="row" style={{ gap: 6 }}><span className="tag">{pm(tr.paymentMethod)}</span></span></div>
        {tr.paymentAccount ? (
          <>
            <div className="kv"><span>{t('recipientName')}</span><span>{tr.paymentAccount.holderName}</span></div>
            <div className="kv">
              <span>{t('accountNumber')}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="num" style={{ fontSize: 15 }}>{tr.paymentAccount.account}</span>
                <button type="button" className="icon-btn" style={{ width: 36, height: 36, background: 'var(--surface-3)', border: 0 }} aria-label={t('copy')} onClick={() => copy(tr.paymentAccount.account)}>
                  <Icon name="copy" size={16} />
                </button>
              </span>
            </div>
          </>
        ) : (
          <div className="kv"><span className="muted" style={{ color: 'var(--muted)' }}>{t('noAccountInfo')}</span><span /></div>
        )}
      </section>

      {tr.terms && (
        <section className="card stack" style={{ gap: 6 }}>
          <span className="label">{t('sellerTerms')}</span>
          <p style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>{tr.terms}</p>
        </section>
      )}

      <div className="note coral">
        <Icon name="alert" size={20} />
        <span>{isBuyer ? t('payWarning') : t('releaseWarning')}</span>
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="stack push-end" style={{ gap: 10 }}>
        {isBuyer && tr.status === 'pending_payment' && (
          <div className="row">
            <button type="button" className="btn btn-primary grow" disabled={busy} onClick={() => act('pay')}>
              <Icon name="check" stroke={2.2} />
              {t('iPaid')}
            </button>
            <button type="button" className="btn btn-danger nowrap" style={{ width: 'auto', paddingInline: 16 }} disabled={busy} onClick={() => setSheet('cancel')}>{t('cancelOrder')}</button>
          </div>
        )}
        {!isBuyer && (tr.status === 'paid' || tr.status === 'pending_payment') && (
          <button type="button" className={`btn ${tr.status === 'paid' ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => setSheet('release')}>
            {t('release')}
          </button>
        )}
        {isBuyer && tr.status === 'paid' && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setSheet('cancel')}>{t('cancelOrder')}</button>
        )}
        {tr.status === 'paid' && (
          <button type="button" className="btn-link" style={{ color: 'var(--coral-text)', textAlign: 'center' }} onClick={() => setSheet('dispute')}>
            {t('openDispute')}
          </button>
        )}
      </div>

      {sheet === 'release' && (
        <Sheet title={t('release')} onClose={() => setSheet(null)}>
          <p style={{ fontSize: 14, lineHeight: 1.9 }}>{t('confirmRelease', { v: afn(tr.fiat) })}</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('release')}>{t('confirm')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setSheet(null)}>{t('cancel')}</button>
        </Sheet>
      )}
      {sheet === 'cancel' && (
        <Sheet title={t('cancelOrder')} onClose={() => setSheet(null)}>
          <p style={{ fontSize: 14, lineHeight: 1.9 }}>{t('confirmCancel')}</p>
          <button type="button" className="btn btn-sell" disabled={busy} onClick={() => act('cancel')}>{t('cancelOrder')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setSheet(null)}>{t('cancel')}</button>
        </Sheet>
      )}
      {sheet === 'dispute' && (
        <Sheet title={t('openDispute')} onClose={() => setSheet(null)}>
          <label htmlFor="reason" className="label">{t('disputeReason')}</label>
          <div className="input-box">
            <textarea id="reason" rows={4} maxLength={1000} placeholder={t('disputePlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className="btn btn-sell" disabled={busy || !reason.trim()} onClick={() => act('dispute', { reason })}>{t('submit')}</button>
        </Sheet>
      )}
      <Toast msg={toast} />
    </main>
  )
}
