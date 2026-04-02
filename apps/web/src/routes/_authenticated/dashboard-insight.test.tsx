import "../../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ConnectorProvider } from "@shared/connectors";
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import type { AuthSnapshot } from "../../lib/auth-client";
import {
  type DashboardApi,
  DashboardPage,
  type StartupHealthPayload,
  type StartupInsightPayload,
} from "./dashboard";

async function openHealthConnectorsTab(view: ReturnType<typeof render>) {
  fireEvent.click(
    await view.findByRole("tab", { name: /Health & connectors/i })
  );
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

function createReadyInsightPayload(): StartupInsightPayload {
  return {
    insight: {
      startupId: `${WORKSPACE_A.id}_Acme Analytics`,
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items: [
          {
            metricKey: "mrr",
            label: "Monthly Recurring Revenue",
            currentValue: 9500,
            previousValue: 11_000,
            direction: "down",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: "job-abc",
      },
      explanation: {
        observation:
          "MRR declined from $11,000 to $9,500 over the last 30 days.",
        hypothesis:
          "Increased churn among mid-tier accounts suggests pricing friction.",
        actions: [
          {
            label: "Review churn cohorts",
            rationale: "Identify which customer segment is leaving.",
          },
          {
            label: "Run pricing experiment",
            rationale: "Test alternative pricing tiers.",
          },
        ],
        model: "claude-sonnet-4-20250514",
        latencyMs: 1200,
      },
      generationStatus: "success",
      generatedAt: new Date().toISOString(),
      lastError: null,
    },
    displayStatus: "ready",
    diagnosticMessage: null,
  };
}

function createUnavailableInsightPayload(): StartupInsightPayload {
  return {
    insight: null,
    displayStatus: "unavailable",
    diagnosticMessage: "No insight has been generated for this startup yet.",
  };
}

function createBlockedInsightPayload(): StartupInsightPayload {
  return {
    insight: {
      startupId: `${WORKSPACE_A.id}_Acme Analytics`,
      conditionCode: "no_condition_detected",
      evidence: {
        conditionCode: "no_condition_detected",
        items: [],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: null,
      },
      explanation: null,
      generationStatus: "skipped_blocked",
      generatedAt: new Date().toISOString(),
      lastError: null,
    },
    displayStatus: "blocked",
    diagnosticMessage:
      "Insight generation was blocked because connectors are not healthy.",
  };
}

function createErrorInsightPayload(): StartupInsightPayload {
  return {
    insight: {
      startupId: `${WORKSPACE_A.id}_Acme Analytics`,
      conditionCode: "churn_spike",
      evidence: {
        conditionCode: "churn_spike",
        items: [
          {
            metricKey: "churn_rate",
            label: "Churn Rate",
            currentValue: 8.5,
            previousValue: 2.1,
            direction: "up",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: null,
      },
      explanation: null,
      generationStatus: "failed_explainer",
      generatedAt: new Date().toISOString(),
      lastError: "Anthropic API rate limited",
    },
    displayStatus: "error",
    diagnosticMessage: "Anthropic API rate limited",
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
        connector: {
          id: `connector_${provider}`,
          startupId: `${WORKSPACE_A.id}_Acme Analytics`,
          provider,
          status: "pending" as const,
          lastSyncAt: null,
          lastSyncDurationMs: null,
          lastSyncError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
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
      overrides.fetchInsight ?? mock(async () => createReadyInsightPayload()),
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
// Insight card tests
// ---------------------------------------------------------------------------

describe("startup insight card", () => {
  test("renders insight card with observation, hypothesis, and actions when ready", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Wait for the insight card to appear
    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    expect(view.getByTestId("insight-condition").textContent).toContain(
      "MRR Declining"
    );
    expect(view.getByTestId("insight-actions")).toBeTruthy();

    // Expand evidence disclosure to check observation and hypothesis
    fireEvent.click(view.getByRole("button", { name: /evidence/i }));
    expect(view.getByTestId("insight-observation")).toBeTruthy();
    expect(view.getByTestId("insight-hypothesis")).toBeTruthy();

    expect(view.getByTestId("insight-observation").textContent).toContain(
      "MRR declined"
    );
    expect(view.getByTestId("insight-hypothesis").textContent).toContain(
      "pricing friction"
    );
  });

  test("renders evidence bullets with metric values", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    // Expand evidence disclosure
    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /evidence/i }));
    expect(view.getByTestId("insight-evidence")).toBeTruthy();
    expect(view.getByTestId("insight-evidence").textContent).toContain(
      "Monthly Recurring Revenue"
    );
    expect(view.getByTestId("insight-evidence").textContent).toContain("9,500");
  });

  test("renders 1–3 actions with labels and rationales", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("insight-actions")).toBeTruthy();
    const actionsEl = view.getByTestId("insight-actions");
    expect(actionsEl.textContent).toContain("Review churn cohorts");
    expect(actionsEl.textContent).toContain("Run pricing experiment");
  });

  test("shows unavailable state when no insight has been generated", async () => {
    const api = createApi({
      fetchInsight: mock(async () => createUnavailableInsightPayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    expect(view.getByTestId("insight-unavailable")).toBeTruthy();
    expect(view.getByTestId("insight-unavailable").textContent).toContain(
      "No insight"
    );
  });

  test("shows blocked state with diagnostic when generation is blocked", async () => {
    const api = createApi({
      fetchInsight: mock(async () => createBlockedInsightPayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    expect(view.getByTestId("insight-blocked")).toBeTruthy();
    expect(view.getByTestId("insight-blocked").textContent).toContain(
      "blocked"
    );
  });

  test("shows error state when generation failed", async () => {
    const api = createApi({
      fetchInsight: mock(async () => createErrorInsightPayload()),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    expect(view.getByTestId("insight-error")).toBeTruthy();
    expect(view.getByTestId("insight-error").textContent).toContain(
      "Anthropic API rate limited"
    );
  });

  test("insight card does not hide portfolio or health sections", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    expect(
      view.getByRole("tab", { name: /Health & connectors/i })
    ).toBeTruthy();

    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
  });

  test("insight fetch error shows inline error without hiding health data", async () => {
    const api = createApi({
      fetchInsight: mock(async () => {
        throw new Error("Network timeout");
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("insight error")).toBeTruthy();
    expect(view.getByText("Network timeout")).toBeTruthy();

    expect(
      view.getByRole("button", { name: "Retry insight load" })
    ).toBeTruthy();

    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
  });

  test("shows loading state before insight data arrives", async () => {
    let resolveInsight: ((value: StartupInsightPayload) => void) | undefined;
    const insightPromise = new Promise<StartupInsightPayload>((resolve) => {
      resolveInsight = resolve;
    });

    const api = createApi({
      fetchInsight: mock(async () => insightPromise),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("startup insight")).toBeTruthy();

    // Resolve to let the test clean up
    resolveInsight?.(createReadyInsightPayload());
    await waitFor(() => {
      expect(view.queryByTestId("startup-insight-card")).toBeTruthy();
    });
  });

  test("retries insight load when retry button is clicked after error", async () => {
    let attempt = 0;
    const fetchInsight = mock(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Transient failure");
      }
      return createReadyInsightPayload();
    });

    const api = createApi({ fetchInsight });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByLabelText("insight error")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Retry insight load" }));

    await waitFor(() => {
      expect(fetchInsight).toHaveBeenCalledTimes(2);
    });
    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
  });

  test("preserve-last-good: shows stale insight with diagnostic after failed regeneration", async () => {
    const stalePayload: StartupInsightPayload = {
      ...createReadyInsightPayload(),
      diagnosticMessage:
        "Last generation attempt failed (Transient API error), but the previous insight is still shown.",
    };

    const api = createApi({
      fetchInsight: mock(async () => stalePayload),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-insight-card")).toBeTruthy();
    expect(view.getByTestId("insight-diagnostic")).toBeTruthy();
    expect(view.getByTestId("insight-diagnostic").textContent).toContain(
      "failed"
    );
    // Expand evidence to verify the stale insight content is preserved
    fireEvent.click(view.getByRole("button", { name: /evidence/i }));
    expect(view.getByTestId("insight-observation")).toBeTruthy();
  });
});
