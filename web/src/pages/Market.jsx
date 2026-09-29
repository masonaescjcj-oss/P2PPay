import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Loading, TabBar } from '../components/Layout.jsx'
import OfferCard from '../components/OfferCard.jsx'
import { useAuth } from '../lib/auth.jsx'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

export default function Market() {
  const { t, pm } = usePrefs()
  const { user, config } = useAuth()
  const [params, setParams] = useSearchParams()
  const side = params.get('side') === 'sell' ? 'sell' : 'buy'
  const method = params.get('pm') || ''
  const [amount, setAmount] = useState(params.get('fiat') || '')
  const [fiat, setFiat] = useState(amount)

  useEffect(() => {
    const id = setTimeout(() => setFiat(amount.trim()), 400)
    return () => clearTimeout(id)
  }, [amount])

  const q = new URLSearchParams({ side })
  if (method) q.set('paymentMethod', method)
  if (fiat) q.set('fiat', fiat)
  const offers = useApi(`/offers?${q}`, { interval: 20000 })

  const update = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const methods = config?.paymentMethods || ['hesabpay', 'mpaisa', 'mhawala', 'bank', 'hawala', 'cash']
  const list = (offers.data || []).filter((o) => o.maker.id !== user?.id)

  return (
    <>
      <main className="page with-tabs" style={{ gap: 14 }}>
        <div className="between">
          <div className="stack" style={{ gap: 2 }}>
            <h1 className="h1">{t('market')}</h1>
            <span className="caption"><span dir="ltr">USDT / AFN</span> · {t('marketSub')}</span>
          </div>
          <Link to="/offers/new" className="icon-btn" aria-label={t('newOffer')} style={{ color: 'var(--gold-text)' }}>
            <Icon name="plus" stroke={2} />
          </Link>
        </div>

        <div className="seg">
          <button type="button" className="buy" aria-pressed={side === 'buy'} onClick={() => update('side', 'buy')}>{t('buyUsdt')}</button>
          <button type="button" className="sell" aria-pressed={side === 'sell'} onClick={() => update('side', 'sell')}>{t('sellUsdt')}</button>
        </div>

        <div className="input-box" style={{ minHeight: 50 }}>
          <Icon name="search" size={18} style={{ color: 'var(--caption)' }} />
          <label htmlFor="amt" className="sr-only">{t('amountAfnFilter')}</label>
          <input id="amt" inputMode="decimal" placeholder={t('amountAfnFilter')} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontSize: 14 }} />
          <span className="unit">؋</span>
        </div>

        <div className="chips">
          <button type="button" className="chip" aria-pressed={!method} onClick={() => update('pm', '')}>{t('all')}</button>
          {methods.map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={method === m} onClick={() => update('pm', m)}>{pm(m)}</button>
          ))}
        </div>

        {offers.loading ? (
          <Loading />
        ) : list.length ? (
          <div className="stack" style={{ gap: 10 }}>
            {list.map((o) => <OfferCard key={o.id} offer={o} side={side} />)}
          </div>
        ) : (
          <Empty action={<Link to="/offers/new" className="btn btn-secondary btn-sm">{t('postFirstOffer')}</Link>}>{t('noOffers')}</Empty>
        )}
      </main>
      <TabBar />
    </>
  )
}
