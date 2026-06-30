import { canMintSession, validate as validateUsername } from '@codeclub/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { type DbOrTx, schema } from './db/client';
import { crewMember } from './db/schema';

/** Shown when a pending Crew member is refused a session at the Admission gate. */
export const PENDING_ADMISSION_MESSAGE = 'You are waiting to be admitted by the Organiser.';

/** Username length bounds — the canonical rule lives in usernamePolicy. */
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 20;

export interface AuthConfig {
  db: DbOrTx;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  /** When set, the session cookie is shared across subdomains of this domain. */
  cookieDomain?: string;
  google?: { clientId: string; clientSecret: string };
}

/**
 * Build a Better Auth instance bound to a specific Drizzle db (or transaction).
 *
 * Wiring rules (CONTEXT / PRD #6):
 *  - emailAndPassword with autoSignIn:false  -> a join NEVER mints a session
 *  - username() plugin, validated by the shared usernamePolicy (single source
 *    of truth for "valid username", so Better Auth never rejects a name the
 *    domain policy accepts, nor accepts one it rejects)
 *  - google social provider                  -> optional extra credential
 *  - NO admin plugin, NO magic-link
 *  - Admission is enforced in session.create.before: a pending member
 *    (crew_member.admitted_at is null) is refused a session with a friendly
 *    message. This single hook covers password sign-in, the Google callback,
 *    and any auto-session.
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
    plugins: [
      username({
        minUsernameLength: MIN_USERNAME_LENGTH,
        maxUsernameLength: MAX_USERNAME_LENGTH,
        // Compose the shared policy: charset [a-z0-9_-], 3-20, reserved denylist.
        usernameValidator: (value) => validateUsername(value).ok,
      }),
    ],
    advanced: config.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } }
      : undefined,
    databaseHooks: {
      session: {
        create: {
          // The Admission gate. Runs before ANY session is minted. Load the
          // crew_member for the signing-in user and refuse (throw a friendly
          // 403) unless admissionGate.canMintSession(member) is true.
          before: async (session) => {
            const rows = await config.db
              .select({ admitted_at: crewMember.admitted_at })
              .from(crewMember)
              .where(eq(crewMember.user_id, session.userId))
              .limit(1);
            const member = rows[0];
            if (!member || !canMintSession(member)) {
              throw new APIError('FORBIDDEN', {
                code: 'PENDING_ADMISSION',
                message: PENDING_ADMISSION_MESSAGE,
              });
            }
            return { data: session };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
