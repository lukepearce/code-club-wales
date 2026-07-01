import { forUsername, isSynthetic } from '@codeclub/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PENDING_ADMISSION_MESSAGE } from '../src/auth';
import { crewMember, session as sessionTable, user as userTable } from '../src/db/schema';
import { setupTestApp, type TestHarness, TURNSTILE_VALID_TOKEN } from './harness';

const PASSWORD = 'correct-horse-battery';

let h: TestHarness;

beforeAll(async () => {
  h = await setupTestApp();
});

afterAll(async () => {
  await h.teardown();
});

function postJoin(body: Record<string, unknown>): Promise<Response> {
  // The join path is Turnstile-gated; supply a valid token by default (a test
  // can override by putting its own turnstileToken in `body`).
  return h.request('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turnstileToken: TURNSTILE_VALID_TOKEN, ...body }),
  });
}

function signIn(username: string, password: string): Promise<Response> {
  return h.request('/api/auth/sign-in/username', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

function getSession(cookie?: string): Promise<Response> {
  return h.request('/api/auth/get-session', cookie ? { headers: { cookie } } : undefined);
}

/** Rebuild a Cookie header from a response's Set-Cookie list. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ');
}

async function userByUsername(username: string) {
  const rows = await h.db.select().from(userTable).where(eq(userTable.username, username)).limit(1);
  return rows[0];
}

describe('join -> Admission gate -> sign-in (walking skeleton)', () => {
  it('join creates a PENDING user + crew_member atomically with a synthetic email', async () => {
    const res = await postJoin({ username: 'ada', password: PASSWORD });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, username: 'ada' });

    const user = await userByUsername('ada');
    expect(user).toBeDefined();
    expect(user?.email).toBe(forUsername('ada'));
    expect(isSynthetic(user?.email ?? '')).toBe(true);
    expect(user?.name).toBe('ada');

    const members = await h.db.select().from(crewMember).where(eq(crewMember.user_id, user!.id));
    expect(members).toHaveLength(1);
    const member = members[0]!;
    expect(member.display_name).toBe('ada'); // defaults from the username
    expect(member.is_organiser).toBe(false);
    expect(member.admitted_at).toBeNull(); // PENDING
    expect(member.reset_allowed_until).toBeNull();
    expect(member.slug).toBeNull();
  });

  it('stores a provided real email (normalised), not a synthetic placeholder', async () => {
    const res = await postJoin({
      username: 'grace',
      password: PASSWORD,
      email: 'Grace@Example.com',
    });
    expect(res.status).toBe(201);

    const user = await userByUsername('grace');
    expect(user?.email).toBe('grace@example.com');
    expect(isSynthetic(user?.email ?? '')).toBe(false);
  });

  it('refuses a session to a PENDING member with the waiting-to-be-admitted message', async () => {
    await postJoin({ username: 'pendingpat', password: PASSWORD });

    const res = await signIn('pendingpat', PASSWORD);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe(PENDING_ADMISSION_MESSAGE);

    // No session may have been minted for the pending member.
    const user = await userByUsername('pendingpat');
    const sessions = await h.db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.userId, user!.id));
    expect(sessions).toHaveLength(0);
  });

  it('lets an ADMITTED member sign in and reach a gated session; anonymous cannot', async () => {
    await postJoin({ username: 'admittedamy', password: PASSWORD });

    // Still pending: blocked.
    expect((await signIn('admittedamy', PASSWORD)).status).toBe(403);

    // Organiser grants Admission (direct flip; the Organiser UI is a later slice).
    await h.admitByUsername('admittedamy');

    const ok = await signIn('admittedamy', PASSWORD);
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    expect(cookie).not.toBe('');

    // Gated page: with the session cookie the user is resolved.
    const gated = await getSession(cookie);
    expect(gated.status).toBe(200);
    const session = (await gated.json()) as { user?: { username?: string } } | null;
    expect(session?.user?.username).toBe('admittedamy');

    // Anonymous visitor: no session.
    const anon = await getSession();
    const anonBody = await anon.json().catch(() => null);
    expect(anonBody).toBeNull();
  });

  it('rejects invalid usernames with clear reasons (too short, bad charset)', async () => {
    const tooShort = await postJoin({ username: 'ab', password: PASSWORD });
    expect(tooShort.status).toBe(422);
    const shortBody = (await tooShort.json()) as { error?: string; reasons?: string[] };
    expect(shortBody.error).toBe('invalid_username');
    expect(shortBody.reasons?.length ?? 0).toBeGreaterThan(0);

    const badChars = await postJoin({ username: 'has space', password: PASSWORD });
    expect(badChars.status).toBe(422);
    const badBody = (await badChars.json()) as { error?: string };
    expect(badBody.error).toBe('invalid_username');

    // Nothing was written for the rejected names.
    expect(await userByUsername('ab')).toBeUndefined();
  });

  it('rejects reserved usernames', async () => {
    const res = await postJoin({ username: 'admin', password: PASSWORD });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: string; reasons?: string[] };
    expect(body.error).toBe('invalid_username');
    expect(body.reasons?.some((r) => r.toLowerCase().includes('reserved'))).toBe(true);
    expect(await userByUsername('admin')).toBeUndefined();
  });

  it('rejects a duplicate username and writes nothing on the second attempt (atomic)', async () => {
    expect((await postJoin({ username: 'dupe', password: PASSWORD })).status).toBe(201);

    const second = await postJoin({ username: 'dupe', password: PASSWORD });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error?: string };
    expect(body.error).toBe('username_taken');

    // Exactly one user and one crew_member — no orphan from the failed join.
    const users = await h.db.select().from(userTable).where(eq(userTable.username, 'dupe'));
    expect(users).toHaveLength(1);
    const members = await h.db
      .select()
      .from(crewMember)
      .where(eq(crewMember.user_id, users[0]!.id));
    expect(members).toHaveLength(1);
  });
});
