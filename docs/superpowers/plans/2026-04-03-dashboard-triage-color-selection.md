# Dashboard Triage Color And Startup Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the startup list into explicit route-backed startup navigation and add restrained health color cues to the sidebar, portfolio card, and health detail surface.

**Architecture:** Split routing into an `/app` entry route and a `/app/startups/$startupId` route, then keep `DashboardPage` as the reusable stateful view that derives its selected startup from route-driven props. Add a lightweight per-startup health summary map for sidebar cues, and centralize health-to-UI mapping in one small helper so card and list treatments stay consistent.

**Tech Stack:** React 19, TanStack React Router, Bun test, Testing Library, Tailwind/shadcn

---

## File Structure

- `apps/web/src/routes/_authenticated/dashboard-index.tsx`
  `/app` entry route. Boots `DashboardPage` without a selected startup id and lets the page normalize to the first startup in the active workspace.
- `apps/web/src/routes/_authenticated/dashboard-startup.tsx`
  `/app/startups/$startupId` wrapper. Reads the route param and passes it into `DashboardPage`.
- `apps/web/src/routes/_authenticated/dashboard.tsx`
  Shared page logic. Owns selected-startup normalization, workspace switch rewriting, selected-startup refetching, and portfolio-wide health summary loading.
- `apps/web/src/router.tsx`
  Registers the new dashboard route objects in the route tree.
- `apps/web/src/components/app-shell.tsx`
  Forwards active startup and sidebar selection callbacks into the shell.
- `apps/web/src/components/startup-list.tsx`
  Renders interactive sidebar rows, selected-row state, and later the health indicators.
- `apps/web/src/lib/startup-health-tone.ts`
  Shared mapping from backend health state or summary load failure to UI tone, row tint, and marker treatment.
- `apps/web/src/components/portfolio-startup-card.tsx`
  Applies the subtle semantic surface wash to the triage card.
- `apps/web/src/routes/_authenticated/dashboard.test.tsx`
  Covers selection normalization, row navigation, workspace switch rewrites, and portfolio-wide health summary loading.
- `apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx`
  Covers semantic tint behavior on the portfolio card.
- `apps/web/src/routes/_authenticated/dashboard-health.test.tsx`
  Covers the softer health detail separator treatment.

### Task 1: Add Route-Backed Startup Selection

**Files:**
- Create: `apps/web/src/routes/_authenticated/dashboard-index.tsx`
- Create: `apps/web/src/routes/_authenticated/dashboard-startup.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Test: `apps/web/src/routes/_authenticated/dashboard.test.tsx`

- [ ] **Step 1: Write the failing selection-normalization test**

```tsx
test("normalizes a missing route startup id to the first startup in the workspace", async () => {
  const navigateToStartup = mock(async () => {});
  const api = createApi({
    listStartups: mock(async () => ({
      workspace: WORKSPACE_A,
      startups: [
        createStartup(WORKSPACE_A.id, "Acme Analytics"),
        createStartup(WORKSPACE_A.id, "Beta Billing"),
      ],
    })),
  });

  render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={null}
      navigateToStartup={navigateToStartup}
    />
  );

  await waitFor(() => {
    expect(navigateToStartup).toHaveBeenCalledWith(
      `${WORKSPACE_A.id}_Acme Analytics`,
      true
    );
  });
});
```

- [ ] **Step 2: Run the dashboard route tests and verify they fail**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: FAIL with a type error or runtime failure because `DashboardPage` does not yet accept `routeStartupId` and `navigateToStartup`.

- [ ] **Step 3: Add the new route wrappers and selection props**

```tsx
// apps/web/src/routes/_authenticated/dashboard-index.tsx
import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { type AuthSnapshot } from "../../lib/auth-client";
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
      routeStartupId={null}
      navigateToStartup={(startupId, replace = false) =>
        navigate({
          params: { startupId },
          replace,
          to: "/app/startups/$startupId",
        })
      }
    />
  );
}
```

```tsx
// apps/web/src/routes/_authenticated/dashboard-startup.tsx
import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { type AuthSnapshot } from "../../lib/auth-client";
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
      routeStartupId={startupId}
      navigateToStartup={(nextStartupId, replace = false) =>
        navigate({
          params: { startupId: nextStartupId },
          replace,
          to: "/app/startups/$startupId",
        })
      }
    />
  );
}
```

```tsx
// apps/web/src/router.tsx
import { dashboardIndexRoute } from "./routes/_authenticated/dashboard-index";
import { dashboardStartupRoute } from "./routes/_authenticated/dashboard-startup";

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  authenticatedRoute.addChildren([
    dashboardIndexRoute,
    dashboardStartupRoute,
    onboardingRoute,
  ]),
]);
```

```tsx
// apps/web/src/routes/_authenticated/dashboard.tsx
export interface DashboardPageProps {
  api?: DashboardApi;
  authState: AuthSnapshot;
  navigateToStartup?: (
    startupId: string,
    replace?: boolean
  ) => void | Promise<void>;
  routeStartupId?: string | null;
}

const selectedStartup =
  startups.find((startup) => startup.id === routeStartupId) ?? null;

useEffect(() => {
  if (startupStatus !== "ready" || startups.length === 0) {
    return;
  }

  if (!routeStartupId || selectedStartup === null) {
    void navigateToStartup?.(startups[0]!.id, true);
  }
}, [
  navigateToStartup,
  routeStartupId,
  selectedStartup,
  startupStatus,
  startups,
]);
```

- [ ] **Step 4: Re-run the dashboard route tests**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: PASS for the new route-normalization test and the existing dashboard route assertions.

- [ ] **Step 5: Commit the route scaffolding**

```bash
git add apps/web/src/routes/_authenticated/dashboard-index.tsx apps/web/src/routes/_authenticated/dashboard-startup.tsx apps/web/src/router.tsx apps/web/src/routes/_authenticated/dashboard.tsx apps/web/src/routes/_authenticated/dashboard.test.tsx
git commit -m "feat: route dashboard by startup"
```

### Task 2: Make The Sidebar Real Navigation

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/startup-list.tsx`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Test: `apps/web/src/routes/_authenticated/dashboard.test.tsx`

- [ ] **Step 1: Write the failing sidebar navigation test**

```tsx
test("routes sidebar clicks through startup navigation and marks the active row", async () => {
  const navigateToStartup = mock(async () => {});
  const api = createApi({
    listStartups: mock(async () => ({
      workspace: WORKSPACE_A,
      startups: [
        createStartup(WORKSPACE_A.id, "Acme Analytics"),
        createStartup(WORKSPACE_A.id, "Beta Billing"),
      ],
    })),
  });

  const view = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      navigateToStartup={navigateToStartup}
      routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
    />
  );

  const betaRow = await view.findByRole("button", { name: /Beta Billing/i });
  fireEvent.click(betaRow);

  expect(navigateToStartup).toHaveBeenCalledWith(
    `${WORKSPACE_A.id}_Beta Billing`,
    false
  );

  const activeRow = view.getByRole("button", { name: /Acme Analytics/i });
  expect(activeRow.getAttribute("aria-pressed")).toBe("true");
});
```

- [ ] **Step 2: Run the dashboard route tests and verify the new assertion fails**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: FAIL because the startup list rows are not interactive buttons and no active-row prop is wired through the shell.

- [ ] **Step 3: Pass active startup state and navigation callbacks through the shell**

```tsx
// apps/web/src/components/app-shell.tsx
import type { HealthState } from "@shared/startup-health";

export interface AppShellProps {
  activeStartupId?: string | null;
  onSelectStartup?: (startupId: string) => void | Promise<void>;
  startupHealthById?: Record<string, HealthState | "load-error">;
}

<StartupList
  activeStartupId={activeStartupId ?? null}
  error={startupError}
  onRetry={onRetryStartups}
  onSelectStartup={onSelectStartup}
  startupHealthById={startupHealthById ?? {}}
  startups={startups}
  status={startupStatus}
  workspaceName={activeWorkspace?.name ?? null}
/>
```

```tsx
// apps/web/src/components/startup-list.tsx
import type { HealthState } from "@shared/startup-health";

export interface StartupListProps {
  activeStartupId?: string | null;
  onSelectStartup?: (startupId: string) => void | Promise<void>;
  startupHealthById?: Record<string, HealthState | "load-error">;
}

{startups.map((startup) => {
  const isActive = startup.id === activeStartupId;

  return (
    <li key={startup.id}>
      <button
        aria-pressed={isActive}
        className={
          isActive
            ? "flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-left transition-colors"
            : "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/50"
        }
        onClick={() => void onSelectStartup?.(startup.id)}
        type="button"
      >
        <span className="font-medium text-sm">{startup.name}</span>
        <span className="text-muted-foreground text-xs">
          {startup.stage.replace("_", " ")}
        </span>
      </button>
    </li>
  );
})}
```

```tsx
// apps/web/src/routes/_authenticated/dashboard.tsx
<AppShell
  activeStartupId={selectedStartup?.id ?? null}
  onSelectStartup={(startupId) => {
    void navigateToStartup?.(startupId, false);
  }}
  shellError={shellError}
  shellStatus={shellStatus}
  startupError={startupError}
  startupHealthById={{}}
  startupStatus={startupStatus}
  startups={startups}
  workspaceError={workspaceError}
  workspaces={workspaces}
>
```

- [ ] **Step 4: Re-run the dashboard route tests**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: PASS with the new sidebar navigation coverage green.

- [ ] **Step 5: Commit the sidebar navigation work**

```bash
git add apps/web/src/components/app-shell.tsx apps/web/src/components/startup-list.tsx apps/web/src/routes/_authenticated/dashboard.tsx apps/web/src/routes/_authenticated/dashboard.test.tsx
git commit -m "feat: make startup list navigable"
```

### Task 3: Load Portfolio-Wide Health Summaries And Rewrite Stale Selections

**Files:**
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/components/startup-list.tsx`
- Test: `apps/web/src/routes/_authenticated/dashboard.test.tsx`

- [ ] **Step 1: Write the failing summary-loading and workspace-switch tests**

```tsx
test("loads sidebar health summaries for every startup and isolates row-level failures", async () => {
  const fetchHealth = mock(async (startupId: string) => {
    if (startupId.endsWith("Beta Billing")) {
      throw new Error("connector timeout");
    }

    return startupId.endsWith("Gamma Growth")
      ? createBlockedPayload()
      : createHealthyPayload();
  });

  const api = createApi({
    fetchHealth,
    listStartups: mock(async () => ({
      workspace: WORKSPACE_A,
      startups: [
        createStartup(WORKSPACE_A.id, "Acme Analytics"),
        createStartup(WORKSPACE_A.id, "Beta Billing"),
        createStartup(WORKSPACE_A.id, "Gamma Growth"),
      ],
    })),
  });

  const view = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
    />
  );

  await waitFor(() => {
    expect(fetchHealth).toHaveBeenCalledTimes(4);
  });

  expect(
    view
      .getByRole("button", { name: /Beta Billing/i })
      .getAttribute("data-health-tone")
  ).toBe("error");
  expect(
    view
      .getByRole("button", { name: /Gamma Growth/i })
      .getAttribute("data-health-tone")
  ).toBe("blocked");
});

test("replaces a stale route startup after switching workspaces", async () => {
  const navigateToStartup = mock(async () => {});
  let startupListCall = 0;
  const api = createApi({
    listStartups: mock(async () => {
      startupListCall += 1;

      return startupListCall === 1
        ? {
            workspace: WORKSPACE_A,
            startups: [createStartup(WORKSPACE_A.id, "Acme Analytics")],
          }
        : {
            workspace: WORKSPACE_B,
            startups: [createStartup(WORKSPACE_B.id, "Beta Control")],
          };
    }),
    setActiveWorkspace: mock(async () => ({
      activeWorkspaceId: WORKSPACE_B.id,
      workspace: WORKSPACE_B,
    })),
  });

  const view = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      navigateToStartup={navigateToStartup}
      routeStartupId="workspace_a_missing"
    />
  );

  fireEvent.click(await view.findByRole("combobox", { name: /workspace/i }));
  fireEvent.click(await view.findByRole("option", { name: /Beta Ventures/i }));

  await waitFor(() => {
    expect(navigateToStartup).toHaveBeenCalledWith(
      `${WORKSPACE_B.id}_Beta Control`,
      true
    );
  });
});

test("refetches selected-startup detail when the route startup changes", async () => {
  const fetchHealth = mock(async () => createHealthyPayload());
  const fetchInsight = mock(async () => ({
    diagnosticMessage: "No insight available yet.",
    displayStatus: "unavailable" as const,
    insight: null,
  }));
  const listTasks = mock(async () => ({ tasks: [], startupId: "", count: 0 }));
  const listConnectors = mock(async () => ({ connectors: [] }));
  const api = createApi({
    fetchHealth,
    fetchInsight,
    listConnectors,
    listStartups: mock(async () => ({
      workspace: WORKSPACE_A,
      startups: [
        createStartup(WORKSPACE_A.id, "Acme Analytics"),
        createStartup(WORKSPACE_A.id, "Beta Billing"),
      ],
    })),
    listTasks,
  });

  const { rerender } = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
    />
  );

  await waitFor(() => {
    expect(fetchInsight).toHaveBeenCalledWith(
      `${WORKSPACE_A.id}_Acme Analytics`
    );
  });

  rerender(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={`${WORKSPACE_A.id}_Beta Billing`}
    />
  );

  await waitFor(() => {
    expect(fetchInsight).toHaveBeenCalledWith(
      `${WORKSPACE_A.id}_Beta Billing`
    );
    expect(listConnectors).toHaveBeenCalledWith(
      `${WORKSPACE_A.id}_Beta Billing`
    );
    expect(listTasks).toHaveBeenCalledWith(`${WORKSPACE_A.id}_Beta Billing`);
  });
});
```

- [ ] **Step 2: Run the dashboard tests and verify they fail**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: FAIL because there is no summary map, no row-level health tone data, and workspace switches still assume `startups[0]` without a stale-route rewrite.

- [ ] **Step 3: Add the health summary map and selected-startup rewrite effects**

```tsx
// apps/web/src/routes/_authenticated/dashboard.tsx
import type { HealthState } from "@shared/startup-health";

type StartupHealthSummaryMap = Record<string, HealthState | "load-error">;

const [startupHealthById, setStartupHealthById] =
  useState<StartupHealthSummaryMap>({});

useEffect(() => {
  if (startups.length === 0) {
    setStartupHealthById({});
    return;
  }

  let cancelled = false;

  void Promise.all(
    startups.map(async (startup) => {
      try {
        const payload = await api.fetchHealth(startup.id);
        return [startup.id, payload.status] as const;
      } catch {
        return [startup.id, "load-error"] as const;
      }
    })
  ).then((entries) => {
    if (!cancelled) {
      setStartupHealthById(Object.fromEntries(entries));
    }
  });

  return () => {
    cancelled = true;
  };
}, [api, startups]);

useEffect(() => {
  if (startupStatus !== "ready" || startups.length === 0) {
    return;
  }

  const routeStartupStillValid = startups.some(
    (startup) => startup.id === routeStartupId
  );

  if (!routeStartupId || !routeStartupStillValid) {
    void navigateToStartup?.(startups[0]!.id, true);
  }
}, [navigateToStartup, routeStartupId, startupStatus, startups]);
```

```tsx
// apps/web/src/routes/_authenticated/dashboard.tsx
const selectedStartup =
  startups.find((startup) => startup.id === routeStartupId) ?? null;
const selectedStartupId = selectedStartup?.id ?? null;

useEffect(() => {
  if (selectedStartupId) {
    void refreshConnectors(selectedStartupId);
    void refreshHealth(selectedStartupId);
    void refreshInsight(selectedStartupId);
    void refreshTasks(selectedStartupId);
  }
}, [selectedStartupId]);

<AppShell
  activeStartupId={selectedStartupId}
  onSelectStartup={(startupId) => {
    void navigateToStartup?.(startupId, false);
  }}
  startupHealthById={startupHealthById}
>
```

- [ ] **Step 4: Re-run the dashboard tests**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: PASS with green coverage for summary loading, invalid-route replacement, and route-driven refetching.

- [ ] **Step 5: Commit the summary-loading and selection rewrite work**

```bash
git add apps/web/src/routes/_authenticated/dashboard.tsx apps/web/src/components/app-shell.tsx apps/web/src/components/startup-list.tsx apps/web/src/routes/_authenticated/dashboard.test.tsx
git commit -m "feat: preload portfolio health summaries"
```

### Task 4: Add Calm Semantic Health Cues

**Files:**
- Create: `apps/web/src/lib/startup-health-tone.ts`
- Modify: `apps/web/src/components/startup-list.tsx`
- Modify: `apps/web/src/components/portfolio-startup-card.tsx`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Test: `apps/web/src/routes/_authenticated/dashboard.test.tsx`
- Test: `apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx`
- Test: `apps/web/src/routes/_authenticated/dashboard-health.test.tsx`

- [ ] **Step 1: Write the failing semantic-style tests**

```tsx
// apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx
test("applies a healthy surface tone to the portfolio card", async () => {
  const api = createApi({
    fetchHealth: mock(async () => createHealthyPayload()),
  });

  const view = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
    />
  );

  const card = await view.findByLabelText("portfolio startup card");
  expect(card.getAttribute("data-health-tone")).toBe("healthy");
});
```

```tsx
// apps/web/src/routes/_authenticated/dashboard.test.tsx
test("renders blocked rows with a solid marker and error rows with a ring marker", async () => {
  const api = createApi({
    fetchHealth: mock(async (startupId: string) => {
      if (startupId.endsWith("Beta Billing")) {
        throw new Error("connector timeout");
      }

      return startupId.endsWith("Gamma Growth")
        ? createBlockedPayload()
        : createHealthyPayload();
    }),
    listStartups: mock(async () => ({
      workspace: WORKSPACE_A,
      startups: [
        createStartup(WORKSPACE_A.id, "Acme Analytics"),
        createStartup(WORKSPACE_A.id, "Beta Billing"),
        createStartup(WORKSPACE_A.id, "Gamma Growth"),
      ],
    })),
  });
  const view = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
    />
  );

  await view.findByRole("button", { name: /Gamma Growth/i });

  expect(
    view
      .getByRole("button", { name: /Gamma Growth/i })
      .getAttribute("data-health-indicator")
  ).toBe("solid");
  expect(
    view
      .getByRole("button", { name: /Beta Billing/i })
      .getAttribute("data-health-indicator")
  ).toBe("ring");
});
```

```tsx
// apps/web/src/routes/_authenticated/dashboard-health.test.tsx
test("uses a muted separator above the health detail surface", async () => {
  const api = createApi();
  const view = render(
    <DashboardPage
      api={api}
      authState={createAuthenticatedSnapshot()}
      routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
    />
  );

  await openHealthConnectorsTab(view);

  const separator = await view.findByTestId("health-detail-separator");
  expect(separator.className).toContain("bg-border/60");
});
```

- [ ] **Step 2: Run the affected dashboard tests and verify they fail**

Run: `bun test apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx && bun test apps/web/src/routes/_authenticated/dashboard-health.test.tsx && bun test apps/web/src/routes/_authenticated/dashboard.test.tsx`

Expected: FAIL because there is no shared tone helper, no `data-health-tone` or `data-health-indicator` attributes, and no muted separator in the health section.

- [ ] **Step 3: Add the tone helper and wire the visual treatments**

```ts
// apps/web/src/lib/startup-health-tone.ts
import type { HealthState } from "@shared/startup-health";

export type StartupHealthTone =
  | "healthy"
  | "attention"
  | "blocked"
  | "error"
  | "neutral";

export function toStartupHealthTone(
  state: HealthState | "load-error" | null
): StartupHealthTone {
  switch (state) {
    case "ready":
      return "healthy";
    case "stale":
      return "attention";
    case "blocked":
      return "blocked";
    case "error":
    case "load-error":
      return "error";
    default:
      return "neutral";
  }
}

export function startupRowToneClass(tone: StartupHealthTone): string {
  switch (tone) {
    case "healthy":
      return "bg-success-bg/55";
    case "attention":
      return "bg-warning-bg/55";
    case "blocked":
      return "bg-danger-bg/55";
    case "error":
      return "bg-danger-bg/35";
    default:
      return "bg-muted";
  }
}

export function startupIndicatorVariant(
  tone: StartupHealthTone
): "solid" | "ring" | "neutral" {
  if (tone === "error") {
    return "ring";
  }
  if (tone === "healthy" || tone === "attention" || tone === "blocked") {
    return "solid";
  }
  return "neutral";
}
```

```tsx
// apps/web/src/components/startup-list.tsx
import { cn } from "@/lib/utils";
import {
  startupIndicatorVariant,
  startupRowToneClass,
  toStartupHealthTone,
} from "@/lib/startup-health-tone";

const tone = toStartupHealthTone(
  (startupHealthById?.[startup.id] as HealthState | "load-error" | null) ?? null
);
const indicatorVariant = startupIndicatorVariant(tone);

<button
  aria-pressed={isActive}
  className={cn(
    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors",
    isActive ? startupRowToneClass(tone) : "hover:bg-muted/50"
  )}
  data-health-indicator={indicatorVariant}
  data-health-tone={tone}
  onClick={() => void onSelectStartup?.(startup.id)}
  type="button"
>
  <span className="flex items-center gap-2">
    <span
      aria-hidden="true"
      className={cn(
        "h-2.5 w-2.5 rounded-full",
        indicatorVariant === "ring" && "border border-danger bg-card",
        tone === "healthy" && indicatorVariant === "solid" && "bg-success",
        tone === "attention" && indicatorVariant === "solid" && "bg-warning",
        tone === "blocked" && indicatorVariant === "solid" && "bg-danger"
      )}
    />
    <span className="font-medium text-sm">{startup.name}</span>
  </span>
```

```tsx
// apps/web/src/components/portfolio-startup-card.tsx
import { toStartupHealthTone } from "@/lib/startup-health-tone";

const tone = toStartupHealthTone(viewModel.healthState);

<Card
  aria-label="portfolio startup card"
  className={cn(
    tone === "healthy" && "bg-success-bg/50",
    tone === "attention" && "bg-warning-bg/50",
    tone === "blocked" && "bg-danger-bg/50",
    tone === "error" && "bg-danger-bg/35"
  )}
  data-health-tone={tone}
  data-testid="portfolio-startup-card"
>
```

```tsx
// apps/web/src/routes/_authenticated/dashboard.tsx
import { Separator } from "@/components/ui/separator";

<section aria-labelledby="dashboard-health-heading" className="grid gap-4">
  <div className="grid gap-1">
    <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
      Health
    </p>
    <h3
      className="font-semibold text-lg tracking-tight"
      id="dashboard-health-heading"
    >
      Startup health detail
    </h3>
  </div>
  <Separator className="bg-border/60" data-testid="health-detail-separator" />
```

- [ ] **Step 4: Run the focused tests, typecheck, and lint**

Run: `bun test apps/web/src/routes/_authenticated/dashboard.test.tsx && bun test apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx && bun test apps/web/src/routes/_authenticated/dashboard-health.test.tsx && bun run typecheck && pnpm dlx ultracite check`

Expected: PASS across the three dashboard test files, successful TypeScript output, and no remaining Ultracite diagnostics.

- [ ] **Step 5: Commit the semantic cue polish**

```bash
git add apps/web/src/lib/startup-health-tone.ts apps/web/src/components/startup-list.tsx apps/web/src/components/portfolio-startup-card.tsx apps/web/src/routes/_authenticated/dashboard.tsx apps/web/src/routes/_authenticated/dashboard.test.tsx apps/web/src/routes/_authenticated/dashboard-portfolio.test.tsx apps/web/src/routes/_authenticated/dashboard-health.test.tsx
git commit -m "feat: add dashboard health color cues"
```
