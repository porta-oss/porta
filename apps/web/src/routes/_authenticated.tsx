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
    <main aria-label="auth bootstrap" className="p-6">
      <h1 className="font-bold text-xl">Signing you in…</h1>
      <p className="mt-2 text-muted-foreground">
        Verifying your session before loading the dashboard.
      </p>
    </main>
  );
}

export function AuthenticatedLayout() {
  return <Outlet />;
}
