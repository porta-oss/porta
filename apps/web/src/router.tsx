import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { type AuthController, authController } from "./lib/auth-client";
import { rootRoute } from "./routes/__root";
import { authenticatedRoute } from "./routes/_authenticated";
import { dashboardIndexRoute } from "./routes/_authenticated/dashboard-index";
import { dashboardStartupRoute } from "./routes/_authenticated/dashboard-startup";
import { onboardingRoute } from "./routes/_authenticated/onboarding";
import { signInRoute } from "./routes/auth/sign-in";
import { indexRoute } from "./routes/index";

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  authenticatedRoute.addChildren([
    dashboardIndexRoute,
    dashboardStartupRoute,
    onboardingRoute,
  ]),
]);

export function createAppRouter(
  auth: AuthController = authController,
  options?: { history?: RouterHistory }
) {
  return createRouter({
    routeTree,
    history: options?.history,
    context: {
      auth,
    },
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPreload: "intent",
  });
}

export const router = createAppRouter();

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
