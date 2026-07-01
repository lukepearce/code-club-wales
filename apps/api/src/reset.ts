import { consume, normalize as normalizeUsername } from '@codeclub/shared';
import { eq } from 'drizzle-orm';
import type { Auth } from './auth';
import type { Database, DbOrTx } from './db/client';
import { crewMember, user as userTable } from './db/schema';

/**
 * reset — the public, email-free "set a new password" coordinator.
 *
 * v1 auth sends NO email (ADR: no magic-link). A waiting member instead asks the
 * Organiser, who opens a short reset window (crew_member.reset_allowed_until, set
 * by the Organiser surface to resetWindow.open(now)). This coordinator is the
 * ONLY place that window is spent: a SIGNED-OUT member POSTs their username + a
 * new password, and the password is changed iff the window is currently open.
 *
 * It COMPOSES the pure modules — usernamePolicy.normalize (to match the stored,
 * canonical username) and resetWindow.consume (the window decision + the cleared
 * value to persist) — with Better Auth's server-side password API. The Organiser
 * never sees or sets the password: this path has no Organiser involvement beyond
 * the window already being open.
 *
 * Atomicity mirrors the join coordinator: the password write AND the window-clear
 * run inside ONE Postgres transaction by binding a Better Auth instance to the
 * transaction handle (makeAuth(tx)). So a successful reset always clears the
 * window (it cannot be reused), and a failure leaves both untouched.
 *
 * Server-side password set: there is no session here (the member is signed out)
 * and no admin plugin, so we use the same primitives Better Auth's own
 * reset-password route uses once it has authorised the change —
 * ctx.password.hash + internalAdapter.updatePassword (or createAccount for the
 * rare member with no credential account yet). Verified against the installed
 * @better-auth/core .d.ts (AuthContext.password / AuthContext.internalAdapter).
 */

/** Better Auth's credential provider id (the email+password account row). */
const CREDENTIAL_PROVIDER_ID = 'credential';

export interface ResetInput {
  /** The member's username (canonical identity). Normalised before lookup. */
  username: string;
  /** The new password the SIGNED-OUT member is setting for themselves. */
  newPassword: string;
}

export type ResetResult =
  | { ok: true }
  // No open window (none was opened, it expired, or no such member). The UI
  // turns this into the friendly "ask the Organiser" message. Deliberately the
  // same code for "unknown username" so the endpoint does not leak which
  // usernames exist — the window, not username secrecy, is the real gate.
  | { ok: false; error: 'window_closed' }
  | { ok: false; error: 'weak_password'; message: string }
  | { ok: false; error: 'unknown'; message: string };

export interface ResetDeps {
  /** The pooled db; the coordinator opens the transaction on it. */
  db: Database;
  /** Build a Better Auth instance bound to a given db/transaction handle. */
  makeAuth: (db: DbOrTx) => Auth;
}

/** Internal control-flow signal: abort the transaction with a typed result. */
class ResetAbort extends Error {
  constructor(readonly result: Extract<ResetResult, { ok: false }>) {
    super(result.error);
    this.name = 'ResetAbort';
  }
}

export async function resetPassword(deps: ResetDeps, input: ResetInput): Promise<ResetResult> {
  // The coordinator owns the clock; the pure window policy compares against it.
  const now = new Date();
  // Match the stored, canonical username (join persisted the normalised value).
  const username = normalizeUsername(input.username);

  try {
    await deps.db.transaction(async (tx) => {
      // 1. Resolve the member by username. A missing member is reported as a
      //    closed window (no enumeration, consistent "ask the Organiser" UX).
      const rows = await tx
        .select({
          userId: userTable.id,
          reset_allowed_until: crewMember.reset_allowed_until,
        })
        .from(crewMember)
        .innerJoin(userTable, eq(userTable.id, crewMember.user_id))
        .where(eq(userTable.username, username))
        .limit(1);
      const member = rows[0];
      if (!member) {
        throw new ResetAbort({ ok: false, error: 'window_closed' });
      }

      // 2. The window decision (pure). consume() composes isOpen and yields the
      //    cleared value to persist; a closed/expired/absent window refuses. We
      //    spend (persist) that cleared value only after the password is set.
      const decision = consume({ reset_allowed_until: member.reset_allowed_until }, now);
      if (!decision.ok) {
        throw new ResetAbort({ ok: false, error: 'window_closed' });
      }

      // 3. Better Auth bound to THIS transaction — its server-side password
      //    primitives now write through the same tx as the window-clear below.
      const auth = deps.makeAuth(tx);
      const ctx = await auth.$context;

      // Validate against Better Auth's own password config (single source of
      // truth). Done after the window check so a closed window never reveals the
      // policy, and before any write so a too-short password leaves the window
      // OPEN for an immediate retry.
      const { minPasswordLength, maxPasswordLength } = ctx.password.config;
      if (input.newPassword.length < minPasswordLength) {
        throw new ResetAbort({
          ok: false,
          error: 'weak_password',
          message: `Password must be at least ${minPasswordLength} characters.`,
        });
      }
      if (input.newPassword.length > maxPasswordLength) {
        throw new ResetAbort({
          ok: false,
          error: 'weak_password',
          message: `Password must be at most ${maxPasswordLength} characters.`,
        });
      }

      // 4. Set the password server-side (no session, no admin plugin). Same
      //    primitives Better Auth's reset-password route uses post-authorisation.
      const hashedPassword = await ctx.password.hash(input.newPassword);
      const accounts = await ctx.internalAdapter.findAccounts(member.userId);
      const hasCredential = accounts.some((acc) => acc.providerId === CREDENTIAL_PROVIDER_ID);
      if (hasCredential) {
        await ctx.internalAdapter.updatePassword(member.userId, hashedPassword);
      } else {
        await ctx.internalAdapter.createAccount({
          userId: member.userId,
          providerId: CREDENTIAL_PROVIDER_ID,
          accountId: member.userId,
          password: hashedPassword,
        });
      }

      // 5. Spend the window: persist the cleared value the policy yielded, so the
      //    same window cannot be used again. Atomic with the password write.
      await tx
        .update(crewMember)
        .set({ reset_allowed_until: decision.reset_allowed_until, updated_at: now })
        .where(eq(crewMember.user_id, member.userId));
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ResetAbort) {
      return err.result;
    }
    return {
      ok: false,
      error: 'unknown',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
