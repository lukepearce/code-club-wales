import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { authClient, type AuthClient } from './lib/auth-client';
import { queryClient } from './lib/query';
import { DashboardPage, JoinPage, SignInPage } from './pages';

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

function RootLayout() {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <strong>Code Club Wales</strong>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/join">Join</Link>
          <Link to="/signin">Sign in</Link>
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
  beforeLoad: requireSession,
  component: () => (
    <Placeholder
      title="Organiser"
      note="Admit / reject pending Crew members, open reset windows. Later slice."
    />
  ),
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset',
  component: () => (
    <Placeholder
      title="Reset password"
      note="Public, keyed by username, gated by the Organiser-opened window. Later slice."
    />
  ),
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
