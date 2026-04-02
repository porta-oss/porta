import { expect, test } from "@playwright/test";

/**
 * Lightweight e2e spec for the insight → task → Linear sync UI flow.
 *
 * This spec exercises the dashboard components in the browser by mocking
 * API responses. It verifies that:
 * 1. Insight actions show create-task buttons.
 * 2. Clicking create-task renders the "Task created" state.
 * 3. The task list panel shows sync status badges.
 * 4. Health, connector, and insight sections remain visible throughout.
 */

const MOCK_WORKSPACE = {
  workspaces: [{ id: "ws_1", name: "E2E Workspace", slug: "e2e-ws" }],
  activeWorkspaceId: "ws_1",
};

const MOCK_STARTUPS = {
  workspace: MOCK_WORKSPACE.workspaces[0],
  startups: [
    {
      id: "startup_1",
      workspaceId: "ws_1",
      name: "E2E Startup",
      type: "b2b_saas",
      stage: "mvp",
      timezone: "UTC",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const MOCK_HEALTH = {
  health: {
    startupId: "startup_1",
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
  ],
  status: "ready",
  blockedReasons: [],
  lastSnapshotAt: new Date().toISOString(),
};

const MOCK_INSIGHT = {
  insight: {
    startupId: "startup_1",
    conditionCode: "mrr_declining",
    evidence: {
      conditionCode: "mrr_declining",
      items: [
        {
          metricKey: "mrr",
          label: "MRR",
          currentValue: 9500,
          previousValue: 11_000,
          direction: "down",
        },
      ],
      snapshotComputedAt: new Date().toISOString(),
      syncJobId: "job-abc",
    },
    explanation: {
      observation: "MRR declined over the last 30 days.",
      hypothesis: "Churn among mid-tier accounts suggests pricing friction.",
      actions: [
        {
          label: "Review churn cohorts",
          rationale: "Identify leaving segments.",
        },
        {
          label: "Run pricing experiment",
          rationale: "Test alternative tiers.",
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

const MOCK_TASK = {
  id: "task_e2e_1",
  startupId: "startup_1",
  sourceInsightId: "insight_e2e_1",
  sourceActionIndex: 0,
  title: "Review churn cohorts",
  description: "Identify leaving segments.",
  linkedMetricKeys: ["mrr"],
  syncStatus: "not_synced",
  linearIssueId: null,
  lastSyncError: null,
  lastSyncAttemptAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

test.describe("insight → task → Linear sync flow", () => {
  test("founder creates a task from an insight action and sees sync state", async ({
    page,
  }) => {
    // Mock all API endpoints
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_WORKSPACE),
      })
    );
    await page.route("**/api/startups", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_STARTUPS),
      })
    );
    await page.route("**/api/connectors**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connectors: [] }),
      })
    );
    await page.route("**/api/startups/*/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_HEALTH),
      })
    );
    await page.route("**/api/startups/*/insight", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_INSIGHT),
      })
    );

    // Initially empty task list
    const taskList = { tasks: [], startupId: "startup_1", count: 0 };
    await page.route("**/api/tasks?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskList),
      })
    );

    // Create task returns the new task
    await page.route("**/api/tasks", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ task: MOCK_TASK, created: true }),
        });
      }
      return route.continue();
    });

    // Navigate to dashboard
    await page.goto("/app");

    // Wait for insight card to appear
    await expect(page.getByTestId("startup-insight-card")).toBeVisible({
      timeout: 10_000,
    });

    // Verify create-task buttons exist for both actions
    await expect(page.getByTestId("action-0-create-task")).toBeVisible();
    await expect(page.getByTestId("action-1-create-task")).toBeVisible();

    // Health and connector sections should be visible
    await expect(page.getByLabel("startup health hero")).toBeVisible();
    await page.getByRole("tab", { name: /Operations/ }).click();
    await expect(page.getByLabel("connector status")).toBeVisible();

    // Click "Create task" on the first action
    await page.getByTestId("action-0-create-task").click();

    // Verify "Task created" badge appears
    await expect(page.getByTestId("action-0-task-created")).toBeVisible({
      timeout: 5000,
    });

    // Verify sync status badge is shown
    await expect(page.getByTestId("task-sync-badge").first()).toBeVisible();

    // Health, connector, and insight sections should still be visible
    await expect(page.getByLabel("startup health hero")).toBeVisible();
    await page.getByRole("tab", { name: /Operations/ }).click();
    await expect(page.getByLabel("connector status")).toBeVisible();
    await expect(page.getByTestId("startup-insight-card")).toBeVisible();
  });
});
