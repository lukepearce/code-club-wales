import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Auth } from './auth';

export interface AppConfig {
  auth: Auth;
  /** Allowed browser origins (the SPA). Echoed back for credentialed CORS. */
  trustedOrigins: string[];
}

/**
 * Build the Hono app: CORS for the SPA, a health probe, and the Better Auth
 * handler mounted at /api/auth/*. Pure function of its config so tests can mount
 * it against an ephemeral auth/db.
 */
export function createApp(config: AppConfig) {
  const app = new Hono();

  app.use(
    '/api/auth/*',
    cors({
      origin: config.trustedOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }, 200));

  // Better Auth owns sign-in / sign-out / get-session / Google callback / etc.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => config.auth.handler(c.req.raw));

  return app;
}

export type App = ReturnType<typeof createApp>;
