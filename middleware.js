// Vercel Edge Middleware — protects the lesson routes.
//
// Lessons are Crew-only. This runs at the edge before any lesson page is served
// and redirects to /login if there's no Better Auth session cookie. One matcher
// guards the whole set of routes, so new lessons under /lessons are covered
// automatically with no per-page code (the Next.js-middleware "protect a set of
// routes" pattern, on a non-Next static site).
//
// NOTE: we deliberately do NOT import `better-auth` here — its cookie helper
// pulls in DB/JSON utilities that the Edge runtime rejects ("unsupported
// modules"). All this check needs is the PRESENCE of the signed session cookie,
// so we read it straight off the request. Better Auth names the session cookie:
//   better-auth.session_token            (http / localhost)
//   __Secure-better-auth.session_token   (https / production — secure prefix)
// Matching any cookie whose name ends in `session_token` covers both.
//
// This is an OPTIMISTIC check (no signature/DB verification) — kept cheap on
// purpose. The authoritative check still happens server-side: every data
// endpoint a lesson calls (e.g. /api/grill) validates the session and 401s.

export const config = {
  matcher: ['/lessons/:path*'],
};

const SESSION_COOKIE_RE = /(?:^|;\s*)[^=;\s]*session_token=([^;]+)/;

function hasSessionCookie(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(SESSION_COOKIE_RE);
  return !!(match && match[1]);
}

export default function middleware(request) {
  if (!hasSessionCookie(request)) {
    const { pathname } = new URL(request.url);
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return Response.redirect(loginUrl, 307);
  }
  // Has a session cookie — let the request through.
}
