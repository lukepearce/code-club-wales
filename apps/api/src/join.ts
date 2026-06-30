import { forUsername, validate as validateUsername } from '@codeclub/shared';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Database, DbOrTx } from './db/client';
import { crewMember, user as userTable } from './db/schema';

/**
 * join — the public "request an account" coordinator.
 *
 * COMPOSES the pure domain modules (usernamePolicy.validate, syntheticEmail.
 * forUsername) and Better Auth's signUp. The result is a Crew member in the
 * PENDING state: the Better Auth user + a crew_member row with admitted_at null.
 * Because emailAndPassword.autoSignIn is off, the join mints no session; the
 * Admission gate (session.create.before) keeps it that way until the Organiser
 * admits the member.
 *
 * Atomicity: the Better Auth signUp (user + credential account) AND the
 * crew_member insert run inside ONE Postgres transaction by binding a Better
 * Auth instance to the transaction handle. Any failure rolls back every write,
 * so a join never leaves an orphan user without a crew_member.
 */

/** Better Auth's default minimum password length. */
const MIN_PASSWORD_LENGTH = 8;

export interface JoinInput {
  username: string;
  password: string;
  /** Optional real email; when absent a synthetic placeholder is derived. */
  email?: string | undefined;
}

export type JoinResult =
  | { ok: true; userId: string; username: string }
  | { ok: false; error: 'invalid_username'; reasons: string[] }
  | { ok: false; error: 'username_taken' }
  | { ok: false; error: 'email_taken' }
  | { ok: false; error: 'weak_password'; message: string }
  | { ok: false; error: 'unknown'; message: string };

export interface JoinDeps {
  /** The pooled db; the coordinator opens the transaction on it. */
  db: Database;
  /** Build a Better Auth instance bound to a given db/transaction handle. */
  makeAuth: (db: DbOrTx) => Auth;
}

/** Internal control-flow signal: abort the transaction with a typed result. */
class JoinAbort extends Error {
  constructor(readonly result: Extract<JoinResult, { ok: false }>) {
    super(result.error);
    this.name = 'JoinAbort';
  }
}

export async function joinCrew(deps: JoinDeps, input: JoinInput): Promise<JoinResult> {
  // 1. Canonical identity. The shared policy is the single validator.
  const validation = validateUsername(input.username);
  if (!validation.ok) {
    return { ok: false, error: 'invalid_username', reasons: validation.reasons };
  }
  const username = validation.value;

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: 'weak_password',
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  // 2. Email: the given one (normalised) or a synthetic, non-deliverable
  //    placeholder derived from the username.
  const provided = input.email?.trim();
  const email = provided ? provided.toLowerCase() : forUsername(username);

  // 3. One transaction: Better Auth signUp + the crew_member row.
  try {
    const userId = await deps.db.transaction(async (tx) => {
      // Pre-checks yield clean machine codes for the UI. The DB unique
      // constraints + this transaction are the real race guard (23505 below).
      const existingUsername = await tx
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.username, username))
        .limit(1);
      if (existingUsername.length > 0) {
        throw new JoinAbort({ ok: false, error: 'username_taken' });
      }
      const existingEmail = await tx
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.email, email))
        .limit(1);
      if (existingEmail.length > 0) {
        throw new JoinAbort({ ok: false, error: 'email_taken' });
      }

      // Better Auth bound to THIS transaction: user + credential account.
      const auth = deps.makeAuth(tx);
      const { user: created } = await auth.api.signUpEmail({
        body: { username, email, password: input.password, name: username },
      });

      // The domain row, PENDING by default (admitted_at null). display_name
      // defaults from the username.
      await tx.insert(crewMember).values({
        user_id: created.id,
        display_name: username,
      });

      return created.id;
    });
    return { ok: true, userId, username };
  } catch (err) {
    return mapJoinError(err);
  }
}

function mapJoinError(err: unknown): Extract<JoinResult, { ok: false }> {
  if (err instanceof JoinAbort) {
    return err.result;
  }
  // Postgres unique violation — a join that raced another to the same identity.
  if (isUniqueViolation(err)) {
    const constraint = String((err as { constraint?: unknown }).constraint ?? '');
    return constraint.includes('email')
      ? { ok: false, error: 'email_taken' }
      : { ok: false, error: 'username_taken' };
  }
  if (err instanceof APIError) {
    const message = String(err.body?.message ?? err.message ?? '');
    const lower = message.toLowerCase();
    if (lower.includes('username') && lower.includes('taken')) {
      return { ok: false, error: 'username_taken' };
    }
    if (lower.includes('password')) {
      return { ok: false, error: 'weak_password', message };
    }
    return { ok: false, error: 'unknown', message };
  }
  return {
    ok: false,
    error: 'unknown',
    message: err instanceof Error ? err.message : 'Unknown error',
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}
