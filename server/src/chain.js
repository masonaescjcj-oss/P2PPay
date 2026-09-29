'use strict';

// On-chain USDT (TRC20) operations:
//  - a deposit address per user, scanned for confirmed incoming transfers (credited once, idempotently)
//  - withdrawals sent from the hot wallet: automatically below limits, or when an admin sends them
//  - sweeps: TRX top-up of a deposit address for fees, then its USDT moved to the hot (or cold) wallet
//
// Safety rules:
//  - a transaction is recorded as "sending" (with its txid and expiry) BEFORE it is broadcast, and a
//    row only moves "sending → pending/failed" once the chain proves the tx can no longer land;
//  - locked user funds are burned only when the withdrawal is confirmed (solidified) on chain.
const { createKeyring, isAddress, addressToBytes } = require('./tron/keys');
const txb = require('./tron/tx');
const { bad, conflict, notFound } = require('./errors');

const DAY = 86_400_000;
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex20 = (address) => Buffer.from(addressToBytes(address)).toString('hex').slice(2);
const EXPIRY_GRACE = 5 * 60_000;

function createChain(db, wallet, config, { client, log = console }) {
  const c = config.tron;
  const keyring = createKeyring(c.mnemonic);
  const now = () => Date.now();
  let lastTickAt = 0;
  let lastError = null;
  let hotCache = null;

  if (c.coldAddress && !isAddress(c.coldAddress)) throw new Error('COLD_WALLET_ADDRESS is not a valid TRON address');

  // ---------- deposit addresses ----------
  const getAddr = db.prepare('SELECT * FROM deposit_addresses WHERE user_id = ?');

  function depositAddress(userId) {
    let row = getAddr.get(userId);
    if (!row) {
      const address = keyring.depositAddress(userId);
      db.prepare('INSERT INTO deposit_addresses (user_id, address, derivation_index, created_at) VALUES (?, ?, ?, ?)').run(
        userId, address, userId, now()
      );
      row = getAddr.get(userId);
    }
    // Watch it closely for a while after the user has seen it.
    db.prepare('UPDATE deposit_addresses SET watch_until = ? WHERE user_id = ?').run(now() + c.watchHours * 3_600_000, userId);
    return row.address;
  }

  // Sending to the platform's own hot/cold wallet would never be credited to anyone.
  const isPlatformAddress = (a) => a === keyring.hotAddress || (!!c.coldAddress && a === c.coldAddress);

  // Cheap checks on what the index API reported; returns the amount or null.
  function candidate(row, t) {
    if (t.to !== row.address || t.contract !== c.usdtContract || t.type !== 'Transfer') return null;
    let value;
    try {
      value = BigInt(t.value);
    } catch {
      return null;
    }
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const seen = db.prepare("SELECT 1 FROM deposits WHERE txid = ? AND (address = ? OR source = 'manual')").get(t.txid, row.address);
    return seen ? null : Number(value);
  }

  // Confirms on the solidified node that this tx emitted USDT Transfer(_, address, amount).
  async function verifiedOnChain(row, t, amount) {
    const r = await client.getConfirmedLogs(t.txid);
    if (!r || !r.ok) return false;
    const token = hex20(c.usdtContract);
    const to = hex20(row.address).padStart(64, '0');
    const want = BigInt(amount);
    return r.logs.some(
      (l) =>
        String(l.address).toLowerCase().replace(/^41/, '') === token &&
        String(l.topics[0]).toLowerCase() === TRANSFER_TOPIC &&
        String(l.topics[2]).toLowerCase() === to &&
        BigInt('0x' + (l.data || '0')) === want
    );
  }

  function credit(row, t, amount) {
    return db.tx(() => {
      if (db.prepare("SELECT 1 FROM deposits WHERE txid = ? AND (address = ? OR source = 'manual')").get(t.txid, row.address)) {
        return false;
      }
      const ok = amount >= c.minDepositMicro;
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO deposits (user_id, amount, network, txid, address, source, status, note, created_at, reviewed_at)
           VALUES (?, ?, 'TRC20', ?, ?, 'chain', ?, ?, ?, ?)`
        )
        .run(row.user_id, amount, t.txid, row.address, ok ? 'approved' : 'rejected', ok ? null : 'below_minimum', t.timestamp, now());
      if (ok) {
        wallet.credit(row.user_id, amount, 'deposit', { type: 'deposit', id: Number(lastInsertRowid) });
        db.prepare('UPDATE deposit_addresses SET needs_sweep = 1 WHERE user_id = ?').run(row.user_id);
      }
      return ok;
    });
  }

  async function scanRow(row) {
    // Re-read a 10-minute overlap; duplicates are ignored by txid+address.
    const since = Math.max(0, row.scanned_until - 600_000);
    const transfers = await client.getIncomingTrc20(row.address, { contract: c.usdtContract, minTimestamp: since });
    let credited = 0;
    let maxTs = row.scanned_until;
    let incomplete = false;
    for (const t of transfers) {
      const amount = candidate(row, t);
      if (amount !== null) {
        try {
          if (!(await verifiedOnChain(row, t, amount))) {
            log.warn(`[chain] deposit ${t.txid} not confirmed by the node's event log; skipped`);
            incomplete = true; // look again next time (may simply not be solidified yet)
            continue;
          }
        } catch (err) {
          log.warn(`[chain] verify ${t.txid}: ${err.message}`);
          incomplete = true;
          continue;
        }
        if (credit(row, t, amount)) credited++;
      }
      maxTs = Math.max(maxTs, t.timestamp || 0);
    }
    // Only move the cursor forward when every transfer was settled; duplicates are ignored anyway.
    db.prepare('UPDATE deposit_addresses SET scanned_until = ?, last_scan_at = ? WHERE user_id = ?').run(
      incomplete ? row.scanned_until : maxTs, now(), row.user_id
    );
    return credited;
  }

  async function scanDeposits() {
    const t = now();
    const watched = db.prepare('SELECT * FROM deposit_addresses WHERE watch_until > ?').all(t);
    const others = db
      .prepare('SELECT * FROM deposit_addresses WHERE watch_until <= ? ORDER BY last_scan_at ASC LIMIT 10')
      .all(t);
    for (const row of [...watched, ...others]) {
      try {
        await scanRow(row);
      } catch (err) {
        log.warn(`[chain] scan ${row.address}: ${err.message}`);
      }
    }
  }

  async function scanUser(userId) {
    const row = getAddr.get(userId);
    return row ? scanRow(row) : 0;
  }

  // ---------- hot wallet ----------
  async function hotBalances(fresh = false) {
    if (!fresh && hotCache && now() - hotCache.at < 30_000) return hotCache;
    const [usdt, trx] = await Promise.all([
      client.getTrc20Balance(keyring.hotAddress, c.usdtContract),
      client.getTrxBalance(keyring.hotAddress),
    ]);
    hotCache = { usdt, trx, at: now() };
    return hotCache;
  }

  async function signTrc20(fromKey, from, to, amount, feeLimitSun) {
    const block = await client.getNowBlock();
    return txb.sign(txb.buildTrc20Transfer({ from, token: c.usdtContract, to, amount, feeLimitSun, block }), fromKey);
  }

  // ---------- withdrawals ----------
  const getW = db.prepare('SELECT * FROM withdrawals WHERE id = ?');

  function markSent(w) {
    return db.tx(() => {
      const done = db
        .prepare("UPDATE withdrawals SET status = 'sent', reviewed_at = ? WHERE id = ? AND status IN ('sending','failed') AND txid = ?")
        .run(now(), w.id, w.txid).changes;
      if (done) wallet.burnLocked(w.user_id, w.amount + w.fee, 'withdrawal', { type: 'withdrawal', id: w.id });
      return 'sent';
    });
  }

  // Before a failed withdrawal is retried or refunded, prove its last signed tx can never land:
  // otherwise a node that kept the rejected tx could still broadcast it and the user would be paid twice.
  async function assertSettledFailure(id) {
    const w = getW.get(id);
    if (!w || w.status !== 'failed' || !w.txid) return;
    const out = await client.getConfirmedOutcome(w.txid);
    if (out?.ok) {
      markSent(w);
      throw conflict('already_sent');
    }
    if (out) return; // included and reverted: that txid can never execute again
    if (now() < w.tx_expires_at + EXPIRY_GRACE || (await client.isKnown(w.txid))) throw conflict('retry_later');
  }

  async function sendWithdrawal(id, { auto = false } = {}) {
    let w = getW.get(id);
    if (!w) throw notFound();
    if (w.status !== 'pending' && w.status !== 'failed') throw conflict('already_reviewed');
    await assertSettledFailure(id);
    w = getW.get(id);
    if (!isAddress(w.address) || isPlatformAddress(w.address)) throw bad('invalid_address');
    const hot = await hotBalances(true);
    if (hot.usdt < BigInt(w.amount)) throw conflict('hot_wallet_low');
    if (hot.trx < BigInt(c.feeLimitSun)) throw conflict('hot_wallet_no_trx');

    const signed = await signTrc20(keyring.hotKey(), keyring.hotAddress, w.address, w.amount, c.feeLimitSun);
    const claimed = db
      .prepare(
        `UPDATE withdrawals SET status = 'sending', txid = ?, tx_expires_at = ?, auto = ?, attempts = attempts + 1,
           reviewed_at = ?, note = NULL WHERE id = ? AND status IN ('pending','failed')`
      )
      .run(signed.txID, signed.expiration, auto ? 1 : 0, now(), id).changes;
    if (!claimed) throw conflict('already_reviewed');
    hotCache = null;

    try {
      const r = await client.broadcastHex(signed.hex);
      if (!r.result && r.code !== 'DUP_TRANSACTION_ERROR') {
        // Rejected by the node's validation: it was not accepted into the network.
        db.prepare("UPDATE withdrawals SET status = 'failed', note = ? WHERE id = ? AND status = 'sending' AND txid = ?").run(
          `broadcast: ${r.code || ''} ${r.message || ''}`.trim().slice(0, 500), id, signed.txID
        );
      }
    } catch (err) {
      // Unknown outcome (timeout etc.): stay "sending"; confirmWithdrawals settles it from the chain.
      log.warn(`[chain] broadcast withdrawal ${id}: ${err.message}`);
    }
    return getW.get(id);
  }

  async function settle(table, row, onConfirmed) {
    const out = await client.getConfirmedOutcome(row.txid);
    if (out) {
      if (out.ok) return onConfirmed();
      db.prepare(`UPDATE ${table} SET status = 'failed', note = ? WHERE id = ? AND status = 'sending' AND txid = ?`).run(
        `on-chain: ${out.reason}`.slice(0, 500), row.id, row.txid
      );
      return 'failed';
    }
    // Not solidified: only declare it dead once it has expired and no node knows it.
    if (now() > row.tx_expires_at + EXPIRY_GRACE && !(await client.isKnown(row.txid))) {
      db.prepare(`UPDATE ${table} SET status = 'failed', note = 'expired' WHERE id = ? AND status = 'sending' AND txid = ?`).run(
        row.id, row.txid
      );
      return 'failed';
    }
    return 'sending';
  }

  async function confirmWithdrawals() {
    for (const w of db.prepare("SELECT * FROM withdrawals WHERE status = 'sending'").all()) {
      try {
        await settle('withdrawals', w, () => markSent(w));
      } catch (err) {
        log.warn(`[chain] confirm withdrawal ${w.id}: ${err.message}`);
      }
    }
  }

  const autoUsedToday = () =>
    db
      .prepare("SELECT COALESCE(SUM(amount), 0) s FROM withdrawals WHERE auto = 1 AND status IN ('sending','sent') AND reviewed_at > ?")
      .get(now() - DAY).s;

  async function autoWithdrawals() {
    const candidates = db
      .prepare(
        `SELECT w.id, w.amount FROM withdrawals w JOIN users u ON u.id = w.user_id
         WHERE w.status = 'pending' AND w.attempts = 0 AND w.amount <= ? AND u.is_blocked = 0 AND u.created_at < ?
         ORDER BY w.id LIMIT 5`
      )
      .all(c.autoWithdrawMaxMicro, now() - DAY);
    for (const w of candidates) {
      if (autoUsedToday() + w.amount > c.dailyAutoMaxMicro) break;
      try {
        await sendWithdrawal(w.id, { auto: true });
      } catch (err) {
        log.warn(`[chain] auto withdrawal ${w.id}: ${err.code || err.message}`);
        if (err.code === 'hot_wallet_low' || err.code === 'hot_wallet_no_trx') break;
      }
    }
  }

  // ---------- sweeps ----------
  async function record(kind, row, to, amount, signed) {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO sweeps (user_id, kind, from_address, to_address, amount, txid, tx_expires_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?)`
      )
      .run(row.user_id, kind, kind === 'topup' ? keyring.hotAddress : row.address, to, String(amount), signed.txID, signed.expiration, now());
    const id = Number(lastInsertRowid);
    try {
      const r = await client.broadcastHex(signed.hex);
      if (!r.result && r.code !== 'DUP_TRANSACTION_ERROR') {
        db.prepare("UPDATE sweeps SET status = 'failed', note = ? WHERE id = ?").run(`broadcast: ${r.code} ${r.message || ''}`.slice(0, 500), id);
      }
    } catch (err) {
      log.warn(`[chain] broadcast ${kind} ${id}: ${err.message}`);
    }
  }

  async function sweepTick() {
    for (const s of db.prepare("SELECT * FROM sweeps WHERE status = 'sending'").all()) {
      try {
        await settle('sweeps', s, () => {
          db.prepare("UPDATE sweeps SET status = 'confirmed' WHERE id = ? AND status = 'sending'").run(s.id);
          return 'confirmed';
        });
      } catch (err) {
        log.warn(`[chain] confirm sweep ${s.id}: ${err.message}`);
      }
    }

    const rows = db
      .prepare(
        `SELECT a.* FROM deposit_addresses a WHERE a.needs_sweep = 1
         AND NOT EXISTS (SELECT 1 FROM sweeps s WHERE s.user_id = a.user_id AND s.status = 'sending') LIMIT 5`
      )
      .all();
    for (const row of rows) {
      try {
        const usdt = await client.getTrc20Balance(row.address, c.usdtContract);
        if (usdt < BigInt(c.sweepMinMicro)) {
          db.prepare('UPDATE deposit_addresses SET needs_sweep = 0 WHERE user_id = ?').run(row.user_id);
          continue;
        }
        const trx = await client.getTrxBalance(row.address);
        if (trx < BigInt(c.sweepTrxMinSun)) {
          const hot = await hotBalances(true);
          if (hot.trx < BigInt(c.sweepTopupSun + c.feeLimitSun)) throw new Error('hot wallet TRX too low for top-up');
          const block = await client.getNowBlock();
          const signed = txb.sign(
            txb.buildTrxTransfer({ from: keyring.hotAddress, to: row.address, amountSun: c.sweepTopupSun, block }),
            keyring.hotKey()
          );
          await record('topup', row, row.address, c.sweepTopupSun, signed);
        } else {
          const hot = await hotBalances();
          const to = c.coldAddress && hot.usdt > BigInt(c.hotMaxMicro) ? c.coldAddress : keyring.hotAddress;
          const feeLimit = trx < BigInt(c.feeLimitSun) ? Number(trx) : c.feeLimitSun;
          const signed = await signTrc20(keyring.depositKey(row.derivation_index), row.address, to, usdt, feeLimit);
          await record('sweep', row, to, usdt, signed);
          hotCache = null;
        }
      } catch (err) {
        log.warn(`[chain] sweep ${row.address}: ${err.message}`);
      }
    }
  }

  // ---------- loop ----------
  let ticks = 0;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    const errors = [];
    for (const [name, fn] of [
      ['scan', scanDeposits],
      ['confirm', confirmWithdrawals],
      ['auto', autoWithdrawals],
      ...(ticks % 5 === 0 ? [['sweep', sweepTick]] : []),
    ]) {
      try {
        await fn();
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }
    ticks++;
    lastTickAt = now();
    lastError = errors.join('; ') || null;
    running = false;
  }

  let timer = null;
  return {
    hotAddress: keyring.hotAddress,
    depositAddress,
    scanUser,
    sendWithdrawal,
    assertSettledFailure,
    tick,
    sweepTick,
    isPlatformAddress,
    start() {
      timer = setInterval(() => tick().catch((e) => log.error(e)), c.intervalMs);
      timer.unref();
      tick().catch((e) => log.error(e));
    },
    stop() {
      clearInterval(timer);
    },
    async status() {
      let hot = null;
      let hotError = null;
      try {
        hot = await hotBalances();
      } catch (err) {
        hotError = err.message;
      }
      const q = (sql) => db.prepare(sql).get().n;
      return {
        network: c.network,
        explorer: c.explorer,
        usdtContract: c.usdtContract,
        hotAddress: keyring.hotAddress,
        coldAddress: c.coldAddress || null,
        hotUsdt: hot ? hot.usdt.toString() : null,
        hotTrx: hot ? hot.trx.toString() : null,
        hotError,
        autoWithdrawMax: c.autoWithdrawMaxMicro,
        dailyAutoMax: c.dailyAutoMaxMicro,
        autoUsedToday: autoUsedToday(),
        depositAddresses: q('SELECT COUNT(*) n FROM deposit_addresses'),
        awaitingSweep: q('SELECT COUNT(*) n FROM deposit_addresses WHERE needs_sweep = 1'),
        sending: q("SELECT COUNT(*) n FROM withdrawals WHERE status = 'sending'"),
        failed: q("SELECT COUNT(*) n FROM withdrawals WHERE status = 'failed'"),
        lastTickAt,
        lastError,
      };
    },
  };
}

module.exports = { createChain };
