// Standalone migration runner. Used as the Railway startup hook (`pnpm migrate`)
// and reused by src/index.ts before serve(). Applies generated Drizzle
// migrations against DATABASE_URL.
import { createDb } from './db/client';
import { applyMigrations } from './db/migrate';
import { loadEnv } from './env';

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await applyMigrations(db);
  } finally {
    await pool.end();
  }
}

// Executed directly (`tsx src/migrate.ts`).
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  runMigrations(env.databaseUrl)
    .then(() => {
      console.log('[migrate] migrations applied');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('[migrate] failed', error);
      process.exit(1);
    });
}
