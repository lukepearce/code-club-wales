// POST /api/access — exchange this week's shared code for an access cookie.
//
// The simple alternative to the email magic link: the organiser shares one code
// (the LESSON_CODE env var) with the Crew; entering it on /login unlocks the
// lessons and the AI coach for a week. No email, no database — see
// lib/access-code.js. The cookie this sets is honoured by middleware.js (route
// gate) and api/grill.js (the authoritative signature check).

import { codeMatches, isConfigured, makeToken, buildSetCookie } from '../lib/access-code.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!isConfigured()) {
    res.status(503).json({ error: "Sign-in by code isn't set up yet. Ask the organiser." });
    return;
  }

  let code = '';
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    code = body.code;
  } catch {
    // Bad/empty JSON falls through with an empty code → treated as a wrong code.
  }

  if (!codeMatches(code)) {
    res.status(401).json({ error: "That code isn't right. Check this week's code and try again." });
    return;
  }

  // Secure cookie only over https (prod). Local `vercel dev` runs over http,
  // where a Secure cookie would be silently dropped.
  const secure = (process.env.BETTER_AUTH_URL || '').startsWith('https');
  res.setHeader('Set-Cookie', buildSetCookie(makeToken(), { secure }));
  res.status(200).json({ ok: true });
}
