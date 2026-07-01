import { canMintSession, validate as validateUsername } from '@codeclub/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { type DbOrTx, schema } from './db/client';
import { crewMember, user as userTable } from './db/schema';

/** Shown when a pending Crew member is refused a session at the Admission gate. */
export const PENDING_ADMISSION_MESSAGE = 'You are waiting to be admitted by the Organiser.';

/**
 * Better Auth's provider id for a Google `account` row. A Google sign-in is the
 * ONLY social path in v1, so this single id distinguishes a Google join from the
 * email+password (`credential`) join in the account-create hook below.
 */
export const GOOGLE_PROVIDER_ID = 'google';

/** Fallback display_name for a Google join whose profile carries no name. */
const DEFAULT_DISPLAY_NAME = 'Crew member';

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
    // Account linking (slice 6). A SIGNED-IN member may link Google to their
    // existing account (authClient.linkSocial), after which either password or
    // Google reaches the same crew_member. Manual linking (account.mjs) refuses
    // unless the provider is trusted OR the member's email is verified — v1
    // members are unverified, so google MUST be trusted here. And because a
    // member's email (a synthetic placeholder or a self-set contact address)
    // rarely matches their Google email, allowDifferentEmails must be true;
    // this is safe as the member is authenticated and explicitly linking their
    // own account. This governs MANUAL linking only; the stranger "Sign in with
    // Google" join (slice 5) is unaffected.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [GOOGLE_PROVIDER_ID],
        allowDifferentEmails: true,
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
      account: {
        create: {
          // Google-join seam. When Better Auth creates a Google `account` row
          // for an UNKNOWN identity (first sign-in), there is no crew_member and
          // — because the username plugin assigns no username on a social
          // sign-up — no username yet. Mint a PENDING crew_member here (the same
          // pending state a username+password join lands in), with display_name
          // defaulted from the Google profile name. The person then completes the
          // pick-a-username step (see completeGoogleJoin) and waits for Admission
          // exactly like any other join.
          //
          // Fires for EVERY account create, so it is a no-op for anything but
          // Google: the email+password join writes a 'credential' account (and
          // its own crew_member in the join transaction), and a future Google
          // LINK to an existing member (slice 6) already has a crew_member — the
          // existence check below makes this idempotent for both.
          //
          // Timing: create.after runs once the createOAuthUser transaction has
          // committed (queueAfterTransactionHook), so this write sees the
          // committed user row and persists even though the very next step — the
          // session.create.before gate — refuses a session to the pending member.
          after: async (account) => {
            if (account.providerId !== GOOGLE_PROVIDER_ID) return;
            const existing = await config.db
              .select({ id: crewMember.id })
              .from(crewMember)
              .where(eq(crewMember.user_id, account.userId))
              .limit(1);
            if (existing.length > 0) return;
            const rows = await config.db
              .select({ name: userTable.name })
              .from(userTable)
              .where(eq(userTable.id, account.userId))
              .limit(1);
            const displayName = rows[0]?.name?.trim() || DEFAULT_DISPLAY_NAME;
            await config.db.insert(crewMember).values({
              user_id: account.userId,
              display_name: displayName,
              is_organiser: false,
              // PENDING: no Admission yet (cannot mint a session).
              admitted_at: null,
            });
          },
        },
      },
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
