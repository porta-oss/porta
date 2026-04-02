import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";

import {
  type AuthController,
  describeSessionState,
  useAuthBootstrap,
  useAuthSnapshot,
} from "../lib/auth-client";

export interface AppRouterContext {
  auth: AuthController;
}

export const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const { auth } = rootRoute.useRouteContext();
  const bootstrapSnapshot = useAuthBootstrap(auth);
  const liveSnapshot = useAuthSnapshot(auth);
  const snapshot =
    liveSnapshot.status === "idle" ? bootstrapSnapshot : liveSnapshot;

  return (
    <div className="min-h-screen" data-auth-state={snapshot.status}>
      <header className="flex items-center justify-between border-border border-b px-6 py-4">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            Porta
          </p>
          <strong>Portfolio Dashboard</strong>
        </div>
        <nav>
          <Link
            className="text-primary text-sm underline-offset-4 hover:underline"
            to="/auth/sign-in"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <div
        aria-live="polite"
        className={`border-border border-b px-6 py-3 text-sm ${
          snapshot.status === "error"
            ? "bg-danger-bg text-danger"
            : "bg-muted text-muted-foreground"
        }`}
        data-auth-diagnostic={snapshot.diagnostic}
        role="status"
      >
        {describeSessionState(snapshot)}
      </div>

      <Outlet />
    </div>
  );
}
