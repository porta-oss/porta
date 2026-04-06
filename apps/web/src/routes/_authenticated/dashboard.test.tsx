import "../../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import type { AuthSnapshot } from "../../lib/auth-client";
import {
  type DashboardApi,
  DashboardPage,
  type StartupHealthPayload,
} from "./dashboard";

function setNativeInputValue(element: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function openHealthConnectorsTab(view: ReturnType<typeof render>) {
  fireEvent.click(
    await view.findByRole("tab", { name: /Health & connectors/i })
  );
}

const WORKSPACE_A: WorkspaceSummary = {
  id: "workspace_a",
  name: "Acme Ventures",
  slug: "acme-ventures",
};

const WORKSPACE_B: WorkspaceSummary = {
  id: "workspace_b",
  name: "Beta Ventures",
  slug: "beta-ventures",
};

function createStartup(
  workspaceId = WORKSPACE_A.id,
  name = "Acme Analytics"
): StartupRecord {
  return {
    id: `${workspaceId}_${name}`,
    workspaceId,
    name,
    type: "b2b_saas",
    stage: "mvp",
    timezone: "UTC",
    currency: "USD",
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  };
}

function createConnector(
  provider: ConnectorProvider,
  status: ConnectorSummary["status"] = "connected"
): ConnectorSummary {
  return {
    id: `connector_${provider}`,
    startupId: `${WORKSPACE_A.id}_Acme Analytics`,
    provider,
    status,
    lastSyncAt: status === "connected" ? "2026-01-01T12:00:00.000Z" : null,
    lastSyncDurationMs: status === "connected" ? 1200 : null,
    lastSyncError: status === "error" ? "Provider validation failed" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createAuthenticatedSnapshot(
  activeWorkspaceId: string | null = WORKSPACE_A.id
): AuthSnapshot {
  return {
    status: "authenticated",
    error: null,
    diagnostic: "none",
    lastResolvedAt: Date.now(),
    session: {
      user: {
        id: "user_123",
        email: "founder@example.com",
        name: "Founder",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
      },
      session: {
        id: "session_123",
        userId: "user_123",
        expiresAt: new Date(),
        activeOrganizationId: activeWorkspaceId,
        createdAt: new Date(),
        updatedAt: new Date(),
        token: "token_123",
        ipAddress: null,
        userAgent: null,
      },
    },
  };
}

function createApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listWorkspaces:
      overrides.listWorkspaces ??
      mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
    setActiveWorkspace:
      overrides.setActiveWorkspace ??
      mock(async ({ workspaceId }: { workspaceId: string }) => ({
        activeWorkspaceId: workspaceId,
        workspace: workspaceId === WORKSPACE_B.id ? WORKSPACE_B : WORKSPACE_A,
      })),
    listStartups:
      overrides.listStartups ??
      mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
    listConnectors:
      overrides.listConnectors ?? mock(async () => ({ connectors: [] })),
    createConnector:
      overrides.createConnector ??
      mock(async (_startupId: string, provider: ConnectorProvider) => ({
        connector: createConnector(provider, "pending"),
      })),
    triggerSync:
      overrides.triggerSync ??
      mock(async () => {
        /* noop */
      }),
    deleteConnector:
      overrides.deleteConnector ??
      mock(async () => {
        /* noop */
      }),
    fetchHealth:
      overrides.fetchHealth ?? mock(async () => createHealthyPayload()),
    fetchInsight:
      overrides.fetchInsight ??
      mock(async () => ({
        insight: null,
        displayStatus: "unavailable" as const,
        diagnosticMessage: "No insight available yet.",
      })),
    listTasks:
      overrides.listTasks ??
      mock(async () => ({ tasks: [], startupId: "", count: 0 })),
    createTask:
      overrides.createTask ??
      mock(async () => {
        throw new Error("not implemented");
      }),
    createPostgresMetric:
      overrides.createPostgresMetric ??
      mock(async () => {
        throw new Error("not implemented");
      }),
    listAlerts: overrides.listAlerts ?? mock(async () => ({ alerts: [] })),
    listEvents:
      overrides.listEvents ??
      mock(async () => ({
        events: [],
        pagination: { cursor: null, hasMore: false, limit: 50 },
      })),
    triageAlert:
      overrides.triageAlert ??
      mock(async () => {
        throw new Error("not implemented");
      }),
    fetchPortfolioSummary:
      overrides.fetchPortfolioSummary ?? mock(async () => ({ startups: [] })),
    fetchStreak: overrides.fetchStreak ?? mock(async () => ({ streak: null })),
  };
}

function createHealthyPayload(): StartupHealthPayload {
  return {
    health: {
      startupId: `${WORKSPACE_A.id}_Acme Analytics`,
      healthState: "ready",
      blockedReason: null,
      northStarKey: "mrr",
      northStarValue: 12_500,
      northStarPreviousValue: 11_000,
      supportingMetrics: {
        active_users: 340,
        churn_rate: 2.1,
        arpu: 297,
        mrr: 12_500,
        error_rate: 0.5,
        growth_rate: 13.6,
      },
      funnel: [
        { key: "visitor", label: "Visitors", value: 8200, position: 0 },
        { key: "signup", label: "Sign-ups", value: 620, position: 1 },
        { key: "activation", label: "Activated", value: 210, position: 2 },
        {
          key: "paying_customer",
          label: "Paying Customers",
          value: 42,
          position: 3,
        },
      ],
      computedAt: new Date().toISOString(),
      syncJobId: "job_123",
    },
    connectors: [
      {
        provider: "posthog",
        status: "connected",
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
      },
      {
        provider: "stripe",
        status: "connected",
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
      },
    ],
    status: "ready",
    blockedReasons: [],
    lastSnapshotAt: new Date().toISOString(),
    customMetric: null,
  };
}

function createBlockedPayload(): StartupHealthPayload {
  return {
    health: null,
    connectors: [],
    status: "blocked",
    blockedReasons: [
      {
        code: "NO_CONNECTORS",
        message:
          "No data connectors are configured. Connect PostHog or Stripe to populate health metrics.",
      },
    ],
    lastSnapshotAt: null,
    customMetric: null,
  };
}

afterEach(() => {
  cleanup();
});

describe("dashboard route", () => {
  test("normalizes a missing route startup id to the first startup in the workspace", async () => {
    const navigateToStartup = mock(async () => {
      /* noop */
    });
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
        navigateToStartup={navigateToStartup}
        routeStartupId={null}
      />
    );

    await waitFor(() => {
      expect(navigateToStartup).toHaveBeenCalledWith(
        `${WORKSPACE_A.id}_Acme Analytics`,
        true
      );
    });
  });

  test("shows the mounted workspace and startup context after bootstrap", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(
      await view.findByRole("main", { name: "portfolio dashboard" })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", { name: "Portfolio overview" })
    ).toBeTruthy();
    await waitFor(() => {
      expect(view.getAllByText("Acme Analytics").length).toBeGreaterThanOrEqual(
        2
      );
    });
  });

  test("routes sidebar clicks through startup navigation and marks the active row", async () => {
    const navigateToStartup = mock(async () => {
      /* noop */
    });
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

  test("loads sidebar health summaries for every startup after startup list resolves", async () => {
    const fetchHealth = mock(async (_startupId: string) =>
      createHealthyPayload()
    );
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
      expect(fetchHealth).toHaveBeenCalledTimes(3);
    });

    expect(
      view.container.querySelector('[data-health-summary-count="3"]')
    ).toBeTruthy();
  });

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

    const activeRow = await view.findByRole("button", {
      name: /Acme Analytics/i,
    });
    const blockedRow = view.getByRole("button", { name: /Gamma Growth/i });
    const errorRow = view.getByRole("button", { name: /Beta Billing/i });

    expect(activeRow.getAttribute("data-health-tone")).toBe("healthy");
    expect(activeRow.className).toContain("bg-success-bg/55");
    expect(blockedRow.getAttribute("data-health-indicator")).toBe("solid");
    expect(errorRow.getAttribute("data-health-indicator")).toBe("ring");
  });

  test("replaces a stale route startup after switching workspaces", async () => {
    const navigateToStartup = mock(async () => {
      /* noop */
    });
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
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A, WORKSPACE_B],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      setActiveWorkspace: mock(
        async ({ workspaceId }: { workspaceId: string }) => ({
          activeWorkspaceId: workspaceId,
          workspace: WORKSPACE_B,
        })
      ),
    });

    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        navigateToStartup={navigateToStartup}
        routeStartupId={`${WORKSPACE_A.id}_Acme Analytics`}
      />
    );

    await view.findAllByText("Acme Analytics");

    fireEvent.click(view.getByLabelText("Switch workspace"));
    fireEvent.click(await view.findByText("Beta Ventures"));
    fireEvent.click(view.getByRole("button", { name: "Switch" }));

    await waitFor(() => {
      expect(navigateToStartup).toHaveBeenCalledWith(
        `${WORKSPACE_B.id}_Beta Control`,
        true
      );
    });
  });

  test("refetches selected-startup detail when the route startup changes", async () => {
    const fetchInsight = mock(async () => ({
      diagnosticMessage: "No insight available yet.",
      displayStatus: "unavailable" as const,
      insight: null,
    }));
    const listTasks = mock(async () => ({
      tasks: [],
      startupId: "",
      count: 0,
    }));
    const listConnectors = mock(async () => ({ connectors: [] }));
    const api = createApi({
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

  test("keeps the shell chrome visible and points back to onboarding when the active workspace has no startups", async () => {
    const api = createApi({
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [],
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(
      await view.findByRole("main", { name: "portfolio dashboard" })
    ).toBeTruthy();
    expect(
      (
        await view.findAllByText(
          "No startups are attached to this workspace yet."
        )
      ).length
    ).toBeGreaterThan(0);
    expect(
      view.getByRole("link", { name: "Complete onboarding" })
    ).toBeTruthy();
  });

  test("preserves the shell chrome and exposes a retry path when startup navigation fails or is malformed", async () => {
    let attempt = 0;
    const listStartups = mock(async () => {
      attempt += 1;

      if (attempt === 1) {
        throw new Error("Startup navigation failed to load.");
      }

      return {
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      };
    });
    const api = createApi({ listStartups });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect((await view.findByRole("alert")).textContent).toContain(
      "Startup navigation failed to load."
    );
    expect(
      view.getByRole("heading", { name: "Portfolio overview" })
    ).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(listStartups).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(view.getAllByText("Acme Analytics").length).toBeGreaterThanOrEqual(
        2
      );
    });
  });

  test("shows a loading failure when workspace context cannot be parsed", async () => {
    const api = createApi({
      listWorkspaces: mock(async () => {
        throw new Error("Could not load the dashboard. Please try again.");
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot(null)} />
    );

    expect((await view.findByRole("alert")).textContent).toContain(
      "Could not load the dashboard. Please try again."
    );
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("switches the active workspace and reloads startup navigation for the new tenant", async () => {
    let startupListCall = 0;
    const listStartups = mock(async () => {
      startupListCall += 1;

      if (startupListCall === 1) {
        return {
          workspace: WORKSPACE_A,
          startups: [createStartup(WORKSPACE_A.id, "Acme Analytics")],
        };
      }

      return {
        workspace: WORKSPACE_B,
        startups: [createStartup(WORKSPACE_B.id, "Beta Analytics")],
      };
    });
    const setActiveWorkspace = mock(async () => ({
      activeWorkspaceId: WORKSPACE_B.id,
      workspace: WORKSPACE_B,
    }));
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A, WORKSPACE_B],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      setActiveWorkspace,
      listStartups,
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await view.findAllByText("Acme Analytics");

    fireEvent.click(view.getByLabelText("Switch workspace"));
    fireEvent.click(await view.findByText("Beta Ventures"));
    fireEvent.click(view.getByRole("button", { name: "Switch" }));

    await waitFor(() => {
      expect(setActiveWorkspace).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_B.id,
      });
    });
    await waitFor(() => {
      expect(view.getAllByText("Beta Analytics").length).toBeGreaterThanOrEqual(
        2
      );
    });
  });

  // ---------------------------------------------------------------
  // Connector status and management tests
  // ---------------------------------------------------------------

  test("shows connector status panel with connected and failed connectors", async () => {
    const api = createApi({
      listConnectors: mock(async () => ({
        connectors: [
          createConnector("posthog", "connected"),
          createConnector("stripe", "error"),
        ],
      })),
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await openHealthConnectorsTab(view);
    expect(await view.findByText("Connected")).toBeTruthy();
    expect(view.getByText("Sync failed")).toBeTruthy();
    expect(view.getByText("Provider validation failed")).toBeTruthy();
  });

  test("shows setup cards for providers without active connectors", async () => {
    const api = createApi({
      listConnectors: mock(async () => ({ connectors: [] })),
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("PostHog setup form")).toBeTruthy();
    expect(view.getByLabelText("Stripe setup form")).toBeTruthy();
  });

  test("hides the setup card after a connector is created successfully", async () => {
    const createConnector = mock(
      async (_startupId: string, provider: ConnectorProvider) => ({
        connector: {
          id: `connector_new_${provider}`,
          startupId: `${WORKSPACE_A.id}_Acme Analytics`,
          provider,
          status: "pending" as const,
          lastSyncAt: null,
          lastSyncDurationMs: null,
          lastSyncError: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      })
    );
    const api = createApi({
      listConnectors: mock(async () => ({ connectors: [] })),
      createConnector,
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );
    await openHealthConnectorsTab(view);
    await view.findByLabelText("Stripe setup form");

    // Fill and submit the Stripe form
    setNativeInputValue(
      view.getByLabelText("Secret key") as HTMLInputElement,
      "sk_test_valid123"
    );
    fireEvent.click(view.getByRole("button", { name: "Connect Stripe" }));

    await waitFor(() => {
      expect(createConnector).toHaveBeenCalled();
    });

    // Stripe setup form should disappear since connector now exists
    await waitFor(() => {
      expect(view.queryByLabelText("Stripe setup form")).toBeNull();
    });
  });

  test("resync button triggers a sync and refreshes connector list", async () => {
    let syncCallCount = 0;
    const triggerSync = mock(async () => {
      syncCallCount += 1;
    });
    let _listCall = 0;
    const listConnectors = mock(async () => {
      _listCall += 1;
      return {
        connectors: [createConnector("posthog", "connected")],
      };
    });
    const api = createApi({
      listConnectors,
      triggerSync,
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await openHealthConnectorsTab(view);
    const resyncButton = await view.findByRole("button", { name: "Resync" });
    fireEvent.click(resyncButton);

    await waitFor(() => {
      expect(syncCallCount).toBe(1);
    });
  });

  test("disconnect button calls delete and refreshes the connector list", async () => {
    let deleteCallCount = 0;
    const deleteConnector = mock(async () => {
      deleteCallCount += 1;
    });
    const api = createApi({
      listConnectors: mock(async () => ({
        connectors: [createConnector("posthog", "connected")],
      })),
      deleteConnector,
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await openHealthConnectorsTab(view);
    const disconnectButton = await view.findByRole("button", {
      name: "Disconnect",
    });
    fireEvent.click(disconnectButton);
    fireEvent.click(await view.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(deleteCallCount).toBe(1);
    });
  });

  test("shows resync failure as an inline error without losing connector state", async () => {
    const triggerSync = mock(async () => {
      throw new Error("Sync enqueue failed.");
    });
    const api = createApi({
      listConnectors: mock(async () => ({
        connectors: [createConnector("posthog", "connected")],
      })),
      triggerSync,
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await openHealthConnectorsTab(view);
    const resyncButton = await view.findByRole("button", { name: "Resync" });
    fireEvent.click(resyncButton);

    const alerts = await view.findAllByRole("alert");
    const syncAlert = alerts.find((a) =>
      a.textContent?.includes("Sync enqueue failed")
    );
    expect(syncAlert).toBeTruthy();

    // Connector should still be visible
    expect(view.getByText("Connected")).toBeTruthy();
  });

  test("prioritizes setup cards when no connectors exist", async () => {
    const api = createApi({
      listConnectors: mock(async () => ({ connectors: [] })),
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("PostHog setup form")).toBeTruthy();
    expect(view.getByLabelText("Stripe setup form")).toBeTruthy();
    expect(view.queryByLabelText("connector status")).toBeNull();
  });

  test("renders mode switcher with three tabs when startups exist", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByRole("tab", { name: /Decide/i })).toBeTruthy();
    expect(view.getByRole("tab", { name: /Journal/i })).toBeTruthy();
    expect(view.getByRole("tab", { name: /Compare/i })).toBeTruthy();
  });

  test("defaults to decide mode showing overview content", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const decideTab = await view.findByRole("tab", { name: /Decide/i });
    expect(decideTab.getAttribute("aria-selected")).toBe("true");
    expect(view.queryByLabelText("Journal mode")).toBeNull();
    expect(view.queryByLabelText("Compare mode")).toBeNull();
  });

  test("renders journal placeholder when mode is journal", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="journal"
      />
    );

    expect(await view.findByRole("tab", { name: /Journal/i })).toBeTruthy();
    expect(view.getByLabelText("Journal mode")).toBeTruthy();
    expect(view.queryByLabelText("Compare mode")).toBeNull();
  });

  test("renders compare placeholder when mode is compare", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="compare"
      />
    );

    expect(await view.findByRole("tab", { name: /Compare/i })).toBeTruthy();
    expect(view.getByLabelText("Compare mode")).toBeTruthy();
    expect(view.queryByLabelText("Journal mode")).toBeNull();
  });

  test("passes onModeChange callback to mode switcher", async () => {
    const onModeChange = mock(() => undefined);
    const api = createApi();
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="journal"
        onModeChange={onModeChange}
      />
    );

    const journalTab = await view.findByRole("tab", { name: /Journal/i });
    expect(journalTab.getAttribute("data-state")).toBe("active");
    expect(view.getByLabelText("Journal mode")).toBeTruthy();
  });

  test("mode switcher shows correct active state for each mode", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="compare"
      />
    );

    const compareTab = await view.findByRole("tab", { name: /Compare/i });
    expect(compareTab.getAttribute("data-state")).toBe("active");
    const decideTab = view.getByRole("tab", { name: /Decide/i });
    expect(decideTab.getAttribute("data-state")).toBe("inactive");
  });
});
