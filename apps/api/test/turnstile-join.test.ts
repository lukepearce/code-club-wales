import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crewMember, user as userTable } from '../src/db/schema';
import { setupTestApp, type TestHarness, TURNSTILE_VALID_TOKEN } from './harness';

// Slice 9 (#9) — bot-protected join via Cloudflare Turnstile. These tests pin
// the EXTERNAL behaviour of POST /api/join: a missing or invalid token is
// rejected BEFORE any account is created, a valid token proceeds as before, and
// a verifier network error fails the join CLOSED. Turnstile is only consulted
// on the join path (covered here); sign-in/get-session carry no token and are
// exercised unchanged by the other suites.

const PASSWORD = 'correct-horse-battery';

/** POST /api/join with an explicit body (caller controls the turnstile field). */
function postJoin(h: TestHarness, body: Record<string, unknown>): Promise<Response> {
  return h.request('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function userByUsername(h: TestHarness, username: string) {
  const rows = await h.db.select().from(userTable).where(eq(userTable.username, username)).limit(1);
  return rows[0];
}

describe('join is bot-gated by Turnstile', () => {
  let h: TestHarness;

  beforeAll(async () => {
    h = await setupTestApp();
  });

  afterAll(async () => {
    await h.teardown();
  });

  it('rejects a join with NO token before any account is created', async () => {
    const res = await postJoin(h, { username: 'notoken', password: PASSWORD });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('turnstile_failed');

    // No user and no crew_member were written for the rejected request.
    const user = await userByUsername(h, 'notoken');
    expect(user).toBeUndefined();
  });

  it('rejects a join whose token Cloudflare reports invalid, before any account', async () => {
    const res = await postJoin(h, {
      username: 'badtoken',
      password: PASSWORD,
      turnstileToken: 'a-token-the-stub-rejects',
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.error).toBe('turnstile_failed');

    expect(await userByUsername(h, 'badtoken')).toBeUndefined();
  });

  it('rejects a join with a blank token (whitespace only)', async () => {
    const res = await postJoin(h, {
      username: 'blanktoken',
      password: PASSWORD,
      turnstileToken: '   ',
    });

    expect(res.status).toBe(403);
    expect(await userByUsername(h, 'blanktoken')).toBeUndefined();
  });

  it('lets a join with a valid token proceed exactly as before (PENDING crew_member)', async () => {
    const res = await postJoin(h, {
      username: 'goodtoken',
      password: PASSWORD,
      turnstileToken: TURNSTILE_VALID_TOKEN,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, username: 'goodtoken' });

    // The account exists and is PENDING (admitted_at null) — same outcome as a
    // pre-Turnstile join, i.e. the gate is additive, not behaviour-changing.
    const user = await userByUsername(h, 'goodtoken');
    expect(user).toBeDefined();
    const members = await h.db.select().from(crewMember).where(eq(crewMember.user_id, user!.id));
    expect(members).toHaveLength(1);
    expect(members[0]!.admitted_at).toBeNull();
  });
});

describe('join fails closed when Turnstile verification errors', () => {
  let h: TestHarness;

  beforeAll(async () => {
    // Inject a fetch that REJECTS — the verifier surfaces this as ok:false, so
    // the join must refuse rather than letting a bot through on an outage.
    h = await setupTestApp({
      turnstileFetch: () => Promise.reject(new Error('cloudflare unreachable')),
    });
  });

  afterAll(async () => {
    await h.teardown();
  });

  it('rejects the join (no account) even with a non-blank token when verify errors', async () => {
    const res = await postJoin(h, {
      username: 'outage',
      password: PASSWORD,
      turnstileToken: TURNSTILE_VALID_TOKEN,
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('turnstile_failed');

    expect(await userByUsername(h, 'outage')).toBeUndefined();
  });
});
