import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Empty, TopBar } from '../components/Layout.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

export default function PaymentAccounts() {
  const { t, pm, errText } = usePrefs()
  const { config, user } = useAuth()
  const accounts = useApi('/payment-accounts')
  const methods = config?.paymentMethods || ['hesabpay', 'mpaisa', 'mhawala', 'bank', 'hawala', 'cash']
  const [form, setForm] = useState({ method: methods[0], holderName: user.displayName, account: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/payment-accounts', form)
      setForm({ ...form, account: '' })
      accounts.reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    try {
      await api.post(`/payment-accounts/${id}/delete`)
      accounts.reload()
    } catch (err) {
      setError(errText(err))
    }
  }

  return (
    <main className="page">
      <TopBar title={t('myPaymentAccounts')} back="/profile" />

      {accounts.data?.length ? (
        <section className="card flush">
          {accounts.data.map((a) => (
            <div key={a.id} className="menu-row" style={{ cursor: 'default' }}>
              <span className="icon-tile gold" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="card" size={18} /></span>
              <div className="grow stack" style={{ gap: 2 }}>
                <strong style={{ fontSize: 14 }}>{pm(a.method)}</strong>
                <span className="caption">{a.holderName} · <span className="num">{a.account}</span></span>
              </div>
              <button type="button" className="icon-btn plain" style={{ color: 'var(--coral-text)' }} aria-label={t('remove')} onClick={() => remove(a.id)}>
                <Icon name="x" size={18} stroke={2} />
              </button>
            </div>
          ))}
        </section>
      ) : (
        !accounts.loading && <Empty>{t('noPaymentAccounts')}</Empty>
      )}

      <form className="card stack" style={{ gap: 12 }} onSubmit={save}>
        <h2 className="h2">{t('addAccount')}</h2>
        <div className="chips wrap">
          {methods.map((m) => (
            <button key={m} type="button" className="chip square" aria-pressed={form.method === m} onClick={() => setForm({ ...form, method: m })}>{pm(m)}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="holder" className="label">{t('holderName')}</label>
          <div className="input-box sm"><input id="holder" value={form.holderName} onChange={(e) => setForm({ ...form, holderName: e.target.value })} maxLength={80} /></div>
        </div>
        <div className="field">
          <label htmlFor="acct" className="label">{t('accountOrPhone')}</label>
          <div className="input-box sm"><input id="acct" dir="ltr" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} maxLength={80} /></div>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !form.account.trim() || !form.holderName.trim()}>{t('save')}</button>
      </form>
    </main>
  )
}
