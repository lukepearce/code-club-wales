import { isSynthetic } from '@codeclub/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Database } from './db/client';
import { user as userTable } from './db/schema';

/**
 * account — the signed-in member's "set my email" coordinator.
 *
 * In v1 the email is contact metadata that NOTHING depends on: sign-in is by
 * username, the Admission gate never consults it, and no email is ever sent
 * (ADR: no magic-link). So a member may replace the synthetic placeholder minted
 * at a username-only join (username@synthetic.codeclub.wales) with a real address
 * with NO verification step — the deliberate opposite of Better Auth's
 * changeEmail flow, which routes through email verification.
 *
 * Better Auth's own updateUser endpoint REFUSES email changes
 * (EMAIL_CAN_NOT_BE_UPDATED), and changeEmail carries verification machinery we
 * explicitly do not want. So this coordinator writes the email directly through
 * the same server-side primitive the reset coordinator uses for passwords —
 * ctx.internalAdapter.updateUser(userId, { email }) — verified against the
 * installed @better-auth/core context .d.mts (AuthContext.internalAdapter). The
 * auth-gated route supplies userId from the SESSION; this module never trusts a
 * client-supplied id, so a member can only ever change their own email.
 *
 * It COMPOSES the pure syntheticEmail module: a "real" email may not itself sit
 * on the synthetic placeholder domain, so setting one there is rejected. Once a
 * real address is saved, syntheticEmail.isSynthetic(user.email) reads false — the
 * account is no longer a placeholder.
 */

/** Reasonable email shape: a local part, an @, and a dotted domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SetEmailInput {
  /** The signed-in member's id, resolved from the session by the route. */
  userId: string;
  /** The new contact email. Normalised (trimmed + lowercased) here. */
  email: string;
}

export type SetEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: 'invalid_email'; message: string }
  | { ok: false; error: 'email_taken'; message: string }
  | { ok: false; error: 'unknown'; message: string };

export interface SetEmailDeps {
  /** The pooled db; used to pre-check email uniqueness for a clean error code. */
  db: Database;
  /** The Better Auth instance whose internal adapter writes the email. */
  auth: Auth;
}

export async function setEmail(deps: SetEmailDeps, input: SetEmailInput): Promise<SetEmailResult> {
  // Canonical contact address: emails are case-insensitive, so store lowercase
  // (matching what internalAdapter.updateUser itself persists).
  const email = input.email.trim().toLowerCase();

  // Shape check — this coordinator is the single owner of email policy here.
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'invalid_email', message: 'Enter a valid email address.' };
  }
  // A REAL email must not live on the synthetic, non-deliverable placeholder
  // domain. Composing the pure module keeps that domain suffix in one place.
  if (isSynthetic(email)) {
    return {
      ok: false,
      error: 'invalid_email',
      message: 'Enter a real email address, not a placeholder.',
    };
  }

  try {
    // Pre-check for a clean machine code; the user.email UNIQUE constraint
    // (23505 below) is the real race guard. Exclude self so re-saving the same
    // address is a harmless no-op rather than a false "taken".
    const clash = await deps.db
      .select({ id: userTable.id })
      .from(userTable)
      .where(and(eq(userTable.email, email), ne(userTable.id, input.userId)))
      .limit(1);
    if (clash.length > 0) {
      return { ok: false, error: 'email_taken', message: 'That email is already registered.' };
    }

    // Set the email directly — NO verification. Same server-side primitive the
    // reset flow uses for passwords. emailVerified is left untouched (stays
    // false): nothing in v1 depends on a verified email.
    const ctx = await deps.auth.$context;
    await ctx.internalAdapter.updateUser(input.userId, { email });

    return { ok: true, email };
  } catch (err) {
    // A change that raced another to the same address trips the unique index.
    if (isUniqueViolation(err)) {
      return { ok: false, error: 'email_taken', message: 'That email is already registered.' };
    }
    return {
      ok: false,
      error: 'unknown',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}
