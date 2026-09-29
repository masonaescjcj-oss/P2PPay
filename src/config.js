'use strict';

const path = require('node:path');

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

module.exports = {
  port: int('PORT', 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'p2ppay.db'),
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
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  fiat: 'AFN',
  paymentMethods: ['hesabpay', 'mpaisa', 'mhawala', 'bank', 'hawala', 'cash'],
};
