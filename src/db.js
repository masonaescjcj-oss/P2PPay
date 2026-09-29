'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- Balances in micro-USDT. "locked" is held in escrow / pending withdrawal.
CREATE TABLE IF NOT EXISTS balances (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked >= 0)
);

-- Append-only ledger. user_id NULL = platform (fees).
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,
  available_delta INTEGER NOT NULL,
  locked_delta INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  network TEXT NOT NULL,
  txid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  fee INTEGER NOT NULL,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','rejected')),
  txid TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

-- side: 'sell' = maker sells USDT (maker's USDT locked up front), 'buy' = maker buys USDT.
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  price INTEGER NOT NULL CHECK (price > 0),
  total INTEGER NOT NULL CHECK (total > 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  min_fiat INTEGER NOT NULL,
  max_fiat INTEGER NOT NULL,
  payment_methods TEXT NOT NULL,
  terms TEXT NOT NULL DEFAULT '',
  payment_window INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_market ON offers(status, side, price);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  maker_id INTEGER NOT NULL REFERENCES users(id),
  taker_id INTEGER NOT NULL REFERENCES users(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  price INTEGER NOT NULL,
  fiat INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_payment','paid','disputed','completed','cancelled')),
  dispute_reason TEXT,
  resolution TEXT,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  closed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_buyer ON trades(buyer_id);
CREATE INDEX IF NOT EXISTS trades_seller ON trades(seller_id);
CREATE INDEX IF NOT EXISTS trades_status ON trades(status, expires_at);

CREATE TABLE IF NOT EXISTS trade_messages (
  id INTEGER PRIMARY KEY,
  trade_id INTEGER NOT NULL REFERENCES trades(id),
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_trade ON trade_messages(trade_id, id);
`;

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  let depth = 0;
  // Run fn inside a transaction; nested calls join the outer one.
  db.tx = (fn) => {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      depth--;
    }
  };
  return db;
}

module.exports = { open };
