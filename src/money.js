'use strict';

// All USDT amounts are stored as integer micro-units (6 decimals, like USDT on Tron).
// All AFN amounts are stored as integer cents ("puls", 2 decimals).

const USDT_DECIMALS = 6;
const AFN_DECIMALS = 2;

function parseUnits(value, decimals) {
  if (typeof value === 'number') value = String(value);
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/[,٬]/g, '');
  // Accept Persian/Arabic digits too.
  const normalized = s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.split('.');
  if (frac.length > decimals) return null;
  const n = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(n);
}

function formatUnits(n, decimals) {
  const neg = n < 0;
  const b = BigInt(Math.abs(n));
  const base = 10n ** BigInt(decimals);
  const whole = b / base;
  let frac = (b % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

const parseUsdt = (v) => parseUnits(v, USDT_DECIMALS);
const parseAfn = (v) => parseUnits(v, AFN_DECIMALS);
const fmtUsdt = (n) => formatUnits(n, USDT_DECIMALS);
const fmtAfn = (n) => formatUnits(n, AFN_DECIMALS);

// fiat cents = usdt micro * price (cents per 1 USDT) / 1e6, rounded half up.
function fiatFor(usdtMicro, priceCents) {
  const num = BigInt(usdtMicro) * BigInt(priceCents);
  const den = 10n ** BigInt(USDT_DECIMALS);
  return Number((num + den / 2n) / den);
}

// usdt micro for a fiat amount, rounded down so the buyer never gets more than paid for.
function usdtFor(fiatCents, priceCents) {
  return Number((BigInt(fiatCents) * 10n ** BigInt(USDT_DECIMALS)) / BigInt(priceCents));
}

function feeFor(usdtMicro, bps) {
  return Number((BigInt(usdtMicro) * BigInt(bps)) / 10000n);
}

module.exports = { parseUsdt, parseAfn, fmtUsdt, fmtAfn, fiatFor, usdtFor, feeFor };
