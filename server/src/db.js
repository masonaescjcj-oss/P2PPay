'use strict';

// PostgreSQL access. Production: Supabase (or any Postgres) via DATABASE_URL and node-postgres.
// Development and tests: PGlite — real Postgres compiled to WebAssembly, in-process, no server needed.
//
//   db.query(sql, params) → rows      db.one(...) → first row      db.run(...) → { rowCount, rows }
//   db.tx(async () => { ... })         — every db.* call inside (even in nested functions) joins the
//                                        same transaction, via AsyncLocalStorage; nested tx() joins too.
// SQL uses `?` placeholders (converted to $1, $2 …). Tables live in the private schema `app`.
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const INT8 = 20;
const NUMERIC = 1700;

// `?` → `$n`, skipping quoted strings.
function toPg(sql) {
  let n = 0;
  let out = '';
  let quote = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else out += ch;
  }
  return out;
}

// A FIFO async mutex (PGlite has a single session, so transactions must not interleave).
function createMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(() => {}, () => {});
    return run;
  };
}

function sslOptions(config) {
  if (!config.databaseUrl || /sslmode=disable|localhost|127\.0\.0\.1/.test(config.databaseUrl)) return undefined;
  if (config.databaseCaPath) return { ca: fs.readFileSync(config.databaseCaPath, 'utf8'), rejectUnauthorized: true };
  if (config.databaseCa) return { ca: config.databaseCa, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

async function openDb(config, { log = console } = {}) {
  const als = new AsyncLocalStorage();
  let backend;

  if (config.databaseUrl) {
    const pg = require('pg');
    pg.types.setTypeParser(INT8, (v) => Number(v));
    pg.types.setTypeParser(NUMERIC, (v) => Number(v));
    const ssl = sslOptions(config);
    if (ssl && !ssl.ca) {
      const msg = '[db] TLS without certificate verification; set DATABASE_CA_PATH to the Supabase CA certificate';
      if (config.nodeEnv === 'production') log.warn(msg);
    }
    // node-postgres lets ssl* URL parameters override the `ssl` object, so drop them when we set TLS ourselves.
    const url = new URL(config.databaseUrl);
    if (ssl) for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(k);
    const pool = new pg.Pool({ connectionString: url.toString(), ssl, max: config.databasePoolSize || 10 });
    pool.on('error', (err) => log.error('[db] idle client error', err.message));
    // Each new connection gets the app schema first (a startup `options` parameter is not
    // forwarded by every pooler, so it is set explicitly).
    const ready = new WeakSet();
    const acquire = async () => {
      const client = await pool.connect();
      if (!ready.has(client)) {
        try {
          await client.query('SET search_path TO app, public');
        } catch (err) {
          client.release(err);
          throw err;
        }
        ready.add(client);
      }
      return client;
    };
    const withClient = async (fn) => {
      const client = await acquire();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    };
    backend = {
      kind: 'pg',
      query: (sql, params) => withClient((c) => c.query(sql, params)),
      async tx(fn) {
        const client = await acquire();
        try {
          await client.query('BEGIN');
          const out = await fn((sql, params) => client.query(sql, params));
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      exec: (sql) => withClient((c) => c.query(sql)),
      // Session advisory lock held on a dedicated connection (released if the process dies).
      async leader(key) {
        const client = await acquire();
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
        if (rows[0].ok) return { release: () => client.query('SELECT pg_advisory_unlock($1)', [key]).finally(() => client.release()) };
        client.release();
        return null;
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const dir = config.pgliteDir && config.pgliteDir !== ':memory:' ? config.pgliteDir : undefined;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const parsers = { [INT8]: (v) => Number(v), [NUMERIC]: (v) => Number(v) };
    // pgliteOptions: extra PGlite settings (the browser test build passes its file-system bundle).
    const lite = new PGlite(dir, { parsers, ...config.pgliteOptions });
    await lite.waitReady;
    await lite.exec('CREATE SCHEMA IF NOT EXISTS app; SET search_path TO app, public;');
    const lock = createMutex();
    // Without params: simple protocol (allows multi-statement migrations).
    const q = (sql, params) =>
      params === undefined
        ? lite.exec(sql).then((r) => ({ rows: r.at(-1)?.rows || [], rowCount: 0 }))
        : lite.query(sql, params, { parsers }).then((r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }));
    backend = {
      kind: 'pglite',
      query: (sql, params) => lock(() => q(sql, params)),
      tx: (fn) =>
        lock(async () => {
          await lite.query('BEGIN');
          try {
            const out = await fn(q);
            await lite.query('COMMIT');
            return out;
          } catch (err) {
            await lite.query('ROLLBACK').catch(() => {});
            throw err;
          }
        }),
      exec: (sql) => lock(() => lite.exec(sql)),
      leader: async () => ({ release: async () => {} }),
      close: () => lite.close(),
    };
  }

  const run = async (sql, params = []) => {
    const store = als.getStore();
    const text = toPg(sql);
    const r = store ? await store.q(text, params) : await backend.query(text, params);
    return { rows: r.rows, rowCount: r.rowCount };
  };

  const db = {
    kind: backend.kind,
    run,
    query: async (sql, params) => (await run(sql, params)).rows,
    one: async (sql, params) => (await run(sql, params)).rows[0],
    tx(fn) {
      if (als.getStore()) return fn(); // join the surrounding transaction
      return backend.tx((q) => als.run({ q }, fn));
    },
    leader: (key) => backend.leader(key),
    close: () => backend.close(),
  };

  const quiet = !config.databaseUrl && (!config.pgliteDir || config.pgliteDir === ':memory:');
  if (config.migrateOnStart !== false) await migrate(backend, quiet ? { warn() {} } : log);
  return db;
}

// Applies supabase/migrations/*.sql in order, recording them where the Supabase CLI does,
// so `supabase db push` and this runner agree on what has been applied.
async function migrate(backend, log = console) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  await backend.exec(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
  `);
  await backend.tx(async (q) => {
    await q('SELECT pg_advisory_xact_lock(727170)'); // one migrator at a time
    const done = new Set((await q('SELECT version FROM supabase_migrations.schema_migrations')).rows.map((r) => r.version));
    for (const f of files) {
      const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
      if (done.has(version)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      await q(sql);
      await q('SET search_path TO app, public');
      await q('INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3)', [version, rest.join('_'), [sql]]);
      log.warn(`[db] applied migration ${f}`);
    }
  });
}

module.exports = { openDb, toPg, migrate };
