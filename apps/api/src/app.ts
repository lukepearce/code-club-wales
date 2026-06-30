import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { Auth } from './auth';
import type { Database } from './db/client';
import type { JoinInput, JoinResult } from './join';
import { createOrganiserApp } from './organiser';

export interface AppConfig {
  auth: Auth;
  /** The pooled db. Used by the Organiser routes to read/gate crew_member rows. */
  db: Database;
  /** Allowed browser origins (the SPA). Echoed back for credentialed CORS. */
  trustedOrigins: string[];
  /** The join coordinator, bound to the db + auth factory by the caller. */
  joinCrew: (input: JoinInput) => Promise<JoinResult>;
}

const JoinBody = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string().optional(),
  // The Turnstile widget's token. Optional at the schema level so a missing
  // token reaches the coordinator's bot gate (which rejects it) rather than
  // failing as a generic bad request — keeping ALL Turnstile policy in one place.
  turnstileToken: z.string().optional(),
});

/**
 * Best-effort client IP for Cloudflare's optional `remoteip`. Prefer
 * `cf-connecting-ip` (set by Cloudflare), else the first hop of
 * `x-forwarded-for`. Absent in local/test requests — the verifier omits
 * remoteip when this is undefined.
 */
function clientIp(c: Context): string | undefined {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  const forwarded = c.req.header('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || undefined;
}

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

    const result = await config.joinCrew({
      username: parsed.data.username,
      password: parsed.data.password,
      email: parsed.data.email,
      // A missing token becomes '' so the coordinator's bot gate rejects it.
      turnstileToken: parsed.data.turnstileToken ?? '',
      ip: clientIp(c),
    });
    if (result.ok) {
      return c.json({ ok: true, username: result.username }, 201);
    }
    switch (result.error) {
      case 'turnstile_failed':
        return c.json(
          {
            ok: false,
            error: result.error,
            message: 'Bot check failed. Please complete the challenge and try again.',
          },
          403,
        );
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

  // Organiser-only surface: list / admit / reject members. Each route is gated
  // by the Organiser check inside createOrganiserApp (403 for non-Organisers).
  app.route('/api/organiser', createOrganiserApp({ auth: config.auth, db: config.db }));

  // Better Auth owns sign-in / sign-out / get-session / Google callback / etc.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => config.auth.handler(c.req.raw));

  return app;
}

export type App = ReturnType<typeof createApp>;
