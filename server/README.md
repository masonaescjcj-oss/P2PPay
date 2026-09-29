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

Session cookie (`HttpOnly`, `SameSite=Strict`). Every non-GET request must be `Content-Type: application/json` (CSRF guard); the only exception is KYC image upload, which must carry `x-p2ppay-upload: 1` (a header a cross-site form cannot set).
Errors are `{"error": "<code>"}` with an HTTP status; the web app maps codes to Dari/English messages.

## Security & compliance

| Area | How it works |
|---|---|
| Phone verification | `POST /me/phone` sends a 6-digit SMS code (5 min, 5 attempts, stored as an HMAC), `POST /me/phone/verify` confirms it. One verified number per account. Grants KYC tier 1. |
| Authenticator 2FA | RFC 6238 TOTP (tested against the RFC vectors). Secrets are encrypted at rest; codes cannot be replayed. Enabling returns 10 one-time backup codes and signs out other sessions. |
| Login | `POST /auth/login` → `{ twoFactor, challenge }` when 2FA is on → `POST /auth/login/2fa`. Wrong passwords **and** wrong 2FA codes share a counter: 8 failures lock the account for 15 minutes. Password change signs out other sessions. |
| Withdrawals | Every withdrawal needs a fresh second factor: the authenticator code, or an SMS code from `POST /withdrawals/code`. Backup codes are not accepted here. |
| KYC tiers | 0 = registered (deposit only), 1 = phone verified, 2 = tazkira/passport + selfie approved by staff, 3 = merchant. Each tier has a rolling 24h limit for trade volume (checked for **both** sides of a trade) and withdrawals (`LIMIT_TIER*_MICRO`). Posting offers needs tier 1. |
| KYC documents | `POST /kyc/submission` → upload `front`, `back` (optional), `selfie` as raw images (JPEG/PNG/WebP, magic bytes checked, ≤ 5 MB; the web app downsizes photos) → `POST /kyc/submission/:id/submit`. Files are AES-256-GCM encrypted in `KYC_DIR`; staff view them through `GET /admin/kyc/:id/files/:kind` only. |
| Staff roles | `admin` (everything, incl. staff management), `finance` (deposits, withdrawals, hot wallet, audit log), `support` (disputes, users, KYC, alerts). With `REQUIRE_STAFF_2FA=1` (default) staff must have 2FA on. Nobody can review their own request or change their own role; role changes sign the user out. |
| Alerts | Rules raise one open alert per user and rule: `pass_through` (deposit leaves again within 2h without trading), `shared_address` (withdrawal address used by another account), `large_trade`, `many_cancels`, `many_disputes`, `auth_failures`. Staff close them with a note; every staff decision is in the audit log. |
| Data key | `DATA_ENCRYPTION_KEY` (required in production) encrypts TOTP secrets and KYC files and keys the code HMACs. Back it up: without it those records cannot be read. |

## Endpoints (`/api`)

| Method | Path | Who (admin routes: permission) | Body / query |
|---|---|---|---|
| GET | `/config` | public | – |
| POST | `/auth/register` | public | `username, password, displayName?, phone?` |
| POST | `/auth/login` | public | `username, password` |
| POST | `/auth/login/2fa` | public | `challenge, code` |
| POST | `/auth/logout` | user | – |
| GET | `/me` | user | profile, role/perms, phone and 2FA state, KYC tier/limits/usage |
| GET | `/me/security` | user | phone, 2FA, backup codes left, recent security events |
| POST | `/me/phone`, `/me/phone/verify` | user | `phone` / `code` |
| POST | `/me/totp/setup`, `/me/totp/enable`, `/me/totp/disable`, `/me/totp/backup-codes` | user | – / `code` |
| POST | `/me/password` | user | `current, next` |
| GET | `/kyc` | user | tier, limits, 24h usage, latest submission |
| POST | `/kyc/submission`, `/kyc/submission/:id/files/:kind`, `/kyc/submission/:id/submit` | user | details / raw image / – |
| GET | `/wallet` | user | balances, ledger, deposits, withdrawals |
| POST | `/deposits` | user | `amount, txid` (manual mode only) |
| GET | `/deposit-address` | user | personal TRC20 address (chain mode) |
| POST | `/deposit-address/check` | user | scan it now; returns `{credited}` |
| POST | `/withdrawals/code` | user | sends an SMS code (users without 2FA) |
| POST | `/withdrawals` | user | `amount, address` (TRC20), `code` |
| GET | `/payment-accounts` | user | – |
| POST | `/payment-accounts` | user | `method, holderName, account` (upsert per method) |
| POST | `/payment-accounts/:id/delete` | owner | – |
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
| POST | `/admin/withdrawals/:id/send` | admin | chain mode: send (or retry) from the hot wallet |
| GET | `/admin/chain` | admin | hot wallet and chain loop status |
| GET | `/admin/actions` | admin | audit log |
| POST | `/admin/trades/:id/resolve` | admin | `winner=buyer\|seller, note?` |
| GET | `/admin/users` | users | `q?` |
| POST | `/admin/users/:id/block` | users | `blocked` |
| POST | `/admin/users/:id/tier` | kyc | `tier` |
| POST | `/admin/users/:id/role` | staff | `role=user\|support\|finance\|admin` |
| GET | `/admin/kyc`, `/admin/kyc/:id/files/:kind` | kyc | `status?` |
| POST | `/admin/kyc/:id/approve\|reject` | kyc | `tier` / `reason` |
| GET | `/admin/alerts` | alerts | `status?` |
| POST | `/admin/alerts/:id/close` | alerts | `note` |

Payment method codes: `hesabpay, mpaisa, mhawala, bank, hawala, cash`.

A seller must have a payment account for every method of a sell offer (and a taker selling into a buy offer for the chosen method); the trade view shows the buyer the seller's `paymentAccount` for the chosen method.

## On-chain mode (TRON, USDT TRC20)

`TRON_NETWORK=off` (default) keeps the manual flow: one shared `DEPOSIT_ADDRESS`, users submit a TxID, an admin approves.
With `TRON_NETWORK=nile` (testnet) or `mainnet` the server runs a chain loop every `CHAIN_INTERVAL_MS`:

| Flow | What happens |
|---|---|
| Deposit | Each user gets a personal address (`GET /api/deposit-address`, HD path `m/44'/195'/0'/0/<user id>`). The scanner reads confirmed incoming USDT transfers from TronGrid, **re-verifies each one against the solidified node's event log** (token, recipient, amount), and credits it once (unique txid+address). Other tokens, zero-value spam and amounts below `MIN_DEPOSIT_MICRO` are not credited. |
| Withdrawal | Requests up to `AUTO_WITHDRAW_MAX_MICRO` from accounts older than 24h are sent automatically within `DAILY_AUTO_WITHDRAW_MAX_MICRO`; everything else waits for an admin to press *Send from hot wallet* (`POST /api/admin/withdrawals/:id/send`). Funds stay locked while `sending` and are burned only when the tx is solidified. |
| Sweep | A deposit address holding ≥ `SWEEP_MIN_MICRO` gets a TRX top-up from the hot wallet for fees, then its USDT is moved to the hot wallet — or to `COLD_WALLET_ADDRESS` once the hot wallet holds more than `HOT_WALLET_MAX_MICRO`. |

Transaction safety:

- Transactions are **built and signed locally** (`src/tron/tx.js`, protobuf by hand); the node only provides a recent block reference, so it cannot change recipient or amount. Encoding, txIDs and signatures are cross-checked against `tronweb` in `test/tron.test.js`, and a signed transaction was accepted by the live Nile network's signature check.
- A withdrawal is saved as `sending` with its txid and expiry **before** broadcast. It becomes `failed` only when the chain shows it reverted, the node rejected it, or it expired unseen. A failed withdrawal can be retried or refunded only once its last signed tx provably can no longer land (`retry_later` otherwise); if it did land, it is settled as `sent` instead of being paid twice.
- Withdrawals to the platform's own hot/cold wallet are refused.

### Keys

- `npm run wallet:new` prints a new 24-word mnemonic and the hot wallet address. Do it on a trusted machine and store the words offline.
- The server reads it only from `WALLET_MNEMONIC`. Never commit it or put it in the repo `.env`; in production inject it from the host's secret manager.
- Keep only working capital in the hot wallet (TRX for fees + some USDT). Set `COLD_WALLET_ADDRESS` to a wallet whose keys are **not** on the server.
- Mainnet requires `TRON_MAINNET_CONFIRM=yes`. Test everything on Nile first (test TRX/USDT: https://nileex.io/join/getJoinPage).

### Admin

`GET /api/admin/chain` — network, hot wallet address and live USDT/TRX balances, auto-send usage, addresses awaiting sweep, withdrawals sending/failed, last loop time and error.

## Known limitations (tracked in ROADMAP.md)

- A single TronGrid provider is trusted for chain data; for large volumes run your own full node or cross-check a second provider.
- The mnemonic lives in the server process; a separate signing service / HSM is the next step for larger balances.
- Rate limiting is in-memory (single process).
