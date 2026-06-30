import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import {
  fetchOrganiserMembers,
  ORGANISER_MEMBERS_QUERY_KEY,
  OrganiserForbiddenError,
} from './lib/api';
import { authClient, type AuthClient } from './lib/auth-client';
import { queryClient } from './lib/query';
import { DashboardPage, JoinPage, OrganiserPage, ResetPage, SignInPage } from './pages';

export interface RouterContext {
  auth: AuthClient;
  queryClient: QueryClient;
}

/**
 * Auth guard: redirect to /signin when there is no session. Attached to the
 * authenticated areas (dashboard, organiser, account). Later slices refine this
 * (e.g. caching the session via TanStack Query, and an Organiser-only check).
 */
async function requireSession({ context }: { context: RouterContext }): Promise<void> {
  const session = await context.auth.getSession();
  if (!session.data) {
    throw redirect({ to: '/signin' });
  }
}

/**
 * Organiser guard: the authoritative gate is the API (403 to non-Organisers).
 * Here we make the area unreachable in the SPA too — redirect anonymous callers
 * to /signin, and signed-in non-Organisers (whom the members fetch refuses with
 * an OrganiserForbiddenError) to the dashboard. On success we prime the query
 * cache so the page renders without a second fetch.
 */
async function requireOrganiser({ context }: { context: RouterContext }): Promise<void> {
  const session = await context.auth.getSession();
  if (!session.data) {
    throw redirect({ to: '/signin' });
  }
  try {
    const members = await fetchOrganiserMembers();
    context.queryClient.setQueryData(ORGANISER_MEMBERS_QUERY_KEY, members);
  } catch (err) {
    if (err instanceof OrganiserForbiddenError) {
      throw redirect({ to: '/' });
    }
    // Transient/network error: let the page's own query surface it.
  }
}

function RootLayout() {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <strong>Code Club Wales</strong>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/join">Join</Link>
          <Link to="/signin">Sign in</Link>
          <Link to="/reset">Reset</Link>
          <Link to="/organiser">Organiser</Link>
          <Link to="/account">Account</Link>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{note}</p>
    </section>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireSession,
  component: DashboardPage,
});

const signinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  component: SignInPage,
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/join',
  component: JoinPage,
});

const organiserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/organiser',
  beforeLoad: requireOrganiser,
  component: OrganiserPage,
});

// Public (no session guard): a signed-out member resets via the Organiser-opened
// window. The window, enforced server-side, is the gate — not a session.
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset',
  component: ResetPage,
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  beforeLoad: requireSession,
  component: () => (
    <Placeholder
      title="Account"
      note="Set email, link Google, claim a personal-site slug. Later slice."
    />
  ),
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  signinRoute,
  joinRoute,
  organiserRoute,
  resetRoute,
  accountRoute,
]);

export const router = createRouter({
  routeTree,
  context: { auth: authClient, queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
