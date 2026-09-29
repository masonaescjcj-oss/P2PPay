# P2PPay

بازار همتا‌به‌همتا برای خرید و فروش **تتر (USDT)** با **افغانی** — با تضمین امانی و روش‌های پرداخت محلی.

A peer-to-peer USDT ⇄ AFN marketplace for Afghanistan with escrow, local payment methods and a Dari-first RTL web app.

| Folder | What |
|---|---|
| [`server/`](server/README.md) | API: accounts, USDT wallet ledger, offers, escrow trades, deposits/withdrawals, admin |
| `web/` | React 19 + Vite web app |
| [`supabase/`](supabase/migrations) | PostgreSQL schema (Supabase migrations) |
| [`DEPLOY.md`](DEPLOY.md) | راهنمای استقرار: Supabase + Fly.io (Mumbai) |
| [`BETA.md`](BETA.md) | بتای بسته: راه‌اندازی، راهنمای آزمایش‌کننده‌ها، شرط‌های پایان |
| [`RELEASE.md`](RELEASE.md) | چک‌لیست انتشار عمومی |
| [`ROADMAP.md`](ROADMAP.md) | نقشهٔ راه از صفر تا انتشار |

Design (mobile, dark + light): https://claude.ai/artifact/GNCwZ5ttvWxCZt3wc5TPJK

```bash
npm run install:all   # install server + web dependencies
npm test              # server tests
npm run dev:server    # API on :3000
npm run dev:web       # web app on :5173 (proxies /api to :3000)
```

### نسخهٔ آزمایشی در مرورگر (Browser test build)

`npm --prefix web run build:demo` → `web/dist-demo/`: the web app **plus the real server code** running in the page
(PGlite in IndexedDB, Node APIs replaced by small browser shims in `web/demo/shims`). Test USDT top-up, SMS codes on
screen, an admin account and three sample traders who pay/release by themselves. No real money; data stays in that
browser. Serve the folder with any static server, or publish `artifact.html` + `assets/`.

Requires Node.js ≥ 22.13. No database server is needed for development (embedded Postgres); production runs on Supabase.
