import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { Auth } from './auth';
import type { JoinInput, JoinResult } from './join';

export interface AppConfig {
  auth: Auth;
  /** Allowed browser origins (the SPA). Echoed back for credentialed CORS. */
  trustedOrigins: string[];
  /** The join coordinator, bound to the db + auth factory by the caller. */
  joinCrew: (input: JoinInput) => Promise<JoinResult>;
}

const JoinBody = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string().optional(),
});

/**
 * Build the Hono app: CORS for the SPA, a health probe, the public join
 * endpoint, and the Better Auth handler mounted at /api/auth/*. Pure function of
 * its config so tests can mount it against an ephemeral auth/db.
 */
export function createApp(config: AppConfig) {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: config.trustedOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }, 200));

  // Public "request an account" endpoint. Inert by design: it creates a PENDING
  // crew_member and never mints a session (the Organiser admits later).
  app.post('/api/join', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'bad_request', message: 'Invalid JSON.' }, 400);
    }
    const parsed = JoinBody.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: 'bad_request', message: 'username and password are required.' },
        400,
      );
    }

    const result = await config.joinCrew(parsed.data);
    if (result.ok) {
      return c.json({ ok: true, username: result.username }, 201);
    }
    switch (result.error) {
      case 'invalid_username':
        return c.json({ ok: false, error: result.error, reasons: result.reasons }, 422);
      case 'weak_password':
        return c.json({ ok: false, error: result.error, message: result.message }, 422);
      case 'username_taken':
        return c.json(
          {
            ok: false,
            error: result.error,
            message: 'That username is already taken. Please choose another.',
          },
          409,
        );
      case 'email_taken':
        return c.json(
          { ok: false, error: result.error, message: 'That email is already registered.' },
          409,
        );
      default:
        return c.json({ ok: false, error: 'unknown', message: result.message }, 500);
    }
  });

  // Better Auth owns sign-in / sign-out / get-session / Google callback / etc.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => config.auth.handler(c.req.raw));

  return app;
}

export type App = ReturnType<typeof createApp>;
