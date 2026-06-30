import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDb } from './db/client';
import { applyMigrations } from './db/migrate';
import { loadEnv } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  const { db } = createDb(env.databaseUrl);

  // Migrations run as a startup hook (Railway container) before serving.
  await applyMigrations(db);

  const auth = createAuth({
    db,
    secret: env.betterAuthSecret,
    baseURL: env.betterAuthUrl,
    trustedOrigins: env.trustedOrigins,
    cookieDomain: env.cookieDomain,
    google: env.google,
  });

  const app = createApp({ auth, trustedOrigins: env.trustedOrigins });

  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
  });
}

main().catch((error: unknown) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
