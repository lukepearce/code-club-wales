import { WINDOW_MS } from '@codeclub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestHarness, TURNSTILE_VALID_TOKEN } from './harness';

// The club's Organiser opens reset windows. Bootstrapped from this list (the
// join auto-flags + auto-admits it), so it can sign in and call allow-reset.
const ORGANISER_USERNAMES = ['ollie'];

const OLD_PASSWORD = 'old-correct-horse';
const NEW_PASSWORD = 'new-battery-staple-9';
const NEWER_PASSWORD = 'newer-battery-staple-22';
const SHORT_PASSWORD = 'short'; // 5 chars, below Better Auth's 8-char minimum

let h: TestHarness;
// The Organiser's session cookie, captured in beforeAll, reused to call the
// Organiser-only allow-reset route.
let organiserCookie = '';

beforeAll(async () => {
  h = await setupTestApp({ organiserUsernames: ORGANISER_USERNAMES });
  // Bring the Organiser online: a configured username joins auto-admitted, so a
  // straight sign-in mints their session.
  await postJoin({ username: 'ollie', password: OLD_PASSWORD });
  const signedIn = await signIn('ollie', OLD_PASSWORD);
  expect(signedIn.status).toBe(200);
  organiserCookie = cookieFrom(signedIn);
  expect(organiserCookie).not.toBe('');
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

/** Organiser opens a reset window for a member (the only thing they do). */
function allowReset(userId: string, cookie?: string): Promise<Response> {
  return h.request(`/api/organiser/members/${userId}/allow-reset`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

/** The public, signed-out reset: a member sets their own new password. */
function postReset(body: Record<string, unknown>): Promise<Response> {
  return h.request('/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Join a member and grant Admission so they are a normal active member. */
async function joinAdmitted(username: string, password: string): Promise<void> {
  const res = await postJoin({ username, password });
  expect(res.status).toBe(201);
  await h.admitByUsername(username);
}

describe('Password reset via Organiser-opened window', () => {
  it('allow -> reset -> sign-in: the member sets a new password and signs in with it', async () => {
    await joinAdmitted('rhys', OLD_PASSWORD);
    // The old password works before the reset.
    expect((await signIn('rhys', OLD_PASSWORD)).status).toBe(200);

    // Organiser opens a 5-minute window. The response carries only the closing
    // instant — no password is involved on the Organiser's side.
    const rhysId = await h.userIdByUsername('rhys');
    const opened = await allowReset(rhysId, organiserCookie);
    expect(opened.status).toBe(200);
    const openedBody = (await opened.json()) as Record<string, unknown>;
    expect(openedBody.ok).toBe(true);
    expect(typeof openedBody.resetAllowedUntil).toBe('string');
    // The Organiser surface never carries a password.
    expect('password' in openedBody).toBe(false);
    expect('newPassword' in openedBody).toBe(false);

    // The window is ~5 minutes out (the pure policy owns the duration).
    const until = await h.resetWindowByUsername('rhys');
    expect(until).not.toBeNull();
    const ahead = until!.getTime() - Date.now();
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThanOrEqual(WINDOW_MS + 2000);

    // Signed out, the member sets their OWN new password during the window.
    const reset = await postReset({ username: 'rhys', newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toEqual({ ok: true });

    // The new password now signs in...
    const withNew = await signIn('rhys', NEW_PASSWORD);
    expect(withNew.status).toBe(200);
    expect(cookieFrom(withNew)).not.toBe('');

    // ...and the old password no longer does.
    const withOld = await signIn('rhys', OLD_PASSWORD);
    expect(withOld.status).not.toBe(200);
    expect(cookieFrom(withOld)).toBe('');
  });

  it('clears the window on use, so the same window cannot be reused', async () => {
    await joinAdmitted('mara', OLD_PASSWORD);
    const maraId = await h.userIdByUsername('mara');
    expect((await allowReset(maraId, organiserCookie)).status).toBe(200);

    // First reset succeeds and clears the window.
    expect((await postReset({ username: 'mara', newPassword: NEW_PASSWORD })).status).toBe(200);
    expect(await h.resetWindowByUsername('mara')).toBeNull();

    // A second reset with the SAME window is refused — it was spent.
    const second = await postReset({ username: 'mara', newPassword: NEWER_PASSWORD });
    expect(second.status).toBe(403);
    const body = (await second.json()) as { error?: string };
    expect(body.error).toBe('window_closed');

    // The first new password still works; the would-be second one never took.
    expect((await signIn('mara', NEW_PASSWORD)).status).toBe(200);
    expect((await signIn('mara', NEWER_PASSWORD)).status).not.toBe(200);
  });

  it('refuses with 403 after the window has expired (older than 5 minutes)', async () => {
    await joinAdmitted('nia', OLD_PASSWORD);
    const niaId = await h.userIdByUsername('nia');
    // Open via the real route, then drive the clock past the window.
    expect((await allowReset(niaId, organiserCookie)).status).toBe(200);
    await h.setResetWindowByUsername('nia', new Date(Date.now() - 1000)); // expired

    const reset = await postReset({ username: 'nia', newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(403);
    const body = (await reset.json()) as { error?: string; message?: string };
    expect(body.error).toBe('window_closed');
    expect(body.message).toMatch(/Organiser/i);

    // Password unchanged: old still works, the attempted new one does not.
    expect((await signIn('nia', OLD_PASSWORD)).status).toBe(200);
    expect((await signIn('nia', NEW_PASSWORD)).status).not.toBe(200);
  });

  it('refuses with 403 when no window was ever opened', async () => {
    await joinAdmitted('sion', OLD_PASSWORD);
    expect(await h.resetWindowByUsername('sion')).toBeNull();

    const reset = await postReset({ username: 'sion', newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(403);
    expect(((await reset.json()) as { error?: string }).error).toBe('window_closed');

    // Untouched: the original password still signs in.
    expect((await signIn('sion', OLD_PASSWORD)).status).toBe(200);
  });

  it('refuses an unknown username with the same 403 (no account enumeration)', async () => {
    const reset = await postReset({ username: 'ghost', newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(403);
    expect(((await reset.json()) as { error?: string }).error).toBe('window_closed');
  });

  it('rejects a too-short new password (422) WITHOUT spending the open window', async () => {
    await joinAdmitted('ffion', OLD_PASSWORD);
    const ffionId = await h.userIdByUsername('ffion');
    expect((await allowReset(ffionId, organiserCookie)).status).toBe(200);

    // A fat-fingered short password is refused for length...
    const weak = await postReset({ username: 'ffion', newPassword: SHORT_PASSWORD });
    expect(weak.status).toBe(422);
    expect(((await weak.json()) as { error?: string }).error).toBe('weak_password');

    // ...but the window is still open, so a proper retry succeeds.
    expect(await h.resetWindowByUsername('ffion')).not.toBeNull();
    expect((await postReset({ username: 'ffion', newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await signIn('ffion', NEW_PASSWORD)).status).toBe(200);
  });

  it('opening a window does not change the password (the Organiser never sets it)', async () => {
    await joinAdmitted('teg', OLD_PASSWORD);
    const tegId = await h.userIdByUsername('teg');
    expect((await allowReset(tegId, organiserCookie)).status).toBe(200);

    // After allow-reset but before the member resets, the old password is intact.
    expect((await signIn('teg', OLD_PASSWORD)).status).toBe(200);
  });

  it('refuses allow-reset to anonymous and non-Organiser callers (and opens no window)', async () => {
    await joinAdmitted('huw', OLD_PASSWORD);
    const huwId = await h.userIdByUsername('huw');

    // Anonymous: refused, no window opened.
    expect((await allowReset(huwId)).status).toBe(403);
    expect(await h.resetWindowByUsername('huw')).toBeNull();

    // An ordinary admitted member is not an Organiser: refused, no window opened.
    await joinAdmitted('normo', OLD_PASSWORD);
    const normoSignIn = await signIn('normo', OLD_PASSWORD);
    const normoCookie = cookieFrom(normoSignIn);
    expect((await allowReset(huwId, normoCookie)).status).toBe(403);
    expect(await h.resetWindowByUsername('huw')).toBeNull();

    // Sanity: the Organiser IS allowed through the same guard.
    expect((await allowReset(huwId, organiserCookie)).status).toBe(200);
  });

  it('returns 404 when the Organiser opens a window for an unknown member', async () => {
    const res = await allowReset('does-not-exist', organiserCookie);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: string }).error).toBe('not_found');
  });
});
