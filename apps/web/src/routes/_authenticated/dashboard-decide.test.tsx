import "../../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AlertSummary } from "@shared/alert-rule";
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import { cleanup, render, waitFor } from "@testing-library/react";

import type { AuthSnapshot } from "../../lib/auth-client";
import {
  type DashboardApi,
  DashboardPage,
  type StartupHealthPayload,
} from "./dashboard";

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

function createAlert(overrides: Partial<AlertSummary> = {}): AlertSummary {
  return {
    id: "alert_1",
    startupId: `${WORKSPACE_A.id}_Acme Analytics`,
    ruleId: "rule_1",
    metricKey: "churn_rate",
    severity: "high",
    status: "active",
    threshold: 5,
    value: 8.2,
    firedAt: new Date("2026-04-05T10:00:00.000Z").toISOString(),
    lastFiredAt: new Date("2026-04-05T10:00:00.000Z").toISOString(),
    occurrenceCount: 1,
    resolvedAt: null,
    snoozedUntil: null,
    ...overrides,
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
      overrides.listConnectors ??
      mock(async () => ({
        connectors: [createConnector("posthog"), createConnector("stripe")],
      })),
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
  };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Decide mode tests
// ---------------------------------------------------------------------------

describe("decide mode", () => {
  test("renders zero-alert state when no active alerts", async () => {
    const api = createApi({
      listAlerts: mock(async () => ({ alerts: [] })),
    });
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    await waitFor(() => {
      expect(view.getByText("All clear")).toBeTruthy();
    });
  });

  test("renders top priority alert in decision surface", async () => {
    const highAlert = createAlert({
      id: "alert_high",
      severity: "high",
      metricKey: "daily_signups",
      value: 8.2,
      threshold: 5,
    });

    const api = createApi({
      listAlerts: mock(async () => ({ alerts: [highAlert] })),
    });
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    await waitFor(() => {
      expect(view.getByText("Daily Signups")).toBeTruthy();
    });
    expect(view.getByText("8.2")).toBeTruthy();
    expect(view.getByText(/threshold: 5/)).toBeTruthy();
  });

  test("sorts alerts by severity then firedAt and shows the top one", async () => {
    const mediumAlert = createAlert({
      id: "alert_medium",
      severity: "medium",
      metricKey: "error_rate",
      value: 3,
      threshold: 1,
      firedAt: new Date("2026-04-05T12:00:00.000Z").toISOString(),
      lastFiredAt: new Date("2026-04-05T12:00:00.000Z").toISOString(),
    });
    const criticalAlert = createAlert({
      id: "alert_critical",
      severity: "critical",
      metricKey: "mrr",
      value: 500,
      threshold: 1000,
      firedAt: new Date("2026-04-05T08:00:00.000Z").toISOString(),
      lastFiredAt: new Date("2026-04-05T08:00:00.000Z").toISOString(),
    });

    const api = createApi({
      listAlerts: mock(async () => ({
        alerts: [mediumAlert, criticalAlert],
      })),
    });
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    // Critical alert should be shown (top priority)
    await waitFor(() => {
      expect(view.getByText("Critical")).toBeTruthy();
    });
    expect(view.getByText("Mrr")).toBeTruthy();
  });

  test("renders supporting metrics grid when health data is available", async () => {
    const api = createApi({
      listAlerts: mock(async () => ({ alerts: [] })),
      fetchHealth: mock(async () => createHealthyPayload()),
    });
    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    await waitFor(() => {
      expect(
        view.getByRole("region", { name: /supporting metrics/i })
      ).toBeTruthy();
    });
  });

  test("calls listAlerts with status=active on mount", async () => {
    const listAlertsMock = mock(async () => ({ alerts: [] }));
    const api = createApi({ listAlerts: listAlertsMock });

    render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    await waitFor(() => {
      expect(listAlertsMock).toHaveBeenCalledWith(
        expect.stringContaining("workspace_a"),
        "active"
      );
    });
  });

  test("shows loading skeleton while alerts are being fetched", async () => {
    const deferred: {
      resolve: ((value: { alerts: AlertSummary[] }) => void) | null;
    } = { resolve: null };
    const alertsPromise = new Promise<{ alerts: AlertSummary[] }>((resolve) => {
      deferred.resolve = resolve;
    });

    const api = createApi({
      listAlerts: mock(() => alertsPromise),
    });

    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    await waitFor(() => {
      expect(view.getByLabelText("Loading alerts")).toBeTruthy();
    });

    deferred.resolve?.({ alerts: [] });

    await waitFor(() => {
      expect(view.getByText("All clear")).toBeTruthy();
    });
  });

  test("shows error state when alert fetch fails", async () => {
    const api = createApi({
      listAlerts: mock(async () => {
        throw new Error("Network error");
      }),
    });

    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    await waitFor(() => {
      expect(view.getByText("Failed to load alerts")).toBeTruthy();
    });
  });

  test("calls triageAlert on ack and refreshes alerts", async () => {
    const highAlert = createAlert({ id: "alert_ack_test" });
    let callCount = 0;
    const listAlertsMock = mock(async () => {
      callCount++;
      // First call returns the alert, after triage it's gone
      if (callCount <= 1) {
        return { alerts: [highAlert] };
      }
      return { alerts: [] };
    });
    const triageMock = mock(async () => ({
      alert: { ...highAlert, status: "acknowledged" as const },
    }));

    const api = createApi({
      listAlerts: listAlertsMock,
      triageAlert: triageMock,
    });

    const view = render(
      <DashboardPage
        api={api}
        authState={createAuthenticatedSnapshot()}
        mode="decide"
      />
    );

    // Wait for alert to appear
    const ackButton = await view.findByRole("button", { name: /ack/i });
    ackButton.click();

    await waitFor(() => {
      expect(triageMock).toHaveBeenCalledWith("alert_ack_test", "ack");
    });

    // After triage, alerts should refresh and show zero state
    await waitFor(() => {
      expect(view.getByText("All clear")).toBeTruthy();
    });
  });
});
