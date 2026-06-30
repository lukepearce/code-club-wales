import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import { type Database, schema } from './db/client';

export interface AuthConfig {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  /** When set, the session cookie is shared across subdomains of this domain. */
  cookieDomain?: string;
  google?: { clientId: string; clientSecret: string };
}

/**
 * Build a Better Auth instance bound to a specific Drizzle db.
 *
 * Wiring rules (CONTEXT / PRD #6):
 *  - emailAndPassword with autoSignIn:false  -> a join NEVER mints a session
 *  - username() plugin                       -> canonical identity
 *  - google social provider                  -> optional extra credential
 *  - NO admin plugin, NO magic-link
 *  - Admission is enforced in session.create.before (no-op for now; slice 7)
 */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    appName: 'Code Club Wales',
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(config.db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      // A join request must be inert until the Organiser admits it.
      autoSignIn: false,
    },
    socialProviders: {
      google: {
        clientId: config.google?.clientId ?? '',
        clientSecret: config.google?.clientSecret ?? '',
      },
    },
    plugins: [username()],
    advanced: config.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } }
      : undefined,
    databaseHooks: {
      session: {
        create: {
          // No-op passthrough for now. SLICE 7 wires the Admission gate HERE:
          // load the crew_member for session.userId and refuse to mint the
          // session (return false) when admissionGate.canMintSession(member)
          // is false, with the friendly "waiting to be admitted" message.
          before: async (session) => {
            return { data: session };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
