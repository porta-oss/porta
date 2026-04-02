import { createRoute, Outlet, redirect } from "@tanstack/react-router";

import { buildProtectedRedirectTarget } from "../lib/auth-client";
import { rootRoute } from "./__root";

export const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authenticated",
  pendingMs: 0,
  pendingComponent: AuthPendingShell,
  beforeLoad: async ({ context, location }) => {
    const authState = await context.auth.bootstrapSession();

    if (authState.status !== "authenticated") {
      throw redirect({
        to: "/auth/sign-in",
        search: {
          redirect: buildProtectedRedirectTarget(location.pathname),
        },
      });
    }

    return {
      authState,
    };
  },
  component: AuthenticatedLayout,
});

export function AuthPendingShell() {
  return (
    <main aria-label="auth bootstrap" style={{ padding: "2rem 1.5rem" }}>
      <h1>Checking authentication…</h1>
      <p>The dashboard stays locked until the session bootstrap resolves.</p>
    </main>
  );
}

export function AuthenticatedLayout() {
  return <Outlet />;
}
