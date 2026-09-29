# P2PPay server

Express 5 + Node.js 22 built-in SQLite (`node:sqlite`). Only one runtime dependency: `express`.

```bash
cd server
cp .env.example .env   # set ADMIN_USERNAME / ADMIN_PASSWORD / DEPOSIT_ADDRESS
npm install
npm run dev            # http://localhost:3000
npm test
```

If `web/dist` exists (after `npm run build` in `web/`), the server also serves the web app.

## Money

- USDT amounts are integers in micro-USDT (6 decimals); AFN amounts are integers in cents (2 decimals).
- The API accepts and returns amounts as **decimal strings** (`"141.14"`). Persian/Arabic digits are accepted on input.
- Every balance change writes an append-only row in `ledger`. `balances.available` / `balances.locked` can never go negative (DB `CHECK`).

## Escrow model

| Offer side | Seller | USDT locked when | On cancel / expiry |
|---|---|---|---|
| `sell` (maker sells USDT) | maker | offer is created (whole `total`) | amount returns to the offer (or the seller's balance if the offer is closed) |
| `buy` (maker buys USDT) | taker | trade is opened | amount is unlocked back to the seller |

Trade states: `pending_payment → paid → completed`, or `cancelled` (buyer cancel / payment window expired / admin), or `paid → disputed → completed | cancelled` (admin decides).
The trade fee (`TRADE_FEE_BPS`, default 0.1%) is deducted from the USDT the buyer receives.

## Auth

Session cookie (`HttpOnly`, `SameSite=Strict`). Every non-GET request must be `Content-Type: application/json` (CSRF guard).
Errors are `{"error": "<code>"}` with an HTTP status; the web app maps codes to Dari/Pashto/English messages.

## Endpoints (`/api`)

| Method | Path | Who | Body / query |
|---|---|---|---|
| GET | `/config` | public | – |
| POST | `/auth/register` | public | `username, password, displayName?, phone?` |
| POST | `/auth/login` | public | `username, password` |
| POST | `/auth/logout` | user | – |
| GET | `/me` | user | – |
| GET | `/wallet` | user | balances, ledger, deposits, withdrawals |
| POST | `/deposits` | user | `amount, txid` |
| POST | `/withdrawals` | user | `amount, address` (TRC20) |
| GET | `/offers` | public | `side=buy\|sell` (visitor's side), `paymentMethod?`, `fiat?` |
| GET | `/offers/mine` | user | – |
| GET | `/offers/:id` | public | – |
| POST | `/offers` | user | `side, price, total, minFiat, maxFiat, paymentMethods[], terms?, paymentWindow?` |
| POST | `/offers/:id/status` | owner | `status=active\|paused\|closed` |
| POST | `/offers/:id/trades` | user | `amount` (USDT) **or** `fiat` (AFN), `paymentMethod?` |
| GET | `/trades` | user | – |
| GET | `/trades/:id` | party | – |
| POST | `/trades/:id/pay` | buyer | – |
| POST | `/trades/:id/release` | seller | – |
| POST | `/trades/:id/cancel` | buyer | – |
| POST | `/trades/:id/dispute` | party | `reason` |
| GET/POST | `/trades/:id/messages` | party | `after?` / `body` |
| GET | `/admin/overview` | admin | – |
| GET | `/admin/deposits`, `/admin/withdrawals`, `/admin/trades` | admin | `status?` |
| POST | `/admin/deposits/:id/approve\|reject` | admin | `amount?, note?` |
| POST | `/admin/withdrawals/:id/approve\|reject` | admin | `txid` (approve), `note?` |
| POST | `/admin/trades/:id/resolve` | admin | `winner=buyer\|seller, note?` |
| GET | `/admin/users` | admin | – |
| POST | `/admin/users/:id/block` | admin | `blocked` |

Payment method codes: `hesabpay, mpaisa, mhawala, bank, hawala, cash`.

## Known limitations (tracked in ROADMAP.md)

- Deposits use one shared platform address and are approved by an admin who checks the chain. A shared address cannot prove *who* sent a deposit, so per-user deposit addresses (phase 5) are required before public launch.
- Withdrawals are sent manually by an admin and the txid is recorded.
- Rate limiting is in-memory (single process).
