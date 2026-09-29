import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Empty, Loading, Toast } from '../../components/Layout.jsx'
import Sheet from '../../components/Sheet.jsx'
import { api } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.jsx'
import { copyText, useApi, useToast } from '../../lib/hooks.js'
import { usdt } from '../../lib/format.js'
import { usePrefs } from '../../lib/prefs.jsx'

const TONE = { pending: 'gold', sending: 'blue', approved: 'green', sent: 'green', failed: 'coral', rejected: 'coral' }

function when(ts) {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

// Deposits (kind="deposits") and withdrawals (kind="withdrawals") share one review screen.
export default function AdminFunds({ kind }) {
  const { t, errText } = usePrefs()
  const { config } = useAuth()
  const chainOn = !!config?.chain
  const explorer = config?.chain?.explorer || 'https://tronscan.org'
  const tx = (id) => `${explorer}/#/transaction/${id}`
  const addr = (a) => `${explorer}/#/address/${a}`
  const isDep = kind === 'deposits'
  const [status, setStatus] = useState('pending')
  const list = useApi(`/admin/${kind}${status ? `?status=${status}` : ''}`, { interval: 15000 })
  const [sheet, setSheet] = useState(null) // { item, approve }
  const [form, setForm] = useState({ amount: '', txid: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, showToast] = useToast()

  const open = (item, approve, send = false) => {
    setForm({ amount: item.amount, txid: '', note: '' })
    setError(null)
    setSheet({ item, approve, send })
  }

  async function decide() {
    setBusy(true)
    setError(null)
    const { item, approve, send } = sheet
    const body = { note: form.note || undefined }
    if (isDep && approve) body.amount = form.amount
    if (!isDep && approve && !send) body.txid = form.txid
    try {
      await api.post(`/admin/${kind}/${item.id}/${send ? 'send' : approve ? 'approve' : 'reject'}`, body)
      setSheet(null)
      list.reload()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (v) => showToast((await copyText(v)) ? t('copied') : v)

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={status === 'pending'} onClick={() => setStatus('pending')}>{t('pending')}</button>
        {!isDep && chainOn && (
          <>
            <button type="button" className="chip" aria-pressed={status === 'sending'} onClick={() => setStatus('sending')}>{t('status_sending')}</button>
            <button type="button" className="chip" aria-pressed={status === 'failed'} onClick={() => setStatus('failed')}>{t('status_failed')}</button>
          </>
        )}
        <button type="button" className="chip" aria-pressed={status === ''} onClick={() => setStatus('')}>{t('all')}</button>
      </div>

      {list.loading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>{t('nothingPending')}</Empty>
      ) : (
        <div className="cards">
          {list.data.map((x) => (
            <article key={x.id} className="card stack" style={{ gap: 10 }}>
              <div className="between">
                <span className="strong">{x.username} <span className="caption num">#{x.id}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  {isDep && <span className="pill neutral">{t(`source_${x.source}`)}</span>}
                  {!isDep && x.auto && <span className="pill neutral">{t('autoSent')}</span>}
                  <span className={`pill ${TONE[x.status]}`}>{t(`status_${x.status}`)}</span>
                </span>
              </div>
              <span style={{ fontSize: 22, fontWeight: 800 }}>
                <span className="num">{usdt(x.amount)}</span> <span className="t-gold" style={{ fontSize: 13 }}>USDT</span>
                {!isDep && <span className="caption"> + {t('networkFee')} <span className="num">{usdt(x.fee)}</span></span>}
              </span>
              <div className="stack" style={{ gap: 4 }}>
                <span className="caption">{isDep ? 'TxID' : t('destAddress')}</span>
                <div className="row" style={{ gap: 6 }}>
                  <span className="mono grow">{isDep ? x.txid : x.address}</span>
                  <button type="button" className="icon-btn" style={{ width: 36, height: 36 }} aria-label={t('copy')} onClick={() => copy(isDep ? x.txid : x.address)}><Icon name="copy" size={16} /></button>
                </div>
                <a href={isDep ? tx(x.txid) : addr(x.address)} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12.5, fontWeight: 600 }}>{t('viewOnChain')} ↗</a>
                {x.txid && !isDep && <a href={tx(x.txid)} target="_blank" rel="noreferrer noopener" className="mono">{x.txid}</a>}
              </div>
              <span className="caption num">{when(x.createdAt)}</span>
              {!isDep && x.attempts > 0 && <span className="caption"><span className="num">{x.attempts}</span> {t('attempts')}</span>}
              {x.note && <span className="caption" style={{ overflowWrap: 'anywhere' }}>{t('note')}: {x.note}</span>}
              {(x.status === 'pending' || (!isDep && x.status === 'failed')) && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    {!isDep && chainOn ? (
                      <button type="button" className="btn btn-buy btn-sm grow" onClick={() => open(x, true, true)}>{x.status === 'failed' ? t('retrySend') : t('sendFromHot')}</button>
                    ) : (
                      <button type="button" className="btn btn-buy btn-sm grow" onClick={() => open(x, true)}>{t('approve')}</button>
                    )}
                    <button type="button" className="btn btn-danger btn-sm grow" onClick={() => open(x, false)}>{t('reject')}</button>
                  </div>
                  {!isDep && chainOn && (
                    <button type="button" className="btn-link" onClick={() => open(x, true)}>{t('manualTxid')}</button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {sheet && (
        <Sheet
          title={sheet.send ? t('sendFromHot') : sheet.approve ? (isDep ? t('approveDeposit') : t('approveWithdrawal')) : isDep ? t('rejectDeposit') : t('rejectWithdrawal')}
          onClose={() => setSheet(null)}
        >
          <div className="caption"><strong style={{ color: 'var(--text)' }}>{sheet.item.username}</strong> · <span className="num">{usdt(sheet.item.amount)}</span> USDT</div>
          {sheet.approve && (
            <div className="note gold">
              <Icon name="alert" size={18} />
              <span>{sheet.send ? t('confirmSendHot', { v: usdt(sheet.item.amount) }) : isDep ? t('checkOnChain') : t('sendFirst')}</span>
            </div>
          )}
          {sheet.send && <span className="mono">{sheet.item.address}</span>}
          {sheet.approve && isDep && (
            <div className="field">
              <label htmlFor="cr" className="label">{t('creditAmount')}</label>
              <div className="input-box sm"><input id="cr" dir="ltr" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /><span className="unit">USDT</span></div>
            </div>
          )}
          {sheet.approve && !isDep && !sheet.send && (
            <div className="field">
              <label htmlFor="stx" className="label">{t('sentTxid')}</label>
              <div className="input-box sm"><input id="stx" dir="ltr" value={form.txid} onChange={(e) => setForm({ ...form, txid: e.target.value.trim() })} spellCheck={false} /></div>
            </div>
          )}
          <div className="field">
            <label htmlFor="nt" className="label">{sheet.approve ? t('note') : t('noteRequired')}</label>
            <div className="input-box sm"><input id="nt" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} /></div>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button
            type="button"
            className={`btn ${sheet.approve ? 'btn-buy' : 'btn-sell'}`}
            disabled={busy || (!sheet.approve && !form.note.trim()) || (sheet.approve && !isDep && !sheet.send && !form.txid)}
            onClick={decide}
          >
            {t('confirm')}
          </button>
        </Sheet>
      )}
      <Toast msg={toast} />
    </div>
  )
}
