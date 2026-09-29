import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Empty, Loading, Toast } from '../../components/Layout.jsx'
import Sheet from '../../components/Sheet.jsx'
import { api } from '../../lib/api.js'
import { copyText, useApi, useToast } from '../../lib/hooks.js'
import { usePrefs } from '../../lib/prefs.jsx'

const TABS = ['stats', 'invites', 'feedback', 'errors']
const when = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—')
const niceMax = (n) => {
  if (n <= 4) return Math.max(1, n)
  const p = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / p) * p
}

// One series per chart (small multiples), so no legend: the title names it. Time runs left → right.
function ColumnChart({ title, days, field, color, unit }) {
  const { t } = usePrefs()
  const max = niceMax(Math.max(0, ...days.map((d) => d[field])))
  const peak = days.reduce((a, d, i) => (d[field] > days[a][field] ? i : a), 0)
  return (
    <figure className="card stack" style={{ gap: 10, margin: 0 }}>
      <figcaption className="strong" style={{ fontSize: 14 }}>{title}</figcaption>
      <div className="colchart" dir="ltr" role="img" aria-label={`${title}: ${days.map((d) => `${d.day} ${d[field]}`).join(', ')}`}>
        <div className="yaxis num" aria-hidden="true"><span>{max}</span><span>{max / 2 === Math.round(max / 2) ? max / 2 : ''}</span><span>0</span></div>
        <div className="plot">
          {days.map((d, i) => {
            const h = max ? (d[field] / max) * 100 : 0
            return (
              <div key={d.day} className="slot" tabIndex={0} aria-label={`${d.day}: ${d[field]} ${unit}`}>
                <div className="bar" style={{ height: `${h}%`, background: color, minHeight: d[field] ? 3 : 0 }} />
                {i === peak && d[field] > 0 && <span className="cap num" style={{ bottom: `${h}%` }}>{d[field]}</span>}
                <span className={`tip num${i < 3 ? ' start' : i > days.length - 4 ? ' end' : ''}`} role="tooltip">{d.day.slice(5)} · {d[field]} {unit}</span>
              </div>
            )
          })}
        </div>
        <div className="xaxis num" aria-hidden="true">
          <span>{days[0]?.day.slice(5)}</span>
          <span>{days[Math.floor(days.length / 2)]?.day.slice(5)}</span>
          <span>{days.at(-1)?.day.slice(5)}</span>
        </div>
      </div>
      <details>
        <summary className="caption" style={{ cursor: 'pointer' }}>{t('showTable')}</summary>
        <table className="data-table num" dir="ltr">
          <thead><tr><th>{t('date')}</th><th>{title}</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d[field]}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

function Tile({ label, value, sub }) {
  return (
    <div className="card stat-tile">
      <span className="caption">{label}</span>
      <span className="v num">{value ?? '—'}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  )
}

function Stats() {
  const { t } = usePrefs()
  const st = useApi('/admin/beta', { interval: 30000 })
  if (st.loading) return <Loading />
  const d = st.data
  if (!d) return <Empty>{t('nothingPending')}</Empty>
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="note blue">
        <Icon name="flag" size={18} />
        <span>
          {d.beta.inviteOnly ? t('betaInviteOnlyOn') : t('betaInviteOnlyOff')}
          {' · '}{d.beta.maxTrade ? t('betaCap', { max: d.beta.maxTrade }) : t('betaNoCap')}
          {d.beta.maxOffer && <> · {t('betaOfferCap', { max: d.beta.maxOffer })}</>}
        </span>
      </div>
      <div className="stat-grid">
        <Tile label={t('bsUsers')} value={d.users.total} sub={t('bsNew7d', { n: d.users.new7d })} />
        <Tile label={t('bsVerified')} value={`${d.users.phoneVerified} / ${d.users.idVerified}`} sub={t('bsVerifiedSub')} />
        <Tile label={t('bsActive')} value={d.users.activeTraders7d} sub={t('bsLast7d')} />
        <Tile label={t('bsCompleted')} value={d.trades.completed} sub={t('bsOfTotal', { n: d.trades.total })} />
        <Tile label={t('completionRate')} value={d.trades.completionRate == null ? null : `${d.trades.completionRate}%`} sub={t('bsCancelled', { n: d.trades.cancelled })} />
        <Tile label={t('bsDisputeRate')} value={d.trades.disputeRate == null ? null : `${d.trades.disputeRate}%`} sub={t('bsDisputes', { n: d.trades.disputed })} />
        <Tile label={t('bsVolume')} value={`${d.trades.volume} USDT`} sub={`${d.trades.fiat} ؋`} />
        <Tile label={t('bsMedian')} value={d.trades.medianMinutes == null ? null : t('minutesShort', { n: d.trades.medianMinutes })} sub={t('bsMedianSub')} />
        <Tile label={t('bsInvites')} value={`${d.invites.used} / ${d.invites.capacity}`} sub={t('bsInvitesSub')} />
        <Tile label={t('bsFeedback')} value={d.feedback.open} sub={t('bsOfTotal', { n: d.feedback.total })} />
        <Tile label={t('bsErrors')} value={d.errors.open} sub={t('bsEvents', { n: d.errors.events })} />
      </div>
      <div className="charts">
        <ColumnChart title={t('chartSignups')} days={d.daily} field="signups" color="var(--chart-2)" unit={t('unitPeople')} />
        <ColumnChart title={t('chartCompleted')} days={d.daily} field="completed" color="var(--chart-1)" unit={t('unitTrades')} />
      </div>
    </div>
  )
}

function Invites() {
  const { t, errText } = usePrefs()
  const list = useApi('/admin/invites')
  const [form, setForm] = useState({ label: '', maxUses: '5', expiresInDays: '14' })
  const [created, setCreated] = useState(null)
  const [error, setError] = useState(null)
  const [toast, showToast] = useToast()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const link = (code) => `${location.origin}/register?invite=${code}`

  async function create(e) {
    e.preventDefault()
    setError(null)
    try {
      setCreated(await api.post('/admin/invites', { label: form.label, maxUses: Number(form.maxUses), expiresInDays: form.expiresInDays }))
      list.reload()
    } catch (err) {
      setError(errText(err))
    }
  }
  async function revoke(id) {
    try {
      await api.post(`/admin/invites/${id}/revoke`)
      list.reload()
    } catch (err) {
      showToast(errText(err))
    }
  }
  const copy = async (text) => showToast((await copyText(text)) ? t('copied') : text)

  return (
    <div className="stack" style={{ gap: 14 }}>
      <form className="card stack" style={{ gap: 12 }} onSubmit={create}>
        <strong>{t('newInvite')}</strong>
        <div className="field">
          <label htmlFor="il" className="label">{t('inviteLabel')}</label>
          <div className="input-box sm"><input id="il" value={form.label} onChange={set('label')} maxLength={80} placeholder={t('inviteLabelHint')} /></div>
        </div>
        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="iu" className="label">{t('inviteMaxUses')}</label>
            <div className="input-box sm"><input id="iu" dir="ltr" inputMode="numeric" value={form.maxUses} onChange={set('maxUses')} /></div>
          </div>
          <div className="field">
            <label htmlFor="ie" className="label">{t('inviteDays')}</label>
            <div className="input-box sm"><input id="ie" dir="ltr" inputMode="numeric" value={form.expiresInDays} onChange={set('expiresInDays')} /></div>
          </div>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary"><Icon name="plus" size={18} />{t('createInvite')}</button>
      </form>

      {list.loading ? <Loading /> : !list.data?.length ? <Empty>{t('noInvites')}</Empty> : (
        <div className="cards">
          {list.data.map((i) => (
            <article key={i.id} className="card stack" style={{ gap: 8, opacity: i.active ? 1 : 0.65 }}>
              <div className="between">
                <span className="mono" dir="ltr">••••-{i.hint}</span>
                <span className={`pill ${i.active ? 'green' : 'neutral'}`}>{i.revoked ? t('inviteRevoked') : i.active ? t('active') : t('inviteUsedUp')}</span>
              </div>
              {i.label && <strong style={{ fontSize: 14 }}>{i.label}</strong>}
              <div className="kv"><span>{t('inviteUses')}</span><span className="num">{i.uses} / {i.maxUses}</span></div>
              <div className="kv"><span>{t('inviteExpires')}</span><span className="num">{i.expiresAt ? when(i.expiresAt) : '—'}</span></div>
              <span className="caption">@{i.createdBy} · <span className="num">{when(i.createdAt)}</span></span>
              {i.active && <button type="button" className="btn btn-secondary btn-sm" onClick={() => revoke(i.id)}>{t('revoke')}</button>}
            </article>
          ))}
        </div>
      )}

      {created && (
        <Sheet title={t('inviteCreated')} onClose={() => setCreated(null)}>
          <p className="caption" style={{ lineHeight: 1.8 }}>{t('inviteShownOnce')}</p>
          <div className="card tight between" style={{ background: 'var(--sunken)' }}>
            <span className="mono" dir="ltr" style={{ fontSize: 20, letterSpacing: 2 }}>{created.code}</span>
            <button type="button" className="icon-btn" aria-label={t('copy')} onClick={() => copy(created.code)}><Icon name="copy" size={18} /></button>
          </div>
          <div className="card tight between" style={{ background: 'var(--sunken)' }}>
            <span className="mono" dir="ltr" style={{ fontSize: 12, wordBreak: 'break-all' }}>{link(created.code)}</span>
            <button type="button" className="icon-btn" aria-label={t('copyLink')} onClick={() => copy(link(created.code))}><Icon name="copy" size={18} /></button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setCreated(null)}>{t('done')}</button>
        </Sheet>
      )}
      <Toast msg={toast} />
    </div>
  )
}

const FB_TONE = { new: 'coral', seen: 'blue', done: 'green' }

function FeedbackList() {
  const { t, errText } = usePrefs()
  const [status, setStatus] = useState('new')
  const list = useApi(`/admin/feedback${status ? `?status=${status}` : ''}`, { interval: 30000 })
  const [sheet, setSheet] = useState(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState(null)

  async function update(f, body) {
    setError(null)
    try {
      await api.post(`/admin/feedback/${f.id}`, body)
      setSheet(null)
      list.reload()
    } catch (err) {
      setError(errText(err))
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="chips">
        {['new', 'seen', 'done', ''].map((s) => (
          <button key={s || 'all'} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? t(`fbStatus_${s}`) : t('all')}</button>
        ))}
      </div>
      {list.loading ? <Loading /> : !list.data?.length ? <Empty>{t('nothingPending')}</Empty> : (
        <div className="cards">
          {list.data.map((f) => (
            <article key={f.id} className="card stack" style={{ gap: 8 }}>
              <div className="between">
                <span className="pill neutral">{t(`fb_${f.kind}`)}</span>
                <span className={`pill ${FB_TONE[f.status]}`}>{t(`fbStatus_${f.status}`)}</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>{f.message}</p>
              <span className="caption" dir="ltr" style={{ textAlign: 'start' }}>@{f.username}{f.page ? ` · ${f.page}` : ''} · {when(f.createdAt)}</span>
              {f.reply && <div className="note green"><Icon name="chat" size={16} /><span>{f.reply} <span className="caption">— @{f.repliedBy}</span></span></div>}
              <div className="row" style={{ gap: 8 }}>
                {f.status === 'new' && <button type="button" className="btn btn-secondary btn-sm grow" onClick={() => update(f, { status: 'seen' })}>{t('markSeen')}</button>}
                <button type="button" className="btn btn-secondary btn-sm grow" onClick={() => { setReply(f.reply || ''); setError(null); setSheet(f) }}>{t('replyToUser')}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {sheet && (
        <Sheet title={t('replyToUser')} onClose={() => setSheet(null)}>
          <p style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }} className="muted">{sheet.message}</p>
          <div className="field">
            <label htmlFor="fr" className="label">{t('reply')}</label>
            <div className="input-box"><textarea id="fr" rows={4} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} /></div>
            <span className="hint">{t('replyVisible')}</span>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="button" className="btn btn-primary" disabled={!reply.trim()} onClick={() => update(sheet, { reply, status: 'done' })}>{t('sendReplyDone')}</button>
        </Sheet>
      )}
    </div>
  )
}

function Errors() {
  const { t, errText } = usePrefs()
  const [all, setAll] = useState(false)
  const list = useApi(`/admin/errors${all ? '?all=1' : ''}`, { interval: 30000 })
  const [toast, showToast] = useToast()
  async function resolve(id) {
    try {
      await api.post(`/admin/errors/${id}/resolve`)
      list.reload()
    } catch (err) {
      showToast(errText(err))
    }
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={!all} onClick={() => setAll(false)}>{t('errorsOpen')}</button>
        <button type="button" className="chip" aria-pressed={all} onClick={() => setAll(true)}>{t('all')}</button>
      </div>
      {list.loading ? <Loading /> : !list.data?.length ? <Empty>{t('noErrors')}</Empty> : (
        <div className="cards">
          {list.data.map((e) => (
            <article key={e.id} className="card stack" style={{ gap: 8, opacity: e.resolved ? 0.65 : 1 }}>
              <div className="between">
                <span className={`pill ${e.source === 'server' ? 'coral' : 'gold'}`}>{t(`errSource_${e.source}`)}</span>
                <span className="caption num">×{e.count}</span>
              </div>
              <strong className="mono" dir="ltr" style={{ fontSize: 13, textAlign: 'start', wordBreak: 'break-word' }}>{e.message}</strong>
              <span className="caption" dir="ltr" style={{ textAlign: 'start' }}>{e.page || '—'}{e.username ? ` · @${e.username}` : ''}</span>
              <div className="kv"><span>{t('lastSeen')}</span><span className="num">{when(e.lastSeen)}</span></div>
              <div className="kv"><span>{t('firstSeen')}</span><span className="num">{when(e.firstSeen)}</span></div>
              {e.stack && (
                <details>
                  <summary className="caption" style={{ cursor: 'pointer' }}>{t('stackTrace')}</summary>
                  <pre className="stack-trace" dir="ltr">{e.stack}</pre>
                </details>
              )}
              {e.userAgent && <span className="caption" dir="ltr" style={{ textAlign: 'start', fontSize: 11 }}>{e.userAgent}</span>}
              {!e.resolved && <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolve(e.id)}>{t('markResolved')}</button>}
            </article>
          ))}
        </div>
      )}
      <Toast msg={toast} />
    </div>
  )
}

export default function AdminBeta() {
  const { t } = usePrefs()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'stats'
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="seg" role="tablist" aria-label={t('beta')}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}>{t(`betaTab_${k}`)}</button>
        ))}
      </div>
      {tab === 'stats' && <Stats />}
      {tab === 'invites' && <Invites />}
      {tab === 'feedback' && <FeedbackList />}
      {tab === 'errors' && <Errors />}
    </div>
  )
}
