import { serve } from '@hono/node-server';
import { createTurnstileVerifier } from '@codeclub/shared';
import { createApp } from './app';
import { createAuth } from './auth';
import { createDb, type DbOrTx } from './db/client';
import { applyMigrations } from './db/migrate';
import { loadEnv } from './env';
import { joinCrew, type JoinInput } from './join';
import { resetPassword, type ResetInput } from './reset';

async function main(): Promise<void> {
  const env = loadEnv();
  const { db } = createDb(env.databaseUrl);

  // Migrations run as a startup hook (Railway container) before serving.
  await applyMigrations(db);

  // One auth-config builder, reused for the pooled instance and for the
  // transaction-bound instance the join coordinator needs (so signUp + the
  // crew_member insert share a transaction).
  const makeAuth = (database: DbOrTx) =>
    createAuth({
      db: database,
      secret: env.betterAuthSecret,
      baseURL: env.betterAuthUrl,
      trustedOrigins: env.trustedOrigins,
      cookieDomain: env.cookieDomain,
      google: env.google,
    });

  const auth = makeAuth(db);

  // Turnstile verifier bound to the real secret + the platform fetch. The join
  // coordinator is the ONLY consumer (the join path is the only bot-gated path).
  const turnstile = createTurnstileVerifier({
    secret: env.turnstileSecret,
    fetch: (url, init) => fetch(url, init),
  });

  const app = createApp({
    auth,
    db,
    trustedOrigins: env.trustedOrigins,
    joinCrew: (input: JoinInput) =>
      joinCrew({ db, makeAuth, organiserUsernames: env.organiserUsernames, turnstile }, input),
    resetPassword: (input: ResetInput) => resetPassword({ db, makeAuth }, input),
  });

  serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
  });
}

main().catch((error: unknown) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
