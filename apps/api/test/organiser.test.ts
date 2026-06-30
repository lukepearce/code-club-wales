import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crewMember, user as userTable } from '../src/db/schema';
import { setupTestApp, type TestHarness } from './harness';

// The club's Organiser is bootstrapped from this list. A join with this exact
// username is auto-flagged + auto-admitted; everyone else joins PENDING.
const ORGANISER_USERNAMES = ['orla'];
const PASSWORD = 'correct-horse-battery';

let h: TestHarness;
// Captured in the bootstrap test (runs first) and reused to authenticate the
// Organiser-only requests in the later tests.
let organiserCookie = '';

beforeAll(async () => {
  h = await setupTestApp({ organiserUsernames: ORGANISER_USERNAMES });
});

afterAll(async () => {
  await h.teardown();
});

function postJoin(body: Record<string, unknown>): Promise<Response> {
  return h.request('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function signIn(username: string, password: string): Promise<Response> {
  return h.request('/api/auth/sign-in/username', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/** Rebuild a Cookie header from a response's Set-Cookie list. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ');
}

/** Join, admit (direct flip), then sign in — returns the member's session cookie. */
async function joinAdmitSignIn(username: string): Promise<string> {
  await postJoin({ username, password: PASSWORD });
  await h.admitByUsername(username);
  const res = await signIn(username, PASSWORD);
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

function listMembers(cookie?: string): Promise<Response> {
  return h.request('/api/organiser/members', cookie ? { headers: { cookie } } : undefined);
}

function admit(userId: string, cookie?: string): Promise<Response> {
  return h.request(`/api/organiser/members/${userId}/admit`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

function reject(userId: string, cookie?: string): Promise<Response> {
  return h.request(`/api/organiser/members/${userId}/reject`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

async function memberByUsername(username: string) {
  const userRows = await h.db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, username))
    .limit(1);
  const found = userRows[0];
  if (!found) return undefined;
  const memberRows = await h.db
    .select()
    .from(crewMember)
    .where(eq(crewMember.user_id, found.id))
    .limit(1);
  return memberRows[0];
}

interface MemberView {
  userId: string;
  username: string | null;
  isOrganiser: boolean;
  admittedAt: string | null;
  status: 'pending' | 'active';
}

describe('Organiser Admission surface', () => {
  it('bootstraps a configured username as an auto-admitted Organiser; others join pending', async () => {
    // Configured Organiser: flagged AND admitted in the same join transaction.
    const orlaJoin = await postJoin({ username: 'orla', password: PASSWORD });
    expect(orlaJoin.status).toBe(201);

    const orla = await memberByUsername('orla');
    expect(orla?.is_organiser).toBe(true);
    expect(orla?.admitted_at).not.toBeNull(); // auto-admitted

    // Auto-admitted, so the Organiser can sign in immediately (no manual gate).
    const orlaSignIn = await signIn('orla', PASSWORD);
    expect(orlaSignIn.status).toBe(200);
    organiserCookie = cookieFrom(orlaSignIn);
    expect(organiserCookie).not.toBe('');

    // A username NOT in the list gets neither flag nor admission.
    const kidJoin = await postJoin({ username: 'kidkim', password: PASSWORD });
    expect(kidJoin.status).toBe(201);
    const kid = await memberByUsername('kidkim');
    expect(kid?.is_organiser).toBe(false);
    expect(kid?.admitted_at).toBeNull(); // PENDING
    // ...and being pending, the kid cannot sign in yet.
    expect((await signIn('kidkim', PASSWORD)).status).toBe(403);
  });

  it('refuses the list/admit/reject routes to a non-Organiser caller with 403', async () => {
    // An ordinary admitted member (NOT an Organiser) with a real session.
    const normoCookie = await joinAdmitSignIn('normo');
    const normoId = await h.userIdByUsername('normo');

    // Anonymous (no session) is refused.
    expect((await listMembers()).status).toBe(403);

    // Signed in, but not an Organiser — every route refuses with 403.
    expect((await listMembers(normoCookie)).status).toBe(403);
    expect((await admit(normoId, normoCookie)).status).toBe(403);
    expect((await reject(normoId, normoCookie)).status).toBe(403);

    // The guard did NOT act: normo is still present (reject was refused).
    expect(await memberByUsername('normo')).toBeDefined();

    // Sanity: the Organiser IS allowed through the same guard.
    expect((await listMembers(organiserCookie)).status).toBe(200);
  });

  it('admits a pending member via the route; the member can then sign in', async () => {
    await postJoin({ username: 'cara', password: PASSWORD });
    // Pending: sign-in blocked before admission.
    expect((await signIn('cara', PASSWORD)).status).toBe(403);

    const caraId = await h.userIdByUsername('cara');
    const res = await admit(caraId, organiserCookie);
    expect(res.status).toBe(200);

    // admitted_at is now stamped...
    const cara = await memberByUsername('cara');
    expect(cara?.admitted_at).not.toBeNull();

    // ...so the member can now sign in and mint a session.
    const signedIn = await signIn('cara', PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(cookieFrom(signedIn)).not.toBe('');
  });

  it('rejects a pending member via the route: removes both rows and frees the username', async () => {
    const first = await postJoin({ username: 'dan', password: PASSWORD });
    expect(first.status).toBe(201);
    const danId = await h.userIdByUsername('dan');

    const res = await reject(danId, organiserCookie);
    expect(res.status).toBe(200);

    // Both the user row and the crew_member row are gone.
    const users = await h.db.select().from(userTable).where(eq(userTable.username, 'dan'));
    expect(users).toHaveLength(0);
    const members = await h.db.select().from(crewMember).where(eq(crewMember.user_id, danId));
    expect(members).toHaveLength(0);

    // The username is free again: a brand-new person may re-use it.
    const second = await postJoin({ username: 'dan', password: PASSWORD });
    expect(second.status).toBe(201);
  });

  it('refuses to reject an Organiser (so the club cannot delete its own runner)', async () => {
    const orlaId = await h.userIdByUsername('orla');
    const res = await reject(orlaId, organiserCookie);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('cannot_reject_organiser');
    // Still there.
    expect(await memberByUsername('orla')).toBeDefined();
  });

  it('lists members with pending vs active status for the Organiser UI', async () => {
    // Add one fresh pending member so both buckets are populated.
    await postJoin({ username: 'pendingpip', password: PASSWORD });

    const res = await listMembers(organiserCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; members: MemberView[] };
    expect(body.ok).toBe(true);

    const byUsername = new Map(body.members.map((m) => [m.username, m]));

    const orla = byUsername.get('orla');
    expect(orla?.status).toBe('active');
    expect(orla?.isOrganiser).toBe(true);
    expect(orla?.admittedAt).not.toBeNull();

    const pip = byUsername.get('pendingpip');
    expect(pip?.status).toBe('pending');
    expect(pip?.isOrganiser).toBe(false);
    expect(pip?.admittedAt).toBeNull();

    // cara was admitted via the route earlier — shows as active.
    const cara = byUsername.get('cara');
    expect(cara?.status).toBe('active');
    expect(cara?.admittedAt).not.toBeNull();
  });
});
