import { bootstrap, validate as validateUsername } from '@codeclub/shared';
import { and, eq } from 'drizzle-orm';
import { GOOGLE_PROVIDER_ID } from './auth';
import type { Database } from './db/client';
import { account as accountTable, crewMember, user as userTable } from './db/schema';

/**
 * google — the "pick a username" completion coordinator for a Google join.
 *
 * A Google sign-in by an UNKNOWN identity lands as a PENDING crew_member with NO
 * username (the account-create hook in auth.ts mints the pending row; the
 * username plugin assigns no username on a social sign-up). This coordinator is
 * the completion step: a chosen username is canonicalised, claimed on the Better
 * Auth user, and — like every join — left subject to Admission (the gate refuses
 * a session until the Organiser admits the member).
 *
 * It COMPOSES the pure modules — usernamePolicy.validate (the single username
 * validator) and organiserPolicy.bootstrap (a configured Organiser username is
 * flagged + admitted on the spot, mirroring the email-join path). The user and
 * crew_member writes run in ONE transaction, so a claimed username and an
 * Organiser bootstrap are all-or-nothing.
 *
 * Eligibility is the authorisation: the endpoint is public (the pending member
 * has no session — the gate refused one), so completion is allowed ONLY for a
 * user that still needs it — one that has a Google account, has NO username yet,
 * and has a crew_member row. That makes the call idempotent-safe (a completed
 * member already has a username, so a second attempt is refused) and unusable
 * against an email+password account (which already carries a username).
 */

export interface CompleteGoogleJoinInput {
  /** The pending Google user's id (from the post-OAuth completion redirect). */
  userId: string;
  /** The username the person is choosing. Validated + normalised here. */
  username: string;
}

export type CompleteGoogleJoinResult =
  | { ok: true; username: string; admitted: boolean }
  | { ok: false; error: 'invalid_username'; reasons: string[] }
  | { ok: false; error: 'username_taken' }
  // Not a pending, not-yet-completed Google identity (unknown id, no Google
  // account, or a username is already set). One code, no enumeration.
  | { ok: false; error: 'not_eligible' }
  | { ok: false; error: 'unknown'; message: string };

export interface CompleteGoogleJoinDeps {
  /** The pooled db; the coordinator opens the transaction on it. */
  db: Database;
  /**
   * Usernames pre-configured as Organisers (the `ORGANISER_USERNAMES` list). A
   * Google joiner who picks a matching username is bootstrapped by the shared
   * organiserPolicy — flagged `is_organiser` AND admitted on the spot — in the
   * same transaction, exactly as the email-join coordinator does.
   */
  organiserUsernames: readonly string[];
}

/** Internal control-flow signal: abort the transaction with a typed result. */
class CompleteAbort extends Error {
  constructor(readonly result: Extract<CompleteGoogleJoinResult, { ok: false }>) {
    super(result.error);
    this.name = 'CompleteAbort';
  }
}

export async function completeGoogleJoin(
  deps: CompleteGoogleJoinDeps,
  input: CompleteGoogleJoinInput,
): Promise<CompleteGoogleJoinResult> {
  // 1. Canonical identity. The shared policy is the single validator.
  const validation = validateUsername(input.username);
  if (!validation.ok) {
    return { ok: false, error: 'invalid_username', reasons: validation.reasons };
  }
  const username = validation.value;
  // The friendly, as-typed value (mirrors the username plugin's displayUsername).
  const displayUsername = input.username.trim();
  const now = new Date();

  try {
    const admitted = await deps.db.transaction(async (tx) => {
      // 2. Resolve the user + its crew_member. Eligible only when the user
      //    exists, has NO username yet (not already completed / not a
      //    credential account), and has a crew_member row.
      const rows = await tx
        .select({
          username: userTable.username,
          memberId: crewMember.id,
        })
        .from(userTable)
        .leftJoin(crewMember, eq(crewMember.user_id, userTable.id))
        .where(eq(userTable.id, input.userId))
        .limit(1);
      const row = rows[0];
      if (!row || row.username != null || row.memberId == null) {
        throw new CompleteAbort({ ok: false, error: 'not_eligible' });
      }

      // 3. ...and only for a GOOGLE identity (this endpoint completes Google
      //    joins, not anything else).
      const googleAccount = await tx
        .select({ id: accountTable.id })
        .from(accountTable)
        .where(
          and(
            eq(accountTable.userId, input.userId),
            eq(accountTable.providerId, GOOGLE_PROVIDER_ID),
          ),
        )
        .limit(1);
      if (googleAccount.length === 0) {
        throw new CompleteAbort({ ok: false, error: 'not_eligible' });
      }

      // 4. Username availability. Pre-check for a clean code; the unique
      //    constraint (23505 below) is the real race guard.
      const taken = await tx
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.username, username))
        .limit(1);
      if (taken.length > 0) {
        throw new CompleteAbort({ ok: false, error: 'username_taken' });
      }

      // 5. Claim the username on the Better Auth user (canonical + friendly).
      await tx
        .update(userTable)
        .set({ username, displayUsername, updatedAt: now })
        .where(eq(userTable.id, input.userId));

      // 6. Organiser bootstrap (pure policy). A configured Organiser username is
      //    flagged AND admitted on the spot; everyone else stays PENDING (the
      //    hook already set is_organiser false / admitted_at null), awaiting
      //    Admission. display_name keeps its Google-name default.
      const decision = bootstrap(username, deps.organiserUsernames);
      if (decision.admit) {
        await tx
          .update(crewMember)
          .set({ is_organiser: decision.is_organiser, admitted_at: now, updated_at: now })
          .where(eq(crewMember.user_id, input.userId));
      }
      return decision.admit;
    });
    return { ok: true, username, admitted };
  } catch (err) {
    if (err instanceof CompleteAbort) {
      return err.result;
    }
    // Postgres unique violation — a completion that raced another to the username.
    if (isUniqueViolation(err)) {
      return { ok: false, error: 'username_taken' };
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
