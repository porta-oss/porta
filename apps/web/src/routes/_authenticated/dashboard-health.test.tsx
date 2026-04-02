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

async function openOperationsTab(view: ReturnType<typeof render>) {
  fireEvent.click(await view.findByRole("tab", { name: /Operations/i }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_A: WorkspaceSummary = {
  id: "workspace_a",
  name: "Acme Ventures",
  slug: "acme-ventures",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
        active_users: { value: 340, previous: 300 },
        customer_count: { value: 42, previous: 38 },
        churn_rate: { value: 2.1, previous: 2.5 },
        arpu: { value: 297, previous: 289 },
        trial_conversion_rate: { value: 18.5, previous: 16.2 },
      },
      funnel: [
        { stage: "visitor", label: "Visitors", value: 8200, position: 0 },
        { stage: "signup", label: "Sign-ups", value: 620, position: 1 },
        { stage: "activation", label: "Activated", value: 210, position: 2 },
        {
          stage: "paying_customer",
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

function createStalePayload(): StartupHealthPayload {
  const healthy = createHealthyPayload();
  return {
    ...healthy,
    status: "stale",
    lastSnapshotAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
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
        workspace: WORKSPACE_A,
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
  };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Health page tests
// ---------------------------------------------------------------------------

describe("startup health page", () => {
  test("renders the north-star hero with MRR value and delta", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
    const northStar = view.getByTestId("north-star-value");
    expect(northStar.textContent).toContain("12,500");

    const delta = view.getByTestId("north-star-delta");
    expect(delta.textContent).toContain("+13.6%");
  });

  test("renders supporting metrics grid with all five metrics", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Expand the supporting metrics disclosure
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /supporting metrics/i }));

    expect(view.getByLabelText("supporting metrics")).toBeTruthy();
    expect(view.getByTestId("metric-active_users").textContent).toContain(
      "340"
    );
    expect(view.getByTestId("metric-customer_count").textContent).toContain(
      "42"
    );
    expect(view.getByTestId("metric-churn_rate").textContent).toContain("2.1%");
    expect(view.getByTestId("metric-arpu").textContent).toContain("297");
    expect(
      view.getByTestId("metric-trial_conversion_rate").textContent
    ).toContain("18.5%");
  });

  test("renders the acquisition funnel with four stages", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Expand the acquisition funnel disclosure
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /acquisition funnel/i }));

    expect(view.getByLabelText("funnel")).toBeTruthy();
    expect(view.getByTestId("funnel-visitor").textContent).toContain("8,200");
    expect(view.getByTestId("funnel-signup").textContent).toContain("620");
    expect(view.getByTestId("funnel-activation").textContent).toContain("210");
    expect(view.getByTestId("funnel-paying_customer").textContent).toContain(
      "42"
    );
  });

  test("shows blocked state with actionable guidance when no connectors exist", async () => {
    const api = createApi({
      fetchHealth: mock(async () => createBlockedPayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
    const hero = view.getByLabelText("startup health hero");
    expect(hero.textContent).toContain("Blocked");
    expect(view.getByLabelText("blocked reasons")).toBeTruthy();
    expect(
      view.getAllByText(/No data connectors are configured/).length
    ).toBeGreaterThanOrEqual(1);
  });

  test("shows stale guidance pointing to connector resync when data is stale", async () => {
    const api = createApi({
      fetchHealth: mock(async () => createStalePayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
    expect(view.getByText("Stale data")).toBeTruthy();
    expect(
      view.getByText(/Open Operations to refresh your connectors/)
    ).toBeTruthy();
  });

  test("shows health error inline without losing connector panel", async () => {
    const api = createApi({
      listConnectors: mock(async () => ({
        connectors: [createConnector("posthog", "connected")],
      })),
      fetchHealth: mock(async () => {
        throw new Error("Server error");
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Health error should appear
    expect(await view.findByLabelText("health error")).toBeTruthy();
    expect(view.getAllByText("Server error").length).toBeGreaterThanOrEqual(1);

    // Connector panel should still be visible
    await openOperationsTab(view);
    expect(view.getByLabelText("connector status")).toBeTruthy();
    expect(view.getByText("Connected")).toBeTruthy();

    // Retry button should exist
    expect(
      view.getByRole("button", { name: "Retry health load" })
    ).toBeTruthy();
  });

  test("treats malformed health payload as a recoverable UI error", async () => {
    const api = createApi({
      fetchHealth: mock(async () => {
        throw new Error(
          "Health snapshot contains invalid data: Missing supporting metric key: arpu."
        );
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("health error")).toBeTruthy();
    expect(
      view.getAllByText(/Health snapshot contains invalid data/).length
    ).toBeGreaterThanOrEqual(1);
    expect(
      view.getByRole("button", { name: "Retry health load" })
    ).toBeTruthy();
  });

  test("health hero shows zero MRR without delta when no previous value", async () => {
    const payload = createHealthyPayload();
    if (!payload.health) {
      throw new Error("Expected a healthy payload for this test.");
    }
    payload.health.northStarValue = 0;
    payload.health.northStarPreviousValue = null;

    const api = createApi({
      fetchHealth: mock(async () => payload),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("north-star-value")).toBeTruthy();
    expect(view.getByTestId("north-star-value").textContent).toContain("$0");
    expect(view.queryByTestId("north-star-delta")).toBeNull();
  });

  test("shows loading state before health data arrives", async () => {
    let resolveHealth: ((value: StartupHealthPayload) => void) | undefined;
    const healthPromise = new Promise<StartupHealthPayload>((resolve) => {
      resolveHealth = resolve;
    });

    const api = createApi({
      fetchHealth: mock(async () => healthPromise),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByText("Loading health data…")).toBeTruthy();

    // Resolve health to let the test clean up
    resolveHealth?.(createHealthyPayload());
    await waitFor(() => {
      expect(view.queryByText("Loading health data…")).toBeNull();
    });
  });

  test("retries health load when retry button is clicked after error", async () => {
    let attempt = 0;
    const fetchHealth = mock(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Transient failure");
      }
      return createHealthyPayload();
    });

    const api = createApi({ fetchHealth });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("health error")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Retry health load" }));

    await waitFor(() => {
      expect(fetchHealth).toHaveBeenCalledTimes(2);
    });
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
  });
});
