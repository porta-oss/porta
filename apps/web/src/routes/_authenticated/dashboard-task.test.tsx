import "../../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ConnectorProvider } from "@shared/connectors";
import type {
  InternalTaskPayload,
  TaskSyncStatus,
} from "@shared/internal-task";
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

function createTask(
  overrides: Partial<InternalTaskPayload> = {}
): InternalTaskPayload {
  return {
    id: "task_001",
    startupId: `${WORKSPACE_A.id}_Acme Analytics`,
    sourceInsightId: "insight_001",
    sourceActionIndex: 0,
    title: "Review churn cohorts",
    description: "Identify which customer segment is leaving.",
    linkedMetricKeys: ["mrr"],
    syncStatus: "not_synced",
    linearIssueId: null,
    lastSyncError: null,
    lastSyncAttemptAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
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
      mock(async () => ({
        tasks: [],
        startupId: `${WORKSPACE_A.id}_Acme Analytics`,
        count: 0,
      })),
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
  };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Task creation from insight actions
// ---------------------------------------------------------------------------

describe("task creation from insight actions", () => {
  test("each insight action shows a create-task button when no task exists", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("action-0-create-task")).toBeTruthy();
    expect(view.getByTestId("action-1-create-task")).toBeTruthy();
  });

  test("clicking create-task calls createTask API and shows created state", async () => {
    const newTask = createTask({ syncStatus: "not_synced" });
    const createTaskMock = mock(async () => ({ task: newTask, created: true }));
    const api = createApi({ createTask: createTaskMock });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const btn = await view.findByTestId("action-0-create-task");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledTimes(1);
    });

    expect(await view.findByTestId("action-0-task-created")).toBeTruthy();
  });

  test('already-created task shows "Task created" badge instead of create button on reload', async () => {
    const existingTask = createTask({ sourceActionIndex: 0 });
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [existingTask],
        startupId: existingTask.startupId,
        count: 1,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("action-0-task-created")).toBeTruthy();
    expect(view.queryByTestId("action-0-create-task")).toBeNull();
    // Second action should still have create button
    expect(view.getByTestId("action-1-create-task")).toBeTruthy();
  });

  test("create-task button is disabled while creating", async () => {
    let resolveCreate:
      | ((v: { task: InternalTaskPayload; created: boolean }) => void)
      | undefined;
    const createPromise = new Promise<{
      task: InternalTaskPayload;
      created: boolean;
    }>((resolve) => {
      resolveCreate = resolve;
    });
    const createTaskMock = mock(async () => createPromise);
    const api = createApi({ createTask: createTaskMock });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const btn = await view.findByTestId("action-0-create-task");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(view.getByTestId("action-0-create-task").textContent).toContain(
        "Creating"
      );
    });

    // Resolve
    resolveCreate?.({ task: createTask(), created: true });
    await waitFor(() => {
      expect(view.queryByTestId("action-0-create-task")).toBeNull();
    });
  });

  test("create-task failure shows localized error without hiding dashboard", async () => {
    const createTaskMock = mock(async () => {
      throw new Error("Network error");
    });
    const api = createApi({ createTask: createTaskMock });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    const btn = await view.findByTestId("action-0-create-task");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(view.getByTestId("task-create-error")).toBeTruthy();
    });

    expect(
      view.getByRole("tab", { name: /Health & connectors/i })
    ).toBeTruthy();
    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Task list display
// ---------------------------------------------------------------------------

describe("task list display", () => {
  test("shows task list with pending sync status", async () => {
    const task = createTask({ syncStatus: "not_synced" });
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [task],
        startupId: task.startupId,
        count: 1,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-task-list")).toBeTruthy();
    expect(view.getByTestId("task-row")).toBeTruthy();
    expect(view.getByTestId("task-sync-status").textContent).toContain(
      "Pending"
    );
  });

  test("shows synced task with Linear reference", async () => {
    const task = createTask({
      syncStatus: "synced",
      linearIssueId: "LIN-123",
    });
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [task],
        startupId: task.startupId,
        count: 1,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("task-sync-status")).toBeTruthy();
    expect(view.getByTestId("task-sync-status").textContent).toContain(
      "Synced"
    );
    expect(view.getByTestId("task-linear-id")).toBeTruthy();
    expect(view.getByTestId("task-linear-id").textContent).toContain("LIN-123");
  });

  test("shows failed task with sync error message", async () => {
    const task = createTask({
      syncStatus: "failed",
      lastSyncError: "Linear API: rate limited",
    });
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [task],
        startupId: task.startupId,
        count: 1,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("task-sync-status")).toBeTruthy();
    expect(view.getByTestId("task-sync-status").textContent).toContain(
      "Failed"
    );
    expect(view.getByTestId("task-sync-error")).toBeTruthy();
    expect(view.getByTestId("task-sync-error").textContent).toContain(
      "Linear API: rate limited"
    );
  });

  test("shows multiple tasks with different sync states side by side", async () => {
    const tasks = [
      createTask({ id: "t1", sourceActionIndex: 0, syncStatus: "not_synced" }),
      createTask({
        id: "t2",
        sourceActionIndex: 1,
        syncStatus: "synced",
        linearIssueId: "LIN-456",
      }),
    ];
    const api = createApi({
      listTasks: mock(async () => ({
        tasks,
        startupId: tasks[0]?.startupId,
        count: 2,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-task-list")).toBeTruthy();
    const rows = view.getAllByTestId("task-row");
    expect(rows).toHaveLength(2);
  });

  test('shows "no tasks" message when task list is empty', async () => {
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [],
        startupId: `${WORKSPACE_A.id}_Acme Analytics`,
        count: 0,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-task-list")).toBeTruthy();
    expect(view.getByTestId("no-tasks")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Task list error handling
// ---------------------------------------------------------------------------

describe("task list error handling", () => {
  test("task list error shows inline retry without hiding health/insight", async () => {
    const api = createApi({
      listTasks: mock(async () => {
        throw new Error("Task fetch failed");
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-task-list")).toBeTruthy();
    expect(view.getByText("Task fetch failed")).toBeTruthy();
    expect(view.getByRole("button", { name: "Retry task load" })).toBeTruthy();

    expect(
      view.getByRole("tab", { name: /Health & connectors/i })
    ).toBeTruthy();
    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
  });

  test("task list retry loads tasks successfully after error", async () => {
    let attempt = 0;
    const listTasks = mock(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Transient failure");
      }
      return {
        tasks: [createTask()],
        startupId: `${WORKSPACE_A.id}_Acme Analytics`,
        count: 1,
      };
    });
    const api = createApi({ listTasks });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByText("Transient failure")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Retry task load" }));

    await waitFor(() => {
      expect(listTasks).toHaveBeenCalledTimes(2);
    });
    expect(await view.findByTestId("task-row")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Sync status badge rendering
// ---------------------------------------------------------------------------

describe("sync status badges", () => {
  test.each([
    ["not_synced", "Pending"],
    ["queued", "Queued"],
    ["synced", "Synced"],
    ["failed", "Failed"],
  ] as const)('renders %s sync status as "%s"', async (syncStatus, expectedLabel) => {
    const task = createTask({ syncStatus: syncStatus as TaskSyncStatus });
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [task],
        startupId: task.startupId,
        count: 1,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("task-sync-status")).toBeTruthy();
    expect(view.getByTestId("task-sync-status").textContent).toContain(
      expectedLabel
    );

    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Task does not hide other dashboard sections
// ---------------------------------------------------------------------------

describe("dashboard section isolation", () => {
  test("task panel does not collapse portfolio, health, insight, or connector panels", async () => {
    const task = createTask({
      syncStatus: "failed",
      lastSyncError: "Linear rate limited",
    });
    const api = createApi({
      listTasks: mock(async () => ({
        tasks: [task],
        startupId: task.startupId,
        count: 1,
      })),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(await view.findByTestId("startup-task-list")).toBeTruthy();
    expect(view.getByTestId("startup-insight-card")).toBeTruthy();
    expect(view.getByLabelText("portfolio startup card")).toBeTruthy();
    expect(
      view.getByRole("tab", { name: /Health & connectors/i })
    ).toBeTruthy();

    await openHealthConnectorsTab(view);
    expect(await view.findByLabelText("startup health hero")).toBeTruthy();
  });
});
