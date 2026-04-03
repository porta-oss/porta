import { createRoute } from "@tanstack/react-router";
import type { AuthSnapshot } from "../../lib/auth-client";
import { authenticatedRoute } from "../_authenticated";
import { DashboardPage } from "./dashboard";

export const dashboardStartupRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app/startups/$startupId",
  component: DashboardStartupRouteComponent,
});

function DashboardStartupRouteComponent() {
  const authState = dashboardStartupRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot,
  });
  const navigate = dashboardStartupRoute.useNavigate();
  const { startupId } = dashboardStartupRoute.useParams();

  return (
    <DashboardPage
      authState={authState}
      navigateToStartup={(nextStartupId, replace = false) =>
        navigate({
          params: { startupId: nextStartupId },
          replace,
          to: "/app/startups/$startupId",
        })
      }
      routeStartupId={startupId}
    />
  );
}
