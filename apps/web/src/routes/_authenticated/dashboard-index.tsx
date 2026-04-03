import { createRoute } from "@tanstack/react-router";
import type { AuthSnapshot } from "../../lib/auth-client";
import { authenticatedRoute } from "../_authenticated";
import { DashboardPage } from "./dashboard";

export const dashboardIndexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app",
  component: DashboardIndexRouteComponent,
});

function DashboardIndexRouteComponent() {
  const authState = dashboardIndexRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot,
  });
  const navigate = dashboardIndexRoute.useNavigate();

  return (
    <DashboardPage
      authState={authState}
      navigateToStartup={(startupId, replace = false) =>
        navigate({
          params: { startupId },
          replace,
          to: "/app/startups/$startupId",
        })
      }
      routeStartupId={null}
    />
  );
}
