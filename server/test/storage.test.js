'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createStorage } = require('../src/storage');

// A stand-in for Supabase Storage's REST API: checks the service-role headers and the object paths.
async function fakeSupabase(key) {
  const objects = new Map();
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    calls.push({ method: req.method, url: req.url, upsert: req.headers['x-upsert'] });
    const jwt = key.startsWith('eyJ');
    if (req.headers.apikey !== key || (jwt ? req.headers.authorization !== `Bearer ${key}` : req.headers.authorization)) {
      return res.writeHead(401).end();
    }
    let m;
    if (req.method === 'POST' && (m = req.url.match(/^\/storage\/v1\/object\/kyc\/(.+)$/))) {
      objects.set(m[1], Buffer.concat(chunks));
      return res.writeHead(200, { 'content-type': 'application/json' }).end('{"Key":"x"}');
    }
    if (req.method === 'GET' && (m = req.url.match(/^\/storage\/v1\/object\/authenticated\/kyc\/(.+)$/))) {
      return objects.has(m[1]) ? res.writeHead(200).end(objects.get(m[1])) : res.writeHead(400).end('{"error":"not_found"}');
    }
    if (req.method === 'DELETE' && (m = req.url.match(/^\/storage\/v1\/object\/kyc\/(.+)$/))) {
      objects.delete(m[1]);
      return res.writeHead(200).end('{}');
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, calls, close: () => server.close() };
}

for (const key of ['eyJhbGciOiJIUzI1NiJ9.service-role', 'sb_secret_testkey']) test(`Supabase Storage provider: private bucket via the server key (${key.slice(0, 6)}…)`, async (t) => {
  const sb = await fakeSupabase(key);
  t.after(sb.close);
  const storage = createStorage({ storage: { provider: 'supabase', url: sb.url + '/', serviceKey: key, bucket: 'kyc' } });
  const blob = Buffer.from([1, 2, 3, 250]);
  await storage.put('7/abc.bin', blob);
  assert.deepEqual(sb.objects.get('7/abc.bin'), blob);
  assert.equal(sb.calls[0].upsert, 'true');
  assert.deepEqual(await storage.get('7/abc.bin'), blob);
  await storage.remove('7/abc.bin');
  assert.equal(sb.objects.size, 0);
  await assert.rejects(storage.get('7/abc.bin'), /storage GET HTTP 400/);

  const wrong = createStorage({ storage: { provider: 'supabase', url: sb.url, serviceKey: 'nope', bucket: 'kyc' } });
  await assert.rejects(wrong.put('x.bin', blob), /HTTP 401/);
  assert.throws(() => createStorage({ storage: { provider: 'supabase', url: sb.url } }), /SUPABASE_SERVICE_ROLE_KEY/);
});
