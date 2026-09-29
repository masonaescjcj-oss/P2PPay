import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Toast, TopBar } from '../components/Layout.jsx'
import StatusList from '../components/StatusList.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { toNum, usdt } from '../lib/format.js'
import { useApi, useToast } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

export default function Withdraw() {
  const { t, errText } = usePrefs()
  const { config, user } = useAuth()
  const wallet = useApi('/wallet')
  const kyc = useApi('/kyc')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const canWithdraw = user.totpEnabled || user.phoneVerified
  const left = kyc.data ? Math.max(0, toNum(kyc.data.limits.withdraw) - toNum(kyc.data.used.withdraw)) : null
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, showToast] = useToast()

  const fee = toNum(config?.withdrawFee ?? 1)
  const avail = toNum(wallet.data?.available)
  const a = toNum(amount.replace(/,/g, ''))
  const maxSend = Math.max(0, Math.floor((avail - fee) * 1e6) / 1e6)

  async function paste() {
    try {
      setAddress((await navigator.clipboard.readText()).trim())
    } catch {
      document.getElementById('addr')?.focus()
    }
  }

  async function sendCode() {
    setError(null)
    try {
      await api.post('/withdrawals/code')
      setCodeSent(true)
    } catch (err) {
      setError(errText(err))
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/withdrawals', { amount: amount.replace(/,/g, ''), address: address.trim(), code: code.trim() })
      setAmount('')
      setAddress('')
      setCode('')
      setCodeSent(false)
      kyc.reload()
      showToast(t('withdrawSubmitted'))
      wallet.reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" style={{ gap: 16 }}>
      <TopBar title={t('withdrawUsdt')} back="/wallet">
        <span className="pill neutral" dir="ltr">TRC20</span>
      </TopBar>

      <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="addr" className="label">{t('destAddress')}</label>
          <div className="input-box" style={{ paddingInlineEnd: 6 }}>
            <input id="addr" dir="ltr" placeholder="T…" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} style={{ fontSize: 14 }} />
            <button type="button" className="btn btn-secondary btn-sm" style={{ height: 44, background: 'var(--surface-2)', border: 0 }} onClick={paste}>{t('paste')}</button>
          </div>
          <span className="hint">{t('destHint')}</span>
        </div>

        <div className="field">
          <div className="between">
            <label htmlFor="wamt" className="label">{t('amount')}</label>
            <span className="caption">{t('available')}: <span className="num strong" style={{ color: 'var(--text)' }}>{usdt(wallet.data?.available)}</span> USDT</span>
          </div>
          <div className="input-box big" style={{ paddingInlineEnd: 10 }}>
            <input id="wamt" dir="ltr" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ textAlign: 'end' }} />
            <span className="unit">USDT</span>
            <button type="button" className="chip square" style={{ height: 36 }} onClick={() => setAmount(String(maxSend))}>{t('max')}</button>
          </div>
          <span className="hint">
            {t('minWithdraw', { v: config?.minWithdraw ?? '5' })}
            {left !== null && <> · {t('remainingToday', { v: usdt(String(left)) })}</>}
          </span>
        </div>

        <section className="card tight">
          <div className="kv"><span>{t('networkFee')}</span><span><span className="num">{usdt(String(fee))}</span> USDT</span></div>
          <div className="kv"><span>{t('totalDeducted')}</span><span><span className="num">{a ? usdt(String(a + fee)) : '—'}</span> USDT</span></div>
          <div className="kv"><span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{t('destReceives')}</span><span className="t-green" style={{ fontSize: 14, fontWeight: 800 }}><span className="num">{a ? usdt(String(a)) : '—'}</span> USDT</span></div>
        </section>

        {canWithdraw ? (
          <div className="field">
            <label htmlFor="wcode" className="label">{user.totpEnabled ? t('authenticatorCode') : t('smsCode')}</label>
            <div className="input-box sm" style={{ paddingInlineEnd: 6 }}>
              <input id="wcode" dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} style={{ fontSize: 18, letterSpacing: 4, textAlign: 'center' }} />
              {!user.totpEnabled && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ height: 40, background: 'var(--surface-2)', border: 0 }} onClick={sendCode}>
                  {codeSent ? t('resend') : t('sendCode')}
                </button>
              )}
            </div>
            {codeSent && <span className="hint">{t('codeSentTo', { p: user.phone || '' })}</span>}
          </div>
        ) : (
          <div className="note gold">
            <Icon name="phone" size={20} />
            <span>{t('withdrawNeedsVerify')} <Link to="/profile/verification">{t('goVerify')}</Link></span>
          </div>
        )}

        <div className="note green">
          <Icon name="shieldCheck" size={20} />
          <span>{t('withdrawNote')}</span>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !a || !address || !canWithdraw || code.trim().length < 6}>{t('confirmWithdraw')}</button>
      </form>

      <StatusList title={t('recentWithdrawals')} items={wallet.data?.withdrawals} showAddress />
      <Toast msg={toast} />
    </main>
  )
}
