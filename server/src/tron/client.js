'use strict';

const { addressToBytes } = require('./keys');

// Minimal TronGrid HTTP client. Every method is read-only except broadcastHex.
function createTronClient({ apiUrl, apiKey, timeoutMs = 15_000, fetchImpl = fetch }) {
  const base = apiUrl.replace(/\/$/, '');
  const headers = { 'content-type': 'application/json', ...(apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}) };

  async function call(method, path, body) {
    const res = await fetchImpl(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`TronGrid ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  return {
    async getNowBlock() {
      const b = await call('POST', '/wallet/getnowblock', {});
      return { number: b.block_header.raw_data.number, id: b.blockID, timestamp: b.block_header.raw_data.timestamp };
    },

    // Confirmed incoming TRC20 transfers of one token to `address`, oldest first.
    async getIncomingTrc20(address, { contract, minTimestamp = 0 }) {
      const out = [];
      let fingerprint;
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({
          only_confirmed: 'true', only_to: 'true', contract_address: contract, limit: '200',
          min_timestamp: String(minTimestamp), order_by: 'block_timestamp,asc',
        });
        if (fingerprint) q.set('fingerprint', fingerprint);
        const r = await call('GET', `/v1/accounts/${address}/transactions/trc20?${q}`);
        for (const x of r.data || []) {
          out.push({
            txid: x.transaction_id, from: x.from, to: x.to, value: String(x.value),
            contract: x.token_info?.address, timestamp: x.block_timestamp, type: x.type,
          });
        }
        fingerprint = r.meta?.fingerprint;
        if (!fingerprint) break;
      }
      return out;
    },

    async getTrc20Balance(address, contract) {
      const ownerHex = Buffer.from(addressToBytes(address)).toString('hex');
      const r = await call('POST', '/wallet/triggerconstantcontract', {
        owner_address: address, contract_address: contract, function_selector: 'balanceOf(address)',
        parameter: ownerHex.slice(2).padStart(64, '0'), visible: true,
      });
      const v = r.constant_result?.[0];
      if (!v) throw new Error('balanceOf returned no result');
      return BigInt('0x' + v);
    },

    async getTrxBalance(address) {
      const r = await call('POST', '/wallet/getaccount', { address, visible: true });
      return BigInt(r.balance || 0);
    },

    // Returns { result: true, txid } or { result: false, code, message }.
    async broadcastHex(hex) {
      const r = await call('POST', '/wallet/broadcasthex', { transaction: hex });
      let message = r.message;
      if (message && /^[0-9a-f]+$/i.test(message)) message = Buffer.from(message, 'hex').toString('utf8');
      return { result: r.result === true, txid: r.txid, code: r.code, message };
    },

    // Solidified (irreversible) outcome: null = not confirmed yet.
    async getConfirmedOutcome(txid) {
      const info = await call('POST', '/walletsolidity/gettransactioninfobyid', { value: txid });
      if (!info || !info.id) return null;
      const receipt = info.receipt?.result;
      const ok = info.result !== 'FAILED' && (receipt === undefined || receipt === 'SUCCESS');
      return { ok, blockNumber: info.blockNumber, reason: ok ? null : receipt || info.resMessage || 'FAILED' };
    },

    // Solidified receipt with raw event logs, used to verify a deposit independently of the index API.
    async getConfirmedLogs(txid) {
      const info = await call('POST', '/walletsolidity/gettransactioninfobyid', { value: txid });
      if (!info || !info.id) return null;
      const receipt = info.receipt?.result;
      return {
        ok: info.result !== 'FAILED' && (receipt === undefined || receipt === 'SUCCESS'),
        logs: (info.log || []).map((l) => ({ address: l.address, topics: l.topics || [], data: l.data || '' })),
      };
    },

    // Whether the full node has seen the transaction at all (possibly not yet solidified).
    async isKnown(txid) {
      const t = await call('POST', '/wallet/gettransactionbyid', { value: txid });
      return !!(t && t.txID);
    },
  };
}

module.exports = { createTronClient };
