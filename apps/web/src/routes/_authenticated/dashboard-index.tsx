import { createRoute } from "@tanstack/react-router";
import type { DashboardMode } from "../../components/mode-switcher";
import type { AuthSnapshot } from "../../lib/auth-client";
import { authenticatedRoute } from "../_authenticated";
import { DashboardPage, type DashboardSearch } from "./dashboard";

const VALID_MODES: DashboardMode[] = ["decide", "journal", "compare"];

export const dashboardIndexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app",
  validateSearch: (search): DashboardSearch => ({
    event:
      typeof search.event === "string" && search.event.length > 0
        ? search.event
        : undefined,
    mode:
      typeof search.mode === "string" &&
      VALID_MODES.includes(search.mode as DashboardMode)
        ? (search.mode as DashboardMode)
        : undefined,
  }),
  component: DashboardIndexRouteComponent,
});

function DashboardIndexRouteComponent() {
  const authState = dashboardIndexRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot,
  });
  const navigate = dashboardIndexRoute.useNavigate();
  const search = dashboardIndexRoute.useSearch();

  return (
    <DashboardPage
      authState={authState}
      eventId={search.event ?? null}
      mode={search.mode ?? "decide"}
      navigateToStartup={(startupId, replace = false) =>
        navigate({
          params: { startupId },
          replace,
          search: { mode: search.mode },
          to: "/app/startups/$startupId",
        })
      }
      onModeChange={(mode) => {
        void navigate({
          search: { mode: mode === "decide" ? undefined : mode },
          replace: true,
        });
      }}
      routeStartupId={null}
    />
  );
}
