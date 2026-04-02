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
  fireEvent.input(element, { target: { value } });
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

function _createBlockedPayload(): StartupHealthPayload {
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

describe("dashboard shell route", () => {
  test("shows the mounted workspace and startup context after bootstrap", async () => {
    const api = createApi();
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(
      await view.findByRole("main", { name: "dashboard shell" })
    ).toBeTruthy();
    expect(
      view.getByRole("heading", { name: "Portfolio overview" })
    ).toBeTruthy();
    expect(
      (await view.findAllByText("Acme Analytics")).length
    ).toBeGreaterThanOrEqual(2);
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
      await view.findByRole("main", { name: "dashboard shell" })
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

    fireEvent.click(view.getByRole("button", { name: "Retry startup load" }));

    await waitFor(() => {
      expect(listStartups).toHaveBeenCalledTimes(2);
    });
    expect(
      (await view.findAllByText("Acme Analytics")).length
    ).toBeGreaterThanOrEqual(2);
  });

  test("shows a shell bootstrap failure loudly when workspace context cannot be parsed", async () => {
    const api = createApi({
      listWorkspaces: mock(async () => {
        throw new Error("The dashboard shell could not be bootstrapped.");
      }),
    });
    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot(null)} />
    );

    expect((await view.findByRole("alert")).textContent).toContain(
      "The dashboard shell could not be bootstrapped."
    );
    expect(
      view.getByRole("button", { name: "Retry shell bootstrap" })
    ).toBeTruthy();
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

    fireEvent.change(view.getByLabelText("Switch workspace"), {
      target: { value: WORKSPACE_B.id },
    });
    fireEvent.click(
      view.getByRole("button", { name: "Use selected workspace" })
    );

    await waitFor(() => {
      expect(setActiveWorkspace).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_B.id,
      });
    });
    expect(
      (await view.findAllByText("Beta Analytics")).length
    ).toBeGreaterThanOrEqual(2);
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

    expect(
      await view.findByRole("form", { name: "PostHog setup form" })
    ).toBeTruthy();
    expect(view.getByRole("form", { name: "Stripe setup form" })).toBeTruthy();
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
    await view.findByRole("form", { name: "Stripe setup form" });

    // Fill and submit the Stripe form
    setNativeInputValue(
      view.getByLabelText("Secret key") as HTMLInputElement,
      "sk_test_valid123"
    );
    fireEvent.submit(view.getByRole("form", { name: "Stripe setup form" }));

    await waitFor(() => {
      expect(createConnector).toHaveBeenCalled();
    });

    // Stripe setup form should disappear since connector now exists
    await waitFor(() => {
      expect(
        view.queryByRole("form", { name: "Stripe setup form" })
      ).toBeNull();
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

    const disconnectButton = await view.findByRole("button", {
      name: "Disconnect",
    });
    fireEvent.click(disconnectButton);

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

  test("shows zero-connectors message when no connectors exist", async () => {
    const api = createApi({
      listConnectors: mock(async () => ({ connectors: [] })),
    });

    const view = render(
      <DashboardPage api={api} authState={createAuthenticatedSnapshot()} />
    );

    expect(
      await view.findByText(
        "No connectors configured yet. Connect PostHog or Stripe to start syncing data."
      )
    ).toBeTruthy();
  });
});
