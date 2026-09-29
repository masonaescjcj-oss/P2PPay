'use strict';

// Applies supabase/migrations/*.sql to DATABASE_URL (or the local PGlite) and exits.
// Used as Fly.io's release_command, so a deploy only goes live once its schema is in place.
const config = require('../config');
const { openDb } = require('../db');

(async () => {
  const db = await openDb({ ...config, migrateOnStart: true });
  const rows = await db.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version');
  console.log(`[migrate] ${db.kind}: ${rows.length} migration(s) applied: ${rows.map((r) => `${r.version}_${r.name}`).join(', ')}`);
  await db.close();
})().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
