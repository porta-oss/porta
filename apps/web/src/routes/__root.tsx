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
    <div
      data-auth-state={snapshot.status}
      style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh" }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 1.5rem",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              color: "#4b5563",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Founder Control Plane
          </p>
          <strong>Auth and workspace shell</strong>
        </div>
        <nav>
          <Link to="/auth/sign-in">Sign in</Link>
        </nav>
      </header>

      <div
        aria-live="polite"
        data-auth-diagnostic={snapshot.diagnostic}
        role="status"
        style={{
          padding: "0.75rem 1.5rem",
          background: snapshot.status === "error" ? "#fef2f2" : "#f9fafb",
          color: snapshot.status === "error" ? "#991b1b" : "#374151",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        {describeSessionState(snapshot)}
      </div>

      <Outlet />
    </div>
  );
}
