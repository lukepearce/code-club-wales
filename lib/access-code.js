// Shared "quick code" access for Code Club Wales.
//
// A lightweight alternative to the email magic link: the organiser shares one
// weekly code (the LESSON_CODE env var) with the Crew, they type it on /login,
// and we hand back a short-lived signed cookie that gates the lessons and the
// /api/grill coach — exactly like a Better Auth session, but with no email,
// no database, and no external service in the loop. Handy when magic-link
// delivery is being flaky.
//
// The cookie value is self-verifying: "<expiryMs>.<hmac>", signed with
// BETTER_AUTH_SECRET (the same secret that signs sessions). We never trust the
// cookie's contents without re-checking the signature server-side.
//
// This file lives outside /api on purpose (like lib/auth.js): only files under
// /api become Vercel routes, so shared helpers here are not themselves exposed.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'cc_access';

// How long a typed code keeps you signed in. "This week's lesson" → a week.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const SECRET = process.env.BETTER_AUTH_SECRET || '';

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

// Timing-safe string compare that doesn't short-circuit on a length mismatch.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba); // spend ~constant time, then fail
    return false;
  }
  return timingSafeEqual(ba, bb);
}

// Is the quick code wired up at all? Needs both the code and a signing secret.
export function isConfigured() {
  return !!(process.env.LESSON_CODE || '').trim() && !!SECRET;
}

// Does `code` match the configured weekly code? Case-insensitive and tolerant
// of surrounding spaces — kids will type it off a whiteboard. False if unset.
export function codeMatches(code) {
  const expected = (process.env.LESSON_CODE || '').trim();
  if (!expected) return false;
  const got = String(code || '').trim();
  if (!got) return false;
  return safeEqual(got.toLowerCase(), expected.toLowerCase());
}

// Mint a signed cookie value good for MAX_AGE_SECONDS.
export function makeToken() {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  return `${exp}.${sign(`crew.${exp}`)}`;
}

// Verify a cookie value: signature must match and it must not be expired.
export function verifyToken(value) {
  if (!value || !SECRET) return false;
  const dot = String(value).indexOf('.');
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  return safeEqual(sig, sign(`crew.${exp}`));
}

// Build the Set-Cookie header value for a freshly minted token.
export function buildSetCookie(token, { secure }) {
  const parts = [
    `${ACCESS_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Pull a single cookie value out of a raw Cookie header.
export function readCookie(cookieHeader, name) {
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  const m = (cookieHeader || '').match(re);
  return m ? m[1] : null;
}
