// Vercel Edge Middleware — protects the lesson routes.
//
// Lessons are Crew-only. This runs at the edge before any lesson page is served
// and redirects to /login if there's no Better Auth session cookie. It's the
// framework-agnostic equivalent of a Next.js middleware / protected layout: one
// matcher guards the whole set of routes, so new lessons under /lessons are
// covered automatically with no per-page code.
//
// This is an OPTIMISTIC check — it only looks for the presence of the signed
// session cookie, no DB round-trip (keeps the edge fast). The authoritative
// check still happens server-side: every data endpoint a lesson calls
// (e.g. /api/grill) independently validates the session and 401s.
//
// To protect more routes later, add them to `config.matcher` below.
import { getSessionCookie } from 'better-auth/cookies';

export const config = {
  matcher: ['/lessons/:path*'],
};

export default function middleware(request) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const { pathname } = new URL(request.url);
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return Response.redirect(loginUrl, 307);
  }
  // Has a session cookie — let the request through.
}
