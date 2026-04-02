import "../../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import { cleanup, render, waitFor } from "@testing-library/react";

import type { AuthSnapshot } from "../../lib/auth-client";
import {
  type DashboardApi,
  DashboardPage,
  type StartupHealthPayload,
} from "./dashboard";

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

function createSyncingPayload(): StartupHealthPayload {
  return {
    health: null,
    connectors: [
      {
        provider: "posthog",
        status: "pending",
        lastSyncAt: null,
        lastSyncError: null,
      },
    ],
    status: "syncing",
    blockedReasons: [],
    lastSnapshotAt: null,
    customMetric: null,
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
    triggerSync: overrides.triggerSync ?? mock(async () => {}),
    deleteConnector: overrides.deleteConnector ?? mock(async () => {}),
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
// Portfolio card tests
// ---------------------------------------------------------------------------

describe("portfolio startup card", () => {
  test("renders a healthy portfolio card with name, badge, trend, freshness, and top-issue", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Card should appear
    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    // Name
    expect(view.getByTestId("portfolio-startup-name").textContent).toContain(
      "Acme Analytics"
    );

    // Badge — healthy state
    const badge = view.getByTestId("portfolio-badge");
    expect(badge.textContent).toContain("Healthy");

    // North-star value
    const northStar = view.getByTestId("portfolio-north-star");
    expect(northStar.textContent).toContain("12,500");

    // Trend summary — MRR +13.6%
    const trend = view.getByTestId("portfolio-trend");
    expect(trend.textContent).toContain("MRR");
    expect(trend.textContent).toContain("+13.6%");

    // Freshness
    const freshness = view.getByTestId("portfolio-freshness");
    expect(freshness.textContent).toContain("Updated");

    // Top issue — all clear
    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain("All systems operational");
  });

  test("renders a blocked portfolio card with blocked badge and top-issue from blocked reasons", async () => {
    const api = createApi({
      fetchHealth: mock(async () => createBlockedPayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const badge = view.getByTestId("portfolio-badge");
    expect(badge.textContent).toContain("Blocked");

    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain("No data connectors are configured");

    // North-star value should show $0 for blocked state with no health
    const northStar = view.getByTestId("portfolio-north-star");
    expect(northStar.textContent).toContain("$0");

    // No trend when there's no previous value
    expect(view.queryByTestId("portfolio-trend")).toBeNull();

    // Freshness
    const freshness = view.getByTestId("portfolio-freshness");
    expect(freshness.textContent).toContain("No snapshot yet");
  });

  test("renders a stale portfolio card with attention badge and resync guidance", async () => {
    const api = createApi({
      fetchHealth: mock(async () => createStalePayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const badge = view.getByTestId("portfolio-badge");
    expect(badge.textContent).toContain("Needs attention");

    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain("stale");

    // Stale still has trend data
    const trend = view.getByTestId("portfolio-trend");
    expect(trend.textContent).toContain("MRR");
  });

  test("renders an error portfolio card with error message when health fetch fails", async () => {
    const api = createApi({
      fetchHealth: mock(async () => {
        throw new Error("Server error");
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const badge = view.getByTestId("portfolio-badge");
    expect(badge.textContent).toContain("Error");

    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain("Server error");

    // North-star display should show dash
    const northStar = view.getByTestId("portfolio-north-star");
    expect(northStar.textContent).toContain("—");

    // Freshness should reflect inability to load
    const freshness = view.getByTestId("portfolio-freshness");
    expect(freshness.textContent).toContain("Unable to load");

    // The health error banner and retry button should still be available
    expect(
      view.getByRole("button", { name: "Retry health load" })
    ).toBeTruthy();
  });

  test("renders a syncing portfolio card when first sync is pending", async () => {
    const api = createApi({
      fetchHealth: mock(async () => createSyncingPayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const badge = view.getByTestId("portfolio-badge");
    expect(badge.textContent).toContain("Syncing");

    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain("sync in progress");
  });

  test("shows loading portfolio card while health data is being fetched", async () => {
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

    // Should show loading state for portfolio card
    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Loading portfolio");

    // Resolve to let the test clean up
    resolveHealth?.(createHealthyPayload());
    await waitFor(() => {
      expect(view.getByTestId("portfolio-badge").textContent).toContain(
        "Healthy"
      );
    });
  });

  test("handles zero MRR with no previous snapshot — no trend, $0 display", async () => {
    const payload = createHealthyPayload();
    payload.health!.northStarValue = 0;
    payload.health!.northStarPreviousValue = null;

    const api = createApi({
      fetchHealth: mock(async () => payload),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const northStar = view.getByTestId("portfolio-north-star");
    expect(northStar.textContent).toContain("$0");

    expect(view.queryByTestId("portfolio-trend")).toBeNull();
  });

  test("handles malformed health payload as a recoverable portfolio-card error", async () => {
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

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const badge = view.getByTestId("portfolio-badge");
    expect(badge.textContent).toContain("Error");

    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain(
      "Health snapshot contains invalid data"
    );
  });

  test("does not render portfolio card when no startups exist", async () => {
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
      (
        await view.findAllByText(
          "No startups are attached to this workspace yet."
        )
      ).length
    ).toBeGreaterThanOrEqual(1);
    expect(view.queryByTestId("portfolio-startup-card")).toBeNull();
  });

  test("portfolio card shows connector sync error as top issue in error state", async () => {
    const payload: StartupHealthPayload = {
      health: null,
      connectors: [
        {
          provider: "stripe",
          status: "error",
          lastSyncAt: null,
          lastSyncError: "Stripe API key is invalid",
        },
      ],
      status: "error",
      blockedReasons: [],
      lastSnapshotAt: null,
      customMetric: null,
    };

    const api = createApi({
      fetchHealth: mock(async () => payload),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const card = await view.findByTestId("portfolio-startup-card");
    expect(card).toBeTruthy();

    const topIssue = view.getByTestId("portfolio-top-issue");
    expect(topIssue.textContent).toContain("Stripe API key is invalid");
  });

  test("existing health drill-down still renders below the portfolio card", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Portfolio card appears first
    await view.findByTestId("portfolio-startup-card");

    // Health hero and metrics grid still render
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
    expect(view.getByLabelText("supporting metrics")).toBeTruthy();
  });
});
