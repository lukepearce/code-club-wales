// Vercel Edge Middleware — protects the lesson routes.
//
// Lessons are Crew-only. This runs at the edge before any lesson page is served
// and redirects to /login if there's no Better Auth session cookie. One matcher
// guards the whole set of routes, so new lessons under /lessons are covered
// automatically with no per-page code (the Next.js-middleware "protect a set of
// routes" pattern, on a non-Next static site).
//
// NOTE: we deliberately do NOT import `better-auth` (or our own crypto helpers)
// here — heavier modules pull in DB/JSON utilities that the Edge runtime rejects
// ("unsupported modules"). All this check needs is the PRESENCE of a sign-in
// cookie, so we read it straight off the request. Two cookies count as signed in:
//   better-auth.session_token / __Secure-better-auth.session_token
//                                        (magic-link session — http / https)
//   cc_access                            (this week's quick code — see api/access.js)
// Matching any cookie whose name ends in `session_token` covers the first pair.
//
// This is an OPTIMISTIC check (no signature/DB verification) — kept cheap on
// purpose. The authoritative check still happens server-side: every data
// endpoint a lesson calls (e.g. /api/grill) validates the session OR re-verifies
// the quick-code cookie's signature + expiry and 401s if it doesn't hold up.

export const config = {
  matcher: ['/lessons/:path*'],
};

const SESSION_COOKIE_RE = /(?:^|;\s*)[^=;\s]*session_token=([^;]+)/;
const ACCESS_COOKIE_RE = /(?:^|;\s*)cc_access=([^;]+)/;

function isSignedIn(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  return SESSION_COOKIE_RE.test(cookieHeader) || ACCESS_COOKIE_RE.test(cookieHeader);
}

export default function middleware(request) {
  if (!isSignedIn(request)) {
    const { pathname } = new URL(request.url);
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return Response.redirect(loginUrl, 307);
  }
  // Has a session cookie — let the request through.
}
