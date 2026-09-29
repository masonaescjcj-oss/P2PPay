// The SQL migrations, bundled at build time (read by the fs stand-in).
const files = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })
export const byName = Object.fromEntries(Object.entries(files).map(([p, sql]) => [p.split('/').pop(), sql]))
