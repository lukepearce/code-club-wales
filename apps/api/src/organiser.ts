import { isOrganiser } from '@codeclub/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from './auth';
import type { Database } from './db/client';
import { crewMember, user as userTable } from './db/schema';

/**
 * organiser — the Organiser-only surface.
 *
 * Three routes let the person who runs the club review and gate Crew members:
 *   GET    /members                  list everyone (pending + active)
 *   POST   /members/:userId/admit    stamp admitted_at → the member can sign in
 *   POST   /members/:userId/reject   delete the user + crew_member, freeing the
 *                                    username for re-use
 *
 * Every route sits behind one guard: resolve the caller's Better Auth session,
 * load their crew_member, and consult the shared organiserPolicy.isOrganiser.
 * Anyone who is not a confirmed Organiser is refused with 403 — there is no
 * Better Auth admin plugin and the word "admin" appears nowhere here.
 *
 * Mounted by the main app at /api/organiser, so the parent's CORS middleware
 * (/api/*) already applies.
 */

export interface OrganiserDeps {
  /** Better Auth instance, used to resolve the caller's session from headers. */
  auth: Auth;
  /** The pooled db, for reading/stamping/deleting crew_member + user rows. */
  db: Database;
}

/** A member as the Organiser UI sees it. Dates are ISO strings (JSON-friendly). */
export interface OrganiserMemberView {
  userId: string;
  /** Canonical username (lowercased). Nullable only because the column is. */
  username: string | null;
  /** Friendly-cased username from the username plugin. */
  displayUsername: string | null;
  /** crew_member.display_name (defaults from the username at join). */
  displayName: string;
  isOrganiser: boolean;
  /** When Admission was granted; null while pending. */
  admittedAt: string | null;
  createdAt: string;
  /** Derived: pending until admitted_at is stamped, then active. */
  status: 'pending' | 'active';
}

export function createOrganiserApp(deps: OrganiserDeps): Hono {
  const app = new Hono();

  // The Organiser gate. Runs before every route below. A caller is allowed
  // through only with a valid session whose crew_member carries the Organiser
  // flag; every other caller (anonymous, or signed-in-but-not-Organiser) is
  // refused with 403.
  app.use('*', async (c, next) => {
    const authed = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    const userId = authed?.user.id;
    if (userId) {
      const rows = await deps.db
        .select({ is_organiser: crewMember.is_organiser })
        .from(crewMember)
        .where(eq(crewMember.user_id, userId))
        .limit(1);
      const member = rows[0];
      if (member && isOrganiser(member)) {
        await next();
        return;
      }
    }
    return c.json({ ok: false, error: 'forbidden', message: 'Organisers only.' }, 403);
  });

  // List every Crew member, pending and active, oldest first.
  app.get('/members', async (c) => {
    const rows = await deps.db
      .select({
        userId: crewMember.user_id,
        username: userTable.username,
        displayUsername: userTable.displayUsername,
        displayName: crewMember.display_name,
        isOrganiser: crewMember.is_organiser,
        admittedAt: crewMember.admitted_at,
        createdAt: crewMember.created_at,
      })
      .from(crewMember)
      .innerJoin(userTable, eq(userTable.id, crewMember.user_id))
      .orderBy(crewMember.created_at);

    const members: OrganiserMemberView[] = rows.map((r) => ({
      userId: r.userId,
      username: r.username,
      displayUsername: r.displayUsername,
      displayName: r.displayName,
      isOrganiser: r.isOrganiser,
      admittedAt: r.admittedAt ? r.admittedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      status: r.admittedAt ? 'active' : 'pending',
    }));

    return c.json({ ok: true, members }, 200);
  });

  // Admit a pending member: stamp admitted_at so the Admission gate lets them
  // mint a session. Idempotent — re-admitting an already-active member keeps the
  // original timestamp and still succeeds.
  app.post('/members/:userId/admit', async (c) => {
    const userId = c.req.param('userId');
    const rows = await deps.db
      .select({ admitted_at: crewMember.admitted_at })
      .from(crewMember)
      .where(eq(crewMember.user_id, userId))
      .limit(1);
    const member = rows[0];
    if (!member) {
      return c.json({ ok: false, error: 'not_found', message: 'No such member.' }, 404);
    }
    if (member.admitted_at == null) {
      const now = new Date();
      await deps.db
        .update(crewMember)
        .set({ admitted_at: now, updated_at: now })
        .where(eq(crewMember.user_id, userId));
    }
    return c.json({ ok: true }, 200);
  });

  // Reject a member: remove the crew_member AND the user row in one transaction,
  // freeing the (unique) username + email for re-use. Refuse to reject an
  // Organiser so the club cannot delete its own runner.
  app.post('/members/:userId/reject', async (c) => {
    const userId = c.req.param('userId');
    const rows = await deps.db
      .select({ is_organiser: crewMember.is_organiser })
      .from(crewMember)
      .where(eq(crewMember.user_id, userId))
      .limit(1);
    const member = rows[0];
    if (!member) {
      return c.json({ ok: false, error: 'not_found', message: 'No such member.' }, 404);
    }
    if (isOrganiser(member)) {
      return c.json(
        {
          ok: false,
          error: 'cannot_reject_organiser',
          message: 'You cannot reject an Organiser.',
        },
        409,
      );
    }

    await deps.db.transaction(async (tx) => {
      // Child first, then parent. Deleting the user also cascades session +
      // account rows (FKs are ON DELETE cascade).
      await tx.delete(crewMember).where(eq(crewMember.user_id, userId));
      await tx.delete(userTable).where(eq(userTable.id, userId));
    });

    return c.json({ ok: true }, 200);
  });

  return app;
}

export type OrganiserApp = ReturnType<typeof createOrganiserApp>;
