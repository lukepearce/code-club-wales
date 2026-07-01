import { isSynthetic } from '@codeclub/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account as accountTable, crewMember, user as userTable } from '../src/db/schema';
import { setupTestApp, type TestHarness, TURNSTILE_VALID_TOKEN } from './harness';

/**
 * Slice 6 — Account settings (set email + link Google).
 *
 * Two surfaces for a SIGNED-IN member:
 *   1. Set/replace the contact email with NO verification. A username-only join
 *      carries a synthetic placeholder; saving a real address must stop the
 *      account reading as synthetic, and must NOT run any verification step.
 *   2. Link Google to the existing account. Per the grounding we do NOT drive a
 *      real Google handshake: we construct the linked state directly the way
 *      Better Auth's link callback does (internalAdapter.linkAccount creates the
 *      `google` account row for the signed-in user), then assert that BOTH
 *      password and Google sign-in reach the SAME crew_member.
 */

const PASSWORD = 'correct-horse-battery';

let h: TestHarness;
type AuthContext = Awaited<TestHarness['auth']['$context']>;
let ctx: AuthContext;

beforeAll(async () => {
  h = await setupTestApp();
  ctx = await h.auth.$context;
});

afterAll(async () => {
  await h.teardown();
});

function postJoin(body: Record<string, unknown>): Promise<Response> {
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

/** Rebuild a Cookie header from a response's Set-Cookie list. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ');
}

function postEmail(body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return h.request('/api/account/email', {
    method: 'POST',
    headers: cookie
      ? { 'content-type': 'application/json', cookie }
      : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Join + admit a member (pending → active). */
async function joinAdmitted(username: string, opts: { email?: string } = {}): Promise<void> {
  const res = await postJoin({
    username,
    password: PASSWORD,
    ...(opts.email ? { email: opts.email } : {}),
  });
  expect(res.status).toBe(201);
  await h.admitByUsername(username);
}

/** Join + admit + sign in; returns the active member's session cookie. */
async function joinAdmittedSignedIn(username: string, opts: { email?: string } = {}): Promise<string> {
  await joinAdmitted(username, opts);
  const signed = await signIn(username, PASSWORD);
  expect(signed.status).toBe(200);
  const cookie = cookieFrom(signed);
  expect(cookie).not.toBe('');
  return cookie;
}

async function userByUsername(username: string) {
  const rows = await h.db.select().from(userTable).where(eq(userTable.username, username)).limit(1);
  return rows[0];
}

async function accountsFor(userId: string) {
  return h.db.select().from(accountTable).where(eq(accountTable.userId, userId));
}

async function membersFor(userId: string) {
  return h.db.select().from(crewMember).where(eq(crewMember.user_id, userId));
}

describe('Account settings — set email (no verification)', () => {
  it('replaces the synthetic placeholder with a real email, with no verification step', async () => {
    // A username-only join gets a synthetic, non-deliverable placeholder email.
    const cookie = await joinAdmittedSignedIn('nia');
    const before = await userByUsername('nia');
    expect(isSynthetic(before!.email)).toBe(true);
    expect(before!.emailVerified).toBe(false);

    const res = await postEmail({ email: 'Nia@Real.example' }, cookie);
    expect(res.status).toBe(200);
    // Returns the normalised (lowercased) address it stored.
    await expect(res.json()).resolves.toEqual({ ok: true, email: 'nia@real.example' });

    const after = await userByUsername('nia');
    expect(after!.email).toBe('nia@real.example');
    // The account no longer reads as synthetic...
    expect(isSynthetic(after!.email)).toBe(false);
    // ...and NO verification happened: the email stays unverified, nothing sent.
    expect(after!.emailVerified).toBe(false);
  });

  it('lets a member replace an existing real email with another (still no verification)', async () => {
    const cookie = await joinAdmittedSignedIn('bryn', { email: 'bryn.old@real.example' });
    expect((await userByUsername('bryn'))!.email).toBe('bryn.old@real.example');

    const res = await postEmail({ email: 'bryn.new@real.example' }, cookie);
    expect(res.status).toBe(200);

    const after = await userByUsername('bryn');
    expect(after!.email).toBe('bryn.new@real.example');
    expect(after!.emailVerified).toBe(false);
  });

  it('refuses to change the email for an unauthenticated caller (401), leaving it untouched', async () => {
    await joinAdmitted('cerys');
    const before = await userByUsername('cerys');

    // No session cookie: the route resolves no user and refuses.
    const res = await postEmail({ email: 'hijack@real.example' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe('unauthenticated');

    // Email unchanged (still the synthetic placeholder).
    expect((await userByUsername('cerys'))!.email).toBe(before!.email);
  });

  it('rejects an email already registered to another member (409), leaving the caller unchanged', async () => {
    await joinAdmitted('dylan', { email: 'shared@real.example' });
    const cookie = await joinAdmittedSignedIn('eluned');
    const before = await userByUsername('eluned');

    const res = await postEmail({ email: 'shared@real.example' }, cookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe('email_taken');

    // Caller's email is still the synthetic placeholder.
    expect((await userByUsername('eluned'))!.email).toBe(before!.email);
  });

  it('rejects a malformed email and a synthetic-domain placeholder (422)', async () => {
    const cookie = await joinAdmittedSignedIn('ffion');

    const bad = await postEmail({ email: 'not-an-email' }, cookie);
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error?: string }).error).toBe('invalid_email');

    // The synthetic placeholder domain is not a "real" email.
    const synthetic = await postEmail({ email: 'ffion@synthetic.codeclub.wales' }, cookie);
    expect(synthetic.status).toBe(422);
    expect(((await synthetic.json()) as { error?: string }).error).toBe('invalid_email');

    // Nothing changed: still the placeholder.
    expect(isSynthetic((await userByUsername('ffion'))!.email)).toBe(true);
  });
});

describe('Account settings — link Google (both sign-in methods, same crew_member)', () => {
  it('after linking Google, the member signs in with EITHER password or Google and reaches the SAME crew_member', async () => {
    // A normal password member (synthetic placeholder email), admitted + online.
    await joinAdmittedSignedIn('mei');
    const userId = await h.userIdByUsername('mei');

    // Sanity: exactly one crew_member, and only the credential account so far.
    const membersBefore = await membersFor(userId);
    expect(membersBefore).toHaveLength(1);
    expect((await accountsFor(userId)).map((a) => a.providerId).sort()).toEqual(['credential']);

    // Link Google to THIS account. Per the grounding we do not drive a real
    // Google handshake: internalAdapter.linkAccount creates the `google` account
    // row for the signed-in user — exactly what Better Auth's link callback does
    // (account.mjs createAccount) — and fires the real account-create hook, which
    // is idempotent for a member that already exists.
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: 'google',
      accountId: 'google-sub-mei',
    });

    // Both credentials now hang off the ONE user...
    const accts = await accountsFor(userId);
    expect(accts.map((a) => a.providerId).sort()).toEqual(['credential', 'google']);
    expect(accts.every((a) => a.userId === userId)).toBe(true);

    // ...and linking created NO second crew_member (still the same single row).
    const membersAfter = await membersFor(userId);
    expect(membersAfter).toHaveLength(1);
    expect(membersAfter[0]!.id).toBe(membersBefore[0]!.id);

    // Method 1 — password sign-in still works and mints a session.
    const pwd = await signIn('mei', PASSWORD);
    expect(pwd.status).toBe(200);
    expect(cookieFrom(pwd)).not.toBe('');

    // Method 2 — Google sign-in. After matching the linked account the callback
    // calls createSession (the same call slice 5 asserts). The member is
    // admitted, so the Admission gate passes and a real session is minted for
    // the SAME user, resolvable back to the same username.
    const googleSession = await ctx.internalAdapter.createSession(userId);
    expect(googleSession.userId).toBe(userId);
    const resolved = await ctx.internalAdapter.findSession(googleSession.token);
    expect(resolved?.user.id).toBe(userId);
    expect(resolved?.user.username).toBe('mei');
  });

  it('a member who links Google while still PENDING is refused a session on BOTH methods until admitted', async () => {
    // Join WITHOUT admitting — pending (cannot sign in yet).
    expect((await postJoin({ username: 'pending_pip', password: PASSWORD })).status).toBe(201);
    const userId = await h.userIdByUsername('pending_pip');

    // Link Google directly while still pending.
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: 'google',
      accountId: 'google-sub-pip',
    });
    // The link did not admit them and created no second crew_member.
    const members = await membersFor(userId);
    expect(members).toHaveLength(1);
    expect(members[0]!.admitted_at).toBeNull();

    // Password sign-in refused by the Admission gate...
    expect((await signIn('pending_pip', PASSWORD)).status).toBe(403);
    // ...and the Google callback's createSession is refused by the same gate.
    await expect(ctx.internalAdapter.createSession(userId)).rejects.toThrow();

    // Once admitted, BOTH methods work against the one account.
    await h.admitByUsername('pending_pip');
    expect((await signIn('pending_pip', PASSWORD)).status).toBe(200);
    const googleSession = await ctx.internalAdapter.createSession(userId);
    expect(googleSession.userId).toBe(userId);
  });
});
