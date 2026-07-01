import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account as accountTable, crewMember, session as sessionTable, user as userTable } from '../src/db/schema';
import { setupTestApp, type TestHarness } from './harness';

/**
 * Slice 5 — Google sign-in & join.
 *
 * Per the grounding we do NOT drive a real/headless Google handshake. Instead we
 * construct the post-OAuth state directly with Better Auth's own internal adapter
 * — `createOAuthUser({...}, { providerId: 'google', ... })` is exactly what the
 * OAuth callback calls after exchanging the code — and then exercise the two
 * paths that matter: the pick-a-username completion endpoint and the Admission
 * gate (which Better Auth consults via `createSession`, the same call the Google
 * callback makes). Seeding through createOAuthUser runs the REAL account-create
 * hook, so the pending crew_member is minted by production code, not the test.
 */

// 'orla' is a configured Organiser: a Google joiner who picks this username is
// flagged + admitted on the spot (organiserPolicy.bootstrap), like the email path.
const ORGANISER_USERNAMES = ['orla'];

let h: TestHarness;
type AuthContext = Awaited<TestHarness['auth']['$context']>;
let ctx: AuthContext;

beforeAll(async () => {
  h = await setupTestApp({ organiserUsernames: ORGANISER_USERNAMES });
  ctx = await h.auth.$context;
});

afterAll(async () => {
  await h.teardown();
});

/**
 * Construct the post-OAuth state for an UNKNOWN Google identity: a Better Auth
 * user + a `google` account, created the way the OAuth callback creates them.
 * This fires the account-create hook, which mints the PENDING crew_member.
 * Returns the new user id.
 */
async function seedGoogleIdentity(opts: {
  email: string;
  name: string;
  accountId: string;
}): Promise<string> {
  const { user } = await ctx.internalAdapter.createOAuthUser(
    { name: opts.name, email: opts.email, emailVerified: true, image: null },
    { providerId: 'google', accountId: opts.accountId },
  );
  return user.id;
}

function postGoogleComplete(body: Record<string, unknown>): Promise<Response> {
  return h.request('/api/google/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function userById(userId: string) {
  const rows = await h.db.select().from(userTable).where(eq(userTable.id, userId)).limit(1);
  return rows[0];
}

async function memberByUserId(userId: string) {
  const rows = await h.db
    .select()
    .from(crewMember)
    .where(eq(crewMember.user_id, userId))
    .limit(1);
  return rows[0];
}

async function googleAccountCount(userId: string): Promise<number> {
  const rows = await h.db.select().from(accountTable).where(eq(accountTable.userId, userId));
  return rows.filter((a) => a.providerId === 'google').length;
}

async function sessionsFor(userId: string) {
  return h.db.select().from(sessionTable).where(eq(sessionTable.userId, userId));
}

describe('Google sign-in & join', () => {
  it('an unknown Google identity becomes a PENDING crew_member with NO username (display_name from the Google name)', async () => {
    const userId = await seedGoogleIdentity({
      email: 'gwen@gmail.example',
      name: 'Gwen Vaughan',
      accountId: 'google-sub-gwen',
    });

    // The account-create hook minted a PENDING crew_member.
    const member = await memberByUserId(userId);
    expect(member).toBeDefined();
    expect(member!.admitted_at).toBeNull(); // PENDING — cannot sign in yet
    expect(member!.is_organiser).toBe(false);
    expect(member!.display_name).toBe('Gwen Vaughan'); // defaulted from the Google name

    // No username yet: the username plugin assigns none on a social sign-up, so
    // the person must complete the pick-a-username step.
    const user = await userById(userId);
    expect(user!.username).toBeNull();

    // A real Google account row backs the identity.
    expect(await googleAccountCount(userId)).toBe(1);
  });

  it('refuses a session to the pending Google member (the Admission gate), the same gate the Google callback hits', async () => {
    const userId = await seedGoogleIdentity({
      email: 'pending-pat@gmail.example',
      name: 'Pat',
      accountId: 'google-sub-pat',
    });

    // createSession is exactly what the OAuth callback calls after creating the
    // user; the session.create.before gate refuses a pending member.
    await expect(ctx.internalAdapter.createSession(userId)).rejects.toThrow();

    // No session was minted.
    expect(await sessionsFor(userId)).toHaveLength(0);
  });

  it('completing the username step claims the canonical username and leaves the member PENDING (not signed in)', async () => {
    const userId = await seedGoogleIdentity({
      email: 'huw@gmail.example',
      name: 'Huw Pugh',
      accountId: 'google-sub-huw',
    });

    const res = await postGoogleComplete({ userId, username: 'HuwTheCoder' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      username: 'huwthecoder',
      admitted: false,
    });

    const user = await userById(userId);
    expect(user!.username).toBe('huwthecoder'); // canonical (normalised)
    expect(user!.displayUsername).toBe('HuwTheCoder'); // friendly, as typed

    // Still PENDING after picking a username — Admission is a separate gate.
    const member = await memberByUserId(userId);
    expect(member!.admitted_at).toBeNull();
    expect(member!.display_name).toBe('Huw Pugh'); // Google name retained

    // And being pending, a session is still refused.
    await expect(ctx.internalAdapter.createSession(userId)).rejects.toThrow();
  });

  it('rejects an invalid or reserved username at completion (422)', async () => {
    const userId = await seedGoogleIdentity({
      email: 'short@gmail.example',
      name: 'Sh',
      accountId: 'google-sub-short',
    });

    const tooShort = await postGoogleComplete({ userId, username: 'ab' });
    expect(tooShort.status).toBe(422);
    const shortBody = (await tooShort.json()) as { error?: string; reasons?: string[] };
    expect(shortBody.error).toBe('invalid_username');
    expect((shortBody.reasons?.length ?? 0) > 0).toBe(true);

    const reserved = await postGoogleComplete({ userId, username: 'admin' });
    expect(reserved.status).toBe(422);
    const reservedBody = (await reserved.json()) as { error?: string; reasons?: string[] };
    expect(reservedBody.error).toBe('invalid_username');
    expect(reservedBody.reasons?.some((r) => r.toLowerCase().includes('reserved'))).toBe(true);

    // Nothing was claimed: the user still has no username, so the step is retryable.
    expect((await userById(userId))!.username).toBeNull();
  });

  it('rejects a username already taken by another member (409)', async () => {
    // First identity claims 'taken_name'.
    const firstId = await seedGoogleIdentity({
      email: 'first@gmail.example',
      name: 'First',
      accountId: 'google-sub-first',
    });
    expect((await postGoogleComplete({ userId: firstId, username: 'taken_name' })).status).toBe(200);

    // Second identity cannot.
    const secondId = await seedGoogleIdentity({
      email: 'second@gmail.example',
      name: 'Second',
      accountId: 'google-sub-second',
    });
    const clash = await postGoogleComplete({ userId: secondId, username: 'taken_name' });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error?: string }).error).toBe('username_taken');
    // The second member still has no username.
    expect((await userById(secondId))!.username).toBeNull();
  });

  it('refuses to complete an identity that is not an uncompleted Google join (403 not_eligible)', async () => {
    // Already completed: a second completion is refused (username already set).
    const completedId = await seedGoogleIdentity({
      email: 'gareth@gmail.example',
      name: 'Gareth',
      accountId: 'google-sub-gareth',
    });
    expect((await postGoogleComplete({ userId: completedId, username: 'gareth1' })).status).toBe(200);
    const again = await postGoogleComplete({ userId: completedId, username: 'gareth2' });
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error?: string }).error).toBe('not_eligible');
    // The original username is untouched.
    expect((await userById(completedId))!.username).toBe('gareth1');

    // Unknown user id: refused, no enumeration.
    const ghost = await postGoogleComplete({ userId: 'no-such-user', username: 'ghost' });
    expect(ghost.status).toBe(403);
    expect(((await ghost.json()) as { error?: string }).error).toBe('not_eligible');
  });

  it('full flow: pending Google join -> pick username -> Organiser admits -> Google sign-in yields a session', async () => {
    const userId = await seedGoogleIdentity({
      email: 'mei@gmail.example',
      name: 'Mei',
      accountId: 'google-sub-mei',
    });

    // Pick a username — still pending.
    const completed = await postGoogleComplete({ userId, username: 'mei_codes' });
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toEqual({
      ok: true,
      username: 'mei_codes',
      admitted: false,
    });

    // Before Admission, the Google callback's session creation is refused.
    await expect(ctx.internalAdapter.createSession(userId)).rejects.toThrow();
    expect(await sessionsFor(userId)).toHaveLength(0);

    // The Organiser admits the member (now resolvable by their chosen username).
    await h.admitByUsername('mei_codes');

    // A returning Google sign-in now mints a session in one step: the gate passes.
    const session = await ctx.internalAdapter.createSession(userId);
    expect(session).toBeTruthy();
    expect(session.userId).toBe(userId);

    // ...and it is a real, resolvable session for that user.
    const found = await ctx.internalAdapter.findSession(session.token);
    expect(found?.user.id).toBe(userId);
    expect(found?.user.username).toBe('mei_codes');
    expect(await sessionsFor(userId)).toHaveLength(1);
  });

  it('a configured Organiser username completing a Google join is admitted on the spot and gets a session', async () => {
    const userId = await seedGoogleIdentity({
      email: 'orla@gmail.example',
      name: 'Orla',
      accountId: 'google-sub-orla',
    });

    const res = await postGoogleComplete({ userId, username: 'orla' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, username: 'orla', admitted: true });

    const member = await memberByUserId(userId);
    expect(member!.is_organiser).toBe(true);
    expect(member!.admitted_at).not.toBeNull(); // admitted on the spot

    // Admitted, so the Google sign-in mints a session immediately.
    const session = await ctx.internalAdapter.createSession(userId);
    expect(session.userId).toBe(userId);
  });
});
