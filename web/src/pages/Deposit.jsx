import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { TetherMark } from '../components/Brand.jsx'
import { Toast, TopBar } from '../components/Layout.jsx'
import StatusList from '../components/StatusList.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { copyText, useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

export default function Deposit() {
  const { t, errText } = usePrefs()
  const { config } = useAuth()
  const wallet = useApi('/wallet')
  const [qr, setQr] = useState(null)
  const [amount, setAmount] = useState('')
  const [txid, setTxid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, showToast] = useToast()
  const address = config?.depositAddress

  useEffect(() => {
    if (!address) return
    QRCode.toDataURL(address, { errorCorrectionLevel: 'H', margin: 0, width: 320, color: { dark: '#080C1C', light: '#F5EFE2' } }).then(setQr, () => setQr(null))
  }, [address])

  async function paste() {
    try {
      setTxid((await navigator.clipboard.readText()).trim())
    } catch {
      document.getElementById('txid')?.focus()
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/deposits', { amount, txid })
      setAmount('')
      setTxid('')
      showToast(t('depositSubmitted'))
      wallet.reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ gap: 14 }}>
      <TopBar title={t('depositUsdt')} back="/wallet" />

      <div className="card between" style={{ padding: '10px 14px' }}>
        <div className="row">
          <span className="icon-tile coral" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 11, fontWeight: 800 }} dir="ltr">TRX</span>
          <div className="stack" style={{ gap: 1 }}>
            <strong style={{ fontSize: 14 }}>{t('tronNetwork')}</strong>
            <span className="caption" style={{ fontSize: 11.5 }}>{t('onlyNetwork')}</span>
          </div>
        </div>
        <Icon name="check" stroke={2.4} className="t-green" />
      </div>

      <section className="card stack" style={{ alignItems: 'center', gap: 14, padding: 18 }}>
        <div className="qr-box" style={{ position: 'relative' }}>
          {qr ? <img src={qr} alt={t('depositAddress')} style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ background: '#F5EFE2', borderRadius: 20, padding: 3, display: 'flex' }}><TetherMark size={34} /></span>
          </span>
        </div>
        <div className="stack" style={{ width: '100%', gap: 6 }}>
          <span className="caption">{t('depositAddress')}</span>
          <div className="row" style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--sunken)', border: '1px dashed var(--ring)' }}>
            <span className="address grow">{address || '—'}</span>
            <button type="button" className="icon-btn" style={{ width: 40, height: 40, background: 'var(--gold)', color: 'var(--on-gold)', border: 0 }} aria-label={t('copy')} onClick={async () => showToast((await copyText(address)) ? t('copied') : address)}>
              <Icon name="copy" size={17} stroke={2} />
            </button>
          </div>
        </div>
      </section>

      <div className="note coral">
        <Icon name="alert" size={20} />
        <span>{t('depositWarning')}</span>
      </div>

      <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
        <span className="label">{t('afterSending')}</span>
        <div className="input-box sm">
          <label htmlFor="damt" className="sr-only">{t('amount')}</label>
          <input id="damt" dir="ltr" inputMode="decimal" placeholder={t('amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="unit">USDT</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="input-box sm grow">
            <label htmlFor="txid" className="sr-only">{t('txid')}</label>
            <input id="txid" dir="ltr" placeholder="TxID" value={txid} onChange={(e) => setTxid(e.target.value)} autoComplete="off" spellCheck={false} style={{ fontSize: 14 }} />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ height: 50 }} onClick={paste}>{t('paste')}</button>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !amount || !txid}>{t('submitDeposit')}</button>
      </form>

      <StatusList title={t('recentDeposits')} items={wallet.data?.deposits} />
      <Toast msg={toast} />
    </main>
  )
}
