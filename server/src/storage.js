'use strict';

// Blob storage for (already encrypted) KYC documents.
//   local:    files in KYC_DIR (development, single server)
//   supabase: a PRIVATE Supabase Storage bucket, accessed only by the server with the service-role key
const fs = require('node:fs');
const path = require('node:path');

function createStorage(config, { fetchImpl = fetch } = {}) {
  const s = config.storage || { provider: 'local' };
  if (s.provider === 'supabase') {
    if (!s.url || !s.serviceKey || !s.bucket) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and KYC_BUCKET are required');
    const base = `${s.url.replace(/\/$/, '')}/storage/v1/object`;
    // Legacy service_role keys are JWTs and go in both headers; new secret keys (sb_secret_…) only in `apikey`.
    const headers = s.serviceKey.startsWith('eyJ')
      ? { authorization: `Bearer ${s.serviceKey}`, apikey: s.serviceKey }
      : { apikey: s.serviceKey };
    const call = async (method, p, body) => {
      const res = await fetchImpl(`${base}${p}`, {
        method,
        headers: body ? { ...headers, 'content-type': 'application/octet-stream', 'x-upsert': 'true' } : headers,
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`storage ${method} HTTP ${res.status}`);
      return res;
    };
    return {
      kind: 'supabase',
      put: async (name, buf) => void (await call('POST', `/${s.bucket}/${name}`, buf)),
      get: async (name) => Buffer.from(await (await call('GET', `/authenticated/${s.bucket}/${name}`)).arrayBuffer()),
      remove: async (name) => void (await call('DELETE', `/${s.bucket}/${name}`)),
    };
  }
  const dir = config.kycDir;
  return {
    kind: 'local',
    async put(name, buf) {
      const file = path.join(dir, name);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, buf, { mode: 0o600 });
    },
    get: async (name) => fs.readFileSync(path.join(dir, name)),
    remove: async (name) => fs.rmSync(path.join(dir, name), { force: true }),
  };
}

module.exports = { createStorage };
