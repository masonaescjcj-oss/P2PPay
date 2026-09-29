'use strict';

const path = require('node:path');

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

const NETWORKS = {
  nile: { apiUrl: 'https://nile.trongrid.io', usdt: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', explorer: 'https://nile.tronscan.org' },
  mainnet: { apiUrl: 'https://api.trongrid.io', usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', explorer: 'https://tronscan.org' },
};
const network = process.env.TRON_NETWORK || 'off';
if (network !== 'off' && !NETWORKS[network]) throw new Error(`TRON_NETWORK must be off, nile or mainnet (got ${network})`);
if (network === 'mainnet' && process.env.TRON_MAINNET_CONFIRM !== 'yes') {
  throw new Error('Refusing to start on TRON mainnet without TRON_MAINNET_CONFIRM=yes');
}
const net = NETWORKS[network] || NETWORKS.mainnet;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  port: int('PORT', 3000),
  dataDir: DATA_DIR,
  // PostgreSQL (Supabase in production). Use the session pooler (port 5432) or the direct connection:
  // the chain loop holds a session-level advisory lock, which the transaction pooler (6543) cannot keep.
  databaseUrl: process.env.DATABASE_URL || '',
  // Supabase CA certificate for verified TLS: a file path, or the PEM itself (e.g. a Fly.io secret).
  databaseCaPath: process.env.DATABASE_CA_PATH || '',
  databaseCa: process.env.DATABASE_CA || '',
  databasePoolSize: int('DATABASE_POOL_SIZE', 10),
  // Without DATABASE_URL: embedded Postgres (PGlite) in this folder — development only.
  pgliteDir: process.env.PGLITE_DIR || path.join(DATA_DIR, 'pglite'),
  migrateOnStart: process.env.MIGRATE_ON_START !== '0',
  // Platform USDT deposit address shown to users (TRC20 / Tron network).
  depositAddress: process.env.DEPOSIT_ADDRESS || 'TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  network: 'TRC20',
  // Trade fee in basis points (10 = 0.1%), deducted from the USDT the buyer receives.
  tradeFeeBps: int('TRADE_FEE_BPS', 10),
  // Flat network fee for withdrawals, in micro-USDT (1 USDT = 1_000_000).
  withdrawFeeMicro: int('WITHDRAW_FEE_MICRO', 1_000_000),
  minWithdrawMicro: int('MIN_WITHDRAW_MICRO', 5_000_000),
  // Default time the buyer has to pay after opening a trade.
  defaultPaymentWindowMin: int('PAYMENT_WINDOW_MIN', 30),
  sessionDays: int('SESSION_DAYS', 14),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  // Proxies in front of the app whose X-Forwarded-For is trusted: a hop count (Fly.io: 1) or Express names.
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY || 'loopback',
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  fiat: 'AFN',
  paymentMethods: ['hesabpay', 'mpaisa', 'mhawala', 'bank', 'hawala', 'cash'],

  nodeEnv: process.env.NODE_ENV || 'development',
  // 64 hex chars (32 bytes). Encrypts TOTP secrets and KYC documents. Required in production.
  dataKey: process.env.DATA_ENCRYPTION_KEY || '',
  // Encrypted KYC documents: local folder (development) or a private Supabase Storage bucket.
  kycDir: process.env.KYC_DIR || path.join(DATA_DIR, 'kyc'),
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    url: process.env.SUPABASE_URL || '',
    // Secret: server-side only, never sent to the browser.
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.KYC_BUCKET || 'kyc',
  },
  sms: {
    // console = print codes to the server log (development only); twilio = send real SMS
    provider: process.env.SMS_PROVIDER || 'console',
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
  },
  // Staff (admin, finance, support) must use an authenticator app to act.
  requireStaff2fa: process.env.REQUIRE_STAFF_2FA !== '0',
  // Rolling 24h limits per KYC tier, in micro-USDT: trade volume (as buyer or seller) and withdrawals.
  kycLimits: {
    0: { trade: 0, withdraw: 0 },
    1: { trade: int('LIMIT_TIER1_MICRO', 1_000_000_000), withdraw: int('LIMIT_TIER1_MICRO', 1_000_000_000) },
    2: { trade: int('LIMIT_TIER2_MICRO', 20_000_000_000), withdraw: int('LIMIT_TIER2_MICRO', 20_000_000_000) },
    3: { trade: int('LIMIT_TIER3_MICRO', 200_000_000_000), withdraw: int('LIMIT_TIER3_MICRO', 200_000_000_000) },
  },
  alertLargeTradeMicro: int('ALERT_LARGE_TRADE_MICRO', 5_000_000_000),

  // Protection against fake accounts collecting sellers' payment accounts.
  safety: {
    // New sell offers ask the seller to approve each buyer before the account is shown.
    requireAcceptByDefault: process.env.OFFER_REQUIRE_ACCEPT_DEFAULT !== '0',
    acceptWindowMin: int('ACCEPT_WINDOW_MIN', 10),
    // Cancels (or expiries) after seeing a seller's account, per rolling 24h, before trading pauses.
    revealCancelLimit: int('REVEAL_CANCEL_LIMIT', 3),
    freezeDays: int('TRADE_FREEZE_DAYS', 7),
    // New accounts (younger than N days and fewer than M completed trades) trade small amounts only.
    newAccountDays: int('NEW_ACCOUNT_DAYS', 7),
    newAccountTrades: int('NEW_ACCOUNT_TRADES', 3),
    newAccountMaxMicro: int('NEW_ACCOUNT_MAX_TRADE_MICRO', 50_000_000),
  },

  // Web Push (phone notifications). Generate once: npx web-push generate-vapid-keys
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:support@p2ppay.example',
  },

  // Terms of use + privacy notice version users must accept (bump it when the texts change).
  termsVersion: process.env.TERMS_VERSION || '2026-10-01',
  // Shown on the support page; empty entries are hidden.
  support: {
    email: process.env.SUPPORT_EMAIL || '',
    phone: process.env.SUPPORT_PHONE || '',
    telegram: process.env.SUPPORT_TELEGRAM || '',
    hours: process.env.SUPPORT_HOURS || '',
  },

  // Closed beta: sign-up only with an invite code, and small caps per trade and per offer (0 = no cap).
  beta: {
    inviteOnly: process.env.BETA_INVITE_ONLY === '1',
    maxTradeMicro: int('BETA_MAX_TRADE_MICRO', 0),
    maxOfferMicro: int('BETA_MAX_OFFER_MICRO', 0),
    label: process.env.BETA_LABEL || '',
  },

  // On-chain mode. 'off' keeps the manual flow (shared DEPOSIT_ADDRESS, admin records txids).
  tron: {
    network,
    apiUrl: process.env.TRONGRID_URL || net.apiUrl,
    apiKey: process.env.TRONGRID_API_KEY || '',
    explorer: net.explorer,
    usdtContract: process.env.USDT_CONTRACT || net.usdt,
    // Secret: never commit it, never log it. See server/README.md "Keys".
    mnemonic: process.env.WALLET_MNEMONIC || '',
    coldAddress: process.env.COLD_WALLET_ADDRESS || '',
    hotMaxMicro: int('HOT_WALLET_MAX_MICRO', 5_000_000_000),
    autoWithdrawMaxMicro: int('AUTO_WITHDRAW_MAX_MICRO', 200_000_000),
    dailyAutoMaxMicro: int('DAILY_AUTO_WITHDRAW_MAX_MICRO', 2_000_000_000),
    minDepositMicro: int('MIN_DEPOSIT_MICRO', 1_000_000),
    sweepMinMicro: int('SWEEP_MIN_MICRO', 20_000_000),
    sweepTopupSun: int('SWEEP_TOPUP_SUN', 35_000_000),
    sweepTrxMinSun: int('SWEEP_TRX_MIN_SUN', 30_000_000),
    feeLimitSun: int('FEE_LIMIT_SUN', 60_000_000),
    intervalMs: int('CHAIN_INTERVAL_MS', 20_000),
    watchHours: int('DEPOSIT_WATCH_HOURS', 48),
  },
};
