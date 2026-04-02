import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { useEffect } from "react";

import {
  type AuthController,
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

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function apply(e: MediaQueryListEvent | MediaQueryList) {
      document.documentElement.classList.toggle("dark", e.matches);
    }
    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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
          {snapshot.status === "authenticated" && snapshot.session?.user ? (
            <span className="text-muted-foreground text-sm">
              {snapshot.session.user.name ?? snapshot.session.user.email}
            </span>
          ) : snapshot.status === "signed-out" ||
            snapshot.status === "error" ? (
            <Link
              className="text-primary text-sm underline-offset-4 hover:underline"
              to="/auth/sign-in"
            >
              Sign in
            </Link>
          ) : null}
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
