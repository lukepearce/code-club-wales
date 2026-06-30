import { z } from 'zod';

/**
 * Raw process.env shape. Everything has a local-friendly default EXCEPT
 * DATABASE_URL, which must always be supplied (Railway provides it in prod;
 * the test harness provides an ephemeral container URL).
 */
const RawEnv = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  BETTER_AUTH_SECRET: z.string().min(1).default('dev-secret-change-me-in-production'),
  BETTER_AUTH_URL: z.string().min(1).default('http://localhost:3000'),
  // Comma-separated. The SPA dev origin by default.
  TRUSTED_ORIGINS: z.string().default('http://localhost:5173'),
  // When set, Better Auth scopes the session cookie to this domain so it is
  // valid across my.* and api.*. Leave unset locally (localhost) so cookies work.
  COOKIE_DOMAIN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  // Comma-separated usernames bootstrapped as Organisers (used by later slices).
  ORGANISER_USERNAMES: z.string().default(''),
});

export interface AppEnv {
  databaseUrl: string;
  port: number;
  betterAuthSecret: string;
  betterAuthUrl: string;
  trustedOrigins: string[];
  cookieDomain?: string;
  google: { clientId: string; clientSecret: string };
  organiserUsernames: string[];
}

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = RawEnv.parse(source);
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET,
    betterAuthUrl: parsed.BETTER_AUTH_URL,
    trustedOrigins: splitList(parsed.TRUSTED_ORIGINS),
    cookieDomain: parsed.COOKIE_DOMAIN || undefined,
    google: { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET },
    organiserUsernames: splitList(parsed.ORGANISER_USERNAMES),
  };
}
