import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { TetherMark } from '../components/Brand.jsx'
import { Loading, Toast, TopBar } from '../components/Layout.jsx'
import StatusList from '../components/StatusList.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { copyText, useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

function AddressCard({ address, label, onCopied }) {
  const { t } = usePrefs()
  const [qr, setQr] = useState(null)
  useEffect(() => {
    if (!address) return
    QRCode.toDataURL(address, { errorCorrectionLevel: 'H', margin: 0, width: 320, color: { dark: '#080C1C', light: '#F5EFE2' } }).then(setQr, () => setQr(null))
  }, [address])
  return (
    <section className="card stack" style={{ alignItems: 'center', gap: 14, padding: 18 }}>
      <div className="qr-box" style={{ position: 'relative' }}>
        {qr ? <img src={qr} alt={label} style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ background: '#F5EFE2', borderRadius: 20, padding: 3, display: 'flex' }}><TetherMark size={34} /></span>
        </span>
      </div>
      <div className="stack" style={{ width: '100%', gap: 6 }}>
        <span className="caption">{label}</span>
        <div className="row" style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--sunken)', border: '1px dashed var(--ring)' }}>
          <span className="address grow">{address || '—'}</span>
          <button type="button" className="icon-btn" style={{ width: 40, height: 40, background: 'var(--accent)', color: 'var(--on-accent)', border: 0 }} aria-label={t('copy')} onClick={async () => onCopied((await copyText(address)) ? t('copied') : address)}>
            <Icon name="copy" size={17} stroke={2} />
          </button>
        </div>
      </div>
    </section>
  )
}

function NetworkRow() {
  const { t } = usePrefs()
  return (
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
  )
}

// Chain mode: every user has a personal address; deposits are detected automatically.
function ChainDeposit() {
  const { t, errText } = usePrefs()
  const addr = useApi('/deposit-address')
  const wallet = useApi('/wallet', { interval: 20000 })
  const [busy, setBusy] = useState(false)
  const [toast, showToast] = useToast()

  async function check() {
    setBusy(true)
    try {
      const r = await api.post('/deposit-address/check')
      showToast(r.credited ? t('newDepositsCredited', { n: r.credited }) : t('noNewDeposits'))
      wallet.reload()
    } catch (err) {
      showToast(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ gap: 14 }}>
      <TopBar title={t('depositUsdt')} back="/wallet" />
      <NetworkRow />
      {addr.loading ? <Loading /> : <AddressCard address={addr.data?.address} label={t('yourDepositAddress')} onCopied={showToast} />}
      <div className="note green">
        <Icon name="shieldCheck" size={20} />
        <span>{t('personalAddressNote')}</span>
      </div>
      <div className="note coral">
        <Icon name="alert" size={20} />
        <span>
          {t('depositWarning')} {addr.data && t('minDeposit', { v: addr.data.minDeposit })}
        </span>
      </div>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={check}>
        <Icon name="search" size={18} />
        {busy ? t('checking') : t('checkNow')}
      </button>
      <StatusList title={t('recentDeposits')} items={wallet.data?.deposits} />
      <Toast msg={toast} />
    </main>
  )
}

// Manual mode: one shared platform address; the user submits the TxID and an admin approves it.
function ManualDeposit() {
  const { t, errText } = usePrefs()
  const { config } = useAuth()
  const wallet = useApi('/wallet')
  const [amount, setAmount] = useState('')
  const [txid, setTxid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, showToast] = useToast()

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
      <NetworkRow />
      <AddressCard address={config?.depositAddress} label={t('depositAddress')} onCopied={showToast} />
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

export default function Deposit() {
  const { config } = useAuth()
  if (!config) return <main className="page"><Loading /></main>
  return config.chain ? <ChainDeposit /> : <ManualDeposit />
}
