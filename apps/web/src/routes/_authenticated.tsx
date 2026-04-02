import { Link, Outlet, createRoute, redirect } from '@tanstack/react-router';

import {
  buildProtectedRedirectTarget,
  type AuthSnapshot,
  useAuthSnapshot
} from '../lib/auth-client';
import { rootRoute } from './__root';

export const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
  pendingMs: 0,
  pendingComponent: AuthPendingShell,
  beforeLoad: async ({ context, location }) => {
    const authState = await context.auth.bootstrapSession();

    if (authState.status !== 'authenticated') {
      throw redirect({
        to: '/auth/sign-in',
        search: {
          redirect: buildProtectedRedirectTarget(location.pathname)
        }
      });
    }

    return {
      authState
    };
  },
  component: AuthenticatedLayout
});

export const protectedHomeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'app',
  component: ProtectedHomePage
});

export function AuthPendingShell() {
  return (
    <main aria-label="auth bootstrap" style={{ padding: '2rem 1.5rem' }}>
      <h1>Checking authentication…</h1>
      <p>The dashboard stays locked until the session bootstrap resolves.</p>
    </main>
  );
}

export function AuthenticatedLayout() {
  const { auth } = rootRoute.useRouteContext();
  const snapshot = useAuthSnapshot(auth);

  return (
    <section aria-label="authenticated shell" style={{ padding: '2rem 1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Authenticated dashboard shell</h1>
        <p style={{ margin: 0, color: '#4b5563' }}>
          {snapshot.status === 'authenticated'
            ? `Signed in as ${snapshot.session?.user.email ?? 'founder@example.com'}`
            : 'Protected routes fail closed until a valid session exists.'}
        </p>
      </header>
      <Outlet />
    </section>
  );
}

export function ProtectedHomePage() {
  const authState = protectedHomeRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot | undefined
  });

  return (
    <main aria-label="dashboard placeholder">
      <h2>{authState?.session?.user.name ?? 'Founder workspace'}</h2>
      <p>Dashboard access is unlocked because a valid Better Auth session exists.</p>
      <dl>
        <dt>Active workspace id</dt>
        <dd>{authState?.session?.session.activeOrganizationId ?? 'No active workspace yet'}</dd>
      </dl>
      <p>
        Still setting up the workspace? <Link to="/app/onboarding">Open the startup onboarding flow</Link>.
      </p>
    </main>
  );
}
