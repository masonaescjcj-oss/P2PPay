import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Girih, TetherMark } from '../components/Brand.jsx'
import Icon from '../components/Icon.jsx'
import { LedgerRow } from '../components/LedgerRow.jsx'
import { Empty, Loading, TabBar } from '../components/Layout.jsx'
import { dayKey, toNum, usdt } from '../lib/format.js'
import { useApi } from '../lib/hooks.js'
import { usePrefs } from '../lib/prefs.jsx'

const FILTERS = {
  all: () => true,
  deposit: (l) => l.kind === 'deposit',
  withdraw: (l) => l.kind.startsWith('withdraw'),
  trade: (l) => l.kind.startsWith('trade') || l.kind.startsWith('escrow') || l.kind.startsWith('offer'),
}

export default function Wallet() {
  const { t } = usePrefs()
  const w = useApi('/wallet', { interval: 15000 })
  const [filter, setFilter] = useState('all')

  const d = w.data
  const availPct = d && toNum(d.total) > 0 ? (toNum(d.available) / toNum(d.total)) * 100 : 100
  const rows = (d?.ledger || []).filter(FILTERS[filter])
  const groups = []
  for (const r of rows) {
    const k = dayKey(r.createdAt)
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, rows: [] })
    groups[groups.length - 1].rows.push(r)
  }

  return (
    <>
      <main className="page with-tabs">
        <div className="between">
          <h1 className="h1">{t('wallet')}</h1>
          <span className="pill neutral" style={{ height: 32, borderRadius: 16 }}>
            <span className="swatch" style={{ background: 'var(--green)', borderRadius: 4 }} />
            {t('network')} <span dir="ltr">TRC20</span>
          </span>
        </div>

        {w.loading ? (
          <Loading />
        ) : (
          <section className="balance-card" style={{ gap: 14 }}>
            <Girih id="girih-w" />
            <div className="row">
              <TetherMark size={36} />
              <div className="stack" style={{ gap: 1 }}>
                <strong style={{ fontSize: 15 }}>{t('tether')}</strong>
                <span dir="ltr" style={{ fontSize: 12, color: 'var(--lapis-muted)' }}>Tether USD</span>
              </div>
            </div>
            <div dir="ltr" className="row" style={{ alignItems: 'baseline', gap: 8, justifyContent: 'flex-end' }}>
              <span className="num" style={{ fontSize: 34, fontWeight: 800 }}>{usdt(d?.total)}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#E9B44C' }}>USDT</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="meter" role="img" aria-label={`${t('available')} ${usdt(d?.available)} · ${t('inEscrow')} ${usdt(d?.locked)}`}>
                <span style={{ width: `${availPct}%`, background: 'var(--green)' }} />
                <span style={{ width: `${100 - availPct}%`, background: 'var(--gold)' }} />
              </div>
              <div className="between" style={{ fontSize: 12, color: 'var(--lapis-text-2)' }}>
                <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--green)' }} />{t('available')} <strong className="num" style={{ color: 'var(--lapis-text)' }}>{usdt(d?.available)}</strong></span>
                <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--gold)' }} />{t('inEscrow')} <strong className="num" style={{ color: 'var(--lapis-text)' }}>{usdt(d?.locked)}</strong></span>
              </div>
            </div>
          </section>
        )}

        <div className="grid-2">
          <Link to="/deposit" className="btn btn-primary" style={{ height: 54 }}><Icon name="down" stroke={2.2} size={18} />{t('deposit')}</Link>
          <Link to="/withdraw" className="btn btn-secondary"><Icon name="up" stroke={2.2} size={18} />{t('withdraw')}</Link>
        </div>

        <div className="chips">
          {[['all', t('all')], ['deposit', t('deposit')], ['withdraw', t('withdraw')], ['trade', t('memberTrades')]].map(([k, label]) => (
            <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>

        {groups.length ? (
          groups.map((g) => (
            <section key={g.k} className="stack" style={{ gap: 0 }}>
              <h2 className="caption strong" style={{ paddingBottom: 4 }}>{g.k === 'today' || g.k === 'yesterday' ? t(g.k) : <span className="num">{g.k}</span>}</h2>
              {g.rows.map((l) => <LedgerRow key={l.id} entry={l} />)}
            </section>
          ))
        ) : (
          !w.loading && <Empty>{t('noActivity')}</Empty>
        )}
      </main>
      <TabBar />
    </>
  )
}
