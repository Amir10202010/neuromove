// Apply pending PostgreSQL migrations (additive only; never drops anything).
//   DATABASE_URL=postgres://… npm run db:migrate
// Uses the same migration code as the API bundle (server/migrate.ts via api/index.js).

const { runMigrations } = await import('../api/index.js');
try {
  const applied = await runMigrations();
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
