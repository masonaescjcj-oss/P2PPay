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
const m = require('./money');

const DAY = 86_400_000;
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex20 = (address) => Buffer.from(addressToBytes(address)).toString('hex').slice(2);
const EXPIRY_GRACE = 5 * 60_000;
const LEADER_KEY = 727171;

function createChain(db, wallet, config, { client, log = console, notify = async () => {} }) {
  const c = config.tron;
  const keyring = createKeyring(c.mnemonic);
  const now = () => Date.now();
  let lastTickAt = 0;
  let lastError = null;
  let hotCache = null;

  if (c.coldAddress && !isAddress(c.coldAddress)) throw new Error('COLD_WALLET_ADDRESS is not a valid TRON address');

  // ---------- deposit addresses ----------
  const getAddr = (userId) => db.one('SELECT * FROM deposit_addresses WHERE user_id = ?', [userId]);

  async function depositAddress(userId) {
    await db.run(
      'INSERT INTO deposit_addresses (user_id, address, derivation_index, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO NOTHING',
      [userId, keyring.depositAddress(userId), userId, now()]
    );
    // Watch it closely for a while after the user has seen it.
    const row = await db.one('UPDATE deposit_addresses SET watch_until = ? WHERE user_id = ? RETURNING address', [
      now() + c.watchHours * 3_600_000, userId,
    ]);
    return row.address;
  }

  // Sending to the platform's own hot/cold wallet would never be credited to anyone.
  const isPlatformAddress = (a) => a === keyring.hotAddress || (!!c.coldAddress && a === c.coldAddress);

  // Cheap checks on what the index API reported; returns the amount or null.
  const alreadySeen = (txid, address) =>
    db.one("SELECT 1 FROM deposits WHERE txid = ? AND (address = ? OR source = 'manual')", [txid, address]);

  async function candidate(row, t) {
    if (t.to !== row.address || t.contract !== c.usdtContract || t.type !== 'Transfer') return null;
    let value;
    try {
      value = BigInt(t.value);
    } catch {
      return null;
    }
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return (await alreadySeen(t.txid, row.address)) ? null : Number(value);
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

  // Credited at most once: the txid lock serializes against manual claims of the same txid,
  // and the unique index (txid, address) makes a repeated insert a no-op.
  function credit(row, t, amount) {
    return db.tx(async () => {
      await db.run('SELECT pg_advisory_xact_lock(?, hashtext(?))', [9004, t.txid]);
      if (await alreadySeen(t.txid, row.address)) return false;
      const ok = amount >= c.minDepositMicro;
      const d = await db.one(
        `INSERT INTO deposits (user_id, amount, network, txid, address, source, status, note, created_at, reviewed_at)
         VALUES (?, ?, 'TRC20', ?, ?, 'chain', ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
        [row.user_id, amount, t.txid, row.address, ok ? 'approved' : 'rejected', ok ? null : 'below_minimum', t.timestamp, now()]
      );
      if (!d || !ok) return false;
      await wallet.credit(row.user_id, amount, 'deposit', { type: 'deposit', id: d.id });
      await notify(row.user_id, 'deposit_credited', { amount: m.fmtUsdt(amount) });
      await db.run('UPDATE deposit_addresses SET needs_sweep = 1 WHERE user_id = ?', [row.user_id]);
      return true;
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
      const amount = await candidate(row, t);
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
        if (await credit(row, t, amount)) credited++;
      }
      maxTs = Math.max(maxTs, t.timestamp || 0);
    }
    // Only move the cursor forward when every transfer was settled; duplicates are ignored anyway.
    await db.run('UPDATE deposit_addresses SET scanned_until = ?, last_scan_at = ? WHERE user_id = ?', [
      incomplete ? row.scanned_until : maxTs, now(), row.user_id,
    ]);
    return credited;
  }

  async function scanDeposits() {
    const t = now();
    const watched = await db.query('SELECT * FROM deposit_addresses WHERE watch_until > ?', [t]);
    const others = await db.query('SELECT * FROM deposit_addresses WHERE watch_until <= ? ORDER BY last_scan_at ASC LIMIT 10', [t]);
    for (const row of [...watched, ...others]) {
      try {
        await scanRow(row);
      } catch (err) {
        log.warn(`[chain] scan ${row.address}: ${err.message}`);
      }
    }
  }

  async function scanUser(userId) {
    const row = await getAddr(userId);
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
  const getW = (id) => db.one('SELECT * FROM withdrawals WHERE id = ?', [id]);

  function markSent(w) {
    return db.tx(async () => {
      const done = await db.run(
        "UPDATE withdrawals SET status = 'sent', reviewed_at = ? WHERE id = ? AND status IN ('sending','failed') AND txid = ?",
        [now(), w.id, w.txid]
      );
      if (done.rowCount) {
        await wallet.burnLocked(w.user_id, w.amount + w.fee, 'withdrawal', { type: 'withdrawal', id: w.id });
        await notify(w.user_id, 'withdrawal_sent', { amount: m.fmtUsdt(w.amount) });
      }
      return 'sent';
    });
  }

  // Before a failed withdrawal is retried or refunded, prove its last signed tx can never land:
  // otherwise a node that kept the rejected tx could still broadcast it and the user would be paid twice.
  async function assertSettledFailure(id) {
    const w = await getW(id);
    if (!w || w.status !== 'failed' || !w.txid) return;
    const out = await client.getConfirmedOutcome(w.txid);
    if (out?.ok) {
      await markSent(w);
      throw conflict('already_sent');
    }
    if (out) return; // included and reverted: that txid can never execute again
    if (now() < w.tx_expires_at + EXPIRY_GRACE || (await client.isKnown(w.txid))) throw conflict('retry_later');
  }

  async function sendWithdrawal(id, { auto = false } = {}) {
    let w = await getW(id);
    if (!w) throw notFound();
    if (w.status !== 'pending' && w.status !== 'failed') throw conflict('already_reviewed');
    await assertSettledFailure(id);
    w = await getW(id);
    if (!isAddress(w.address) || isPlatformAddress(w.address)) throw bad('invalid_address');
    const hot = await hotBalances(true);
    if (hot.usdt < BigInt(w.amount)) throw conflict('hot_wallet_low');
    if (hot.trx < BigInt(c.feeLimitSun)) throw conflict('hot_wallet_no_trx');

    const signed = await signTrc20(keyring.hotKey(), keyring.hotAddress, w.address, w.amount, c.feeLimitSun);
    // Claim it only if nobody changed it meanwhile (same status and txid as when we checked).
    const claimed = await db.run(
      `UPDATE withdrawals SET status = 'sending', txid = ?, tx_expires_at = ?, auto = ?, attempts = attempts + 1,
         reviewed_at = ?, note = NULL WHERE id = ? AND status = ? AND txid IS NOT DISTINCT FROM ?`,
      [signed.txID, signed.expiration, auto ? 1 : 0, now(), id, w.status, w.txid]
    );
    if (!claimed.rowCount) throw conflict('already_reviewed');
    hotCache = null;

    try {
      const r = await client.broadcastHex(signed.hex);
      if (!r.result && r.code !== 'DUP_TRANSACTION_ERROR') {
        // Rejected by the node's validation: it was not accepted into the network.
        await db.run("UPDATE withdrawals SET status = 'failed', note = ? WHERE id = ? AND status = 'sending' AND txid = ?", [
          `broadcast: ${r.code || ''} ${r.message || ''}`.trim().slice(0, 500), id, signed.txID,
        ]);
      }
    } catch (err) {
      // Unknown outcome (timeout etc.): stay "sending"; confirmWithdrawals settles it from the chain.
      log.warn(`[chain] broadcast withdrawal ${id}: ${err.message}`);
    }
    return getW(id);
  }

  async function settle(table, row, onConfirmed) {
    const out = await client.getConfirmedOutcome(row.txid);
    if (out) {
      if (out.ok) return onConfirmed();
      await db.run(`UPDATE ${table} SET status = 'failed', note = ? WHERE id = ? AND status = 'sending' AND txid = ?`, [
        `on-chain: ${out.reason}`.slice(0, 500), row.id, row.txid,
      ]);
      return 'failed';
    }
    // Not solidified: only declare it dead once it has expired and no node knows it.
    if (now() > row.tx_expires_at + EXPIRY_GRACE && !(await client.isKnown(row.txid))) {
      await db.run(`UPDATE ${table} SET status = 'failed', note = 'expired' WHERE id = ? AND status = 'sending' AND txid = ?`, [
        row.id, row.txid,
      ]);
      return 'failed';
    }
    return 'sending';
  }

  async function confirmWithdrawals() {
    for (const w of await db.query("SELECT * FROM withdrawals WHERE status = 'sending'")) {
      try {
        await settle('withdrawals', w, () => markSent(w));
      } catch (err) {
        log.warn(`[chain] confirm withdrawal ${w.id}: ${err.message}`);
      }
    }
  }

  const autoUsedToday = async () =>
    (await db.one("SELECT COALESCE(SUM(amount), 0) s FROM withdrawals WHERE auto = 1 AND status IN ('sending','sent') AND reviewed_at > ?", [
      now() - DAY,
    ])).s;

  async function autoWithdrawals() {
    const candidates = await db.query(
      `SELECT w.id, w.amount FROM withdrawals w JOIN users u ON u.id = w.user_id
       WHERE w.status = 'pending' AND w.attempts = 0 AND w.amount <= ? AND u.is_blocked = 0 AND u.created_at < ?
       ORDER BY w.id LIMIT 5`,
      [c.autoWithdrawMaxMicro, now() - DAY]
    );
    for (const w of candidates) {
      if ((await autoUsedToday()) + w.amount > c.dailyAutoMaxMicro) break;
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
    const { id } = await db.one(
      `INSERT INTO sweeps (user_id, kind, from_address, to_address, amount, txid, tx_expires_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?) RETURNING id`,
      [row.user_id, kind, kind === 'topup' ? keyring.hotAddress : row.address, to, String(amount), signed.txID, signed.expiration, now()]
    );
    try {
      const r = await client.broadcastHex(signed.hex);
      if (!r.result && r.code !== 'DUP_TRANSACTION_ERROR') {
        await db.run("UPDATE sweeps SET status = 'failed', note = ? WHERE id = ?", [`broadcast: ${r.code} ${r.message || ''}`.slice(0, 500), id]);
      }
    } catch (err) {
      log.warn(`[chain] broadcast ${kind} ${id}: ${err.message}`);
    }
  }

  async function sweepTick() {
    for (const s of await db.query("SELECT * FROM sweeps WHERE status = 'sending'")) {
      try {
        await settle('sweeps', s, async () => {
          await db.run("UPDATE sweeps SET status = 'confirmed' WHERE id = ? AND status = 'sending'", [s.id]);
          return 'confirmed';
        });
      } catch (err) {
        log.warn(`[chain] confirm sweep ${s.id}: ${err.message}`);
      }
    }

    const rows = await db.query(
      `SELECT a.* FROM deposit_addresses a WHERE a.needs_sweep = 1
       AND NOT EXISTS (SELECT 1 FROM sweeps s WHERE s.user_id = a.user_id AND s.status = 'sending') LIMIT 5`
    );
    for (const row of rows) {
      try {
        const usdt = await client.getTrc20Balance(row.address, c.usdtContract);
        if (usdt < BigInt(c.sweepMinMicro)) {
          await db.run('UPDATE deposit_addresses SET needs_sweep = 0 WHERE user_id = ?', [row.user_id]);
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

  // Several API instances may run; only the one holding the database lock runs the chain loop.
  let timer = null;
  let lease = null;
  let stopped = false;
  async function loop() {
    if (stopped) return;
    try {
      if (!lease) {
        lease = await db.leader(LEADER_KEY);
        if (lease) log.warn('[chain] this instance runs the chain loop');
      }
      if (lease) await tick();
    } catch (err) {
      log.error(`[chain] loop: ${err.message}`);
    }
    if (!stopped) {
      timer = setTimeout(loop, c.intervalMs);
      timer.unref();
    }
  }

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
      stopped = false;
      loop();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await lease?.release().catch(() => {});
      lease = null;
    },
    isLeader: () => !!lease,
    async status() {
      let hot = null;
      let hotError = null;
      try {
        hot = await hotBalances();
      } catch (err) {
        hotError = err.message;
      }
      const q = async (sql) => (await db.one(sql)).n;
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
        autoUsedToday: await autoUsedToday(),
        depositAddresses: await q('SELECT COUNT(*) n FROM deposit_addresses'),
        awaitingSweep: await q('SELECT COUNT(*) n FROM deposit_addresses WHERE needs_sweep = 1'),
        sending: await q("SELECT COUNT(*) n FROM withdrawals WHERE status = 'sending'"),
        failed: await q("SELECT COUNT(*) n FROM withdrawals WHERE status = 'failed'"),
        leader: !!lease,
        lastTickAt,
        lastError,
      };
    },
  };
}

module.exports = { createChain };
