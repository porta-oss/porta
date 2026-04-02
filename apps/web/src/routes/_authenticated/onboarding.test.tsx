import "../../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import type {
  StartupDraft,
  StartupRecord,
  WorkspaceSummary,
} from "@shared/types";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { type OnboardingApi, OnboardingPage } from "./onboarding";

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
    id: "startup_1",
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
    startupId: "startup_1",
    provider,
    status,
    lastSyncAt: status === "connected" ? "2026-01-01T12:00:00.000Z" : null,
    lastSyncDurationMs: status === "connected" ? 1200 : null,
    lastSyncError: status === "error" ? "Provider validation failed" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createApi(overrides: Partial<OnboardingApi> = {}): OnboardingApi {
  return {
    listWorkspaces:
      overrides.listWorkspaces ??
      mock(async () => ({ workspaces: [], activeWorkspaceId: null })),
    createWorkspace:
      overrides.createWorkspace ??
      mock(async ({ name }: { name: string }) => ({
        workspace: {
          id: "workspace_created",
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        },
        activeWorkspaceId: "workspace_created",
      })),
    setActiveWorkspace:
      overrides.setActiveWorkspace ??
      mock(async ({ workspaceId }: { workspaceId: string }) => ({
        workspace: workspaceId === WORKSPACE_B.id ? WORKSPACE_B : WORKSPACE_A,
        activeWorkspaceId: workspaceId,
      })),
    listStartups:
      overrides.listStartups ??
      mock(async () => ({ workspace: WORKSPACE_A, startups: [] })),
    createStartup:
      overrides.createStartup ??
      mock(async (input: StartupDraft) => ({
        workspace: WORKSPACE_A,
        startup: createStartup(WORKSPACE_A.id, input.name),
        startups: [createStartup(WORKSPACE_A.id, input.name)],
      })),
    listConnectors:
      overrides.listConnectors ?? mock(async () => ({ connectors: [] })),
    createConnector:
      overrides.createConnector ??
      mock(async (_startupId: string, provider: ConnectorProvider) => ({
        connector: createConnector(provider, "pending"),
      })),
  };
}

afterEach(() => {
  cleanup();
});

describe("startup onboarding route", () => {
  test("keeps startup creation locked until a workspace exists for the signed-in founder", async () => {
    const api = createApi();
    const view = render(<OnboardingPage api={api} />);

    expect(
      await view.findByText(
        "No active workspace yet. Create one or select an existing workspace to continue."
      )
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: /startup/i }).hasAttribute("disabled")
    ).toBe(true);
  });

  test("creates a workspace, then creates the first startup and shows connector setup", async () => {
    let bootstrapStep = 0;
    const listWorkspaces = mock(async () => {
      bootstrapStep += 1;

      if (bootstrapStep === 1) {
        return { workspaces: [], activeWorkspaceId: null };
      }

      return { workspaces: [WORKSPACE_A], activeWorkspaceId: WORKSPACE_A.id };
    });
    let listStartupsCall = 0;
    const listStartups = mock(async () => {
      listStartupsCall += 1;
      if (listStartupsCall <= 1) {
        return { workspace: WORKSPACE_A, startups: [] };
      }
      return { workspace: WORKSPACE_A, startups: [createStartup()] };
    });
    const createWorkspace = mock(async () => ({
      workspace: WORKSPACE_A,
      activeWorkspaceId: WORKSPACE_A.id,
    }));
    const createStartupCall = mock(async (input: StartupDraft) => ({
      workspace: WORKSPACE_A,
      startup: createStartup(WORKSPACE_A.id, input.name),
      startups: [createStartup(WORKSPACE_A.id, input.name)],
    }));
    const navigateTo = mock(() => {
      /* noop */
    });
    const api = createApi({
      listWorkspaces,
      listStartups,
      createWorkspace,
      createStartup: createStartupCall,
    });

    const view = render(<OnboardingPage api={api} navigateTo={navigateTo} />);

    await view.findByText(
      "No active workspace yet. Create one or select an existing workspace to continue."
    );

    setNativeInputValue(
      view.getByLabelText("Workspace name") as HTMLInputElement,
      "Acme Ventures"
    );
    fireEvent.submit(view.getByRole("form", { name: "workspace create form" }));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith({ name: "Acme Ventures" });
    });
    expect(
      await view.findByText(
        "The first startup will be created inside Acme Ventures."
      )
    ).toBeTruthy();

    setNativeInputValue(
      view.getByLabelText("Startup name") as HTMLInputElement,
      "Acme Analytics"
    );
    fireEvent.submit(view.getByRole("form", { name: "startup form" }));

    await waitFor(() => {
      expect(createStartupCall).toHaveBeenCalledWith({
        name: "Acme Analytics",
        type: "b2b_saas",
        stage: "mvp",
        timezone: "UTC",
        currency: "USD",
      });
    });

    // After startup creation, connector step should appear
    expect(await view.findByText(/Connect data sources/)).toBeTruthy();
  });

  test("keeps validation errors visible when the founder submits an empty startup name", async () => {
    const createStartupCall = mock(async () => ({
      workspace: WORKSPACE_A,
      startup: createStartup(),
      startups: [createStartup()],
    }));
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [],
      })),
      createStartup: createStartupCall,
    });

    const view = render(<OnboardingPage api={api} />);

    expect(
      await view.findByText(
        "The first startup will be created inside Acme Ventures."
      )
    ).toBeTruthy();

    fireEvent.submit(view.getByRole("form", { name: "startup form" }));

    expect((await view.findByRole("alert")).textContent).toContain(
      "Startup name cannot be blank."
    );
    expect(createStartupCall).not.toHaveBeenCalled();
  });

  test("surfaces missing-workspace and malformed-response failures without clearing the entered startup draft", async () => {
    const createStartupCall = mock(async () => {
      throw new Error(
        "Create or select a workspace before continuing startup onboarding."
      );
    });
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A, WORKSPACE_B],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [],
      })),
      createStartup: createStartupCall,
    });

    const view = render(<OnboardingPage api={api} />);

    await view.findByText(
      "The first startup will be created inside Acme Ventures."
    );

    setNativeInputValue(
      view.getByLabelText("Startup name") as HTMLInputElement,
      "Retryable Startup"
    );
    fireEvent.submit(view.getByRole("form", { name: "startup form" }));

    expect((await view.findByRole("alert")).textContent).toContain(
      "Create or select a workspace before continuing startup onboarding."
    );
    expect(
      (view.getByLabelText("Startup name") as HTMLInputElement).value
    ).toBe("Retryable Startup");
  });

  test("lets the founder select an existing workspace when the session has no active workspace yet", async () => {
    const setActiveWorkspace = mock(
      async ({ workspaceId }: { workspaceId: string }) => ({
        workspace: WORKSPACE_B,
        activeWorkspaceId: workspaceId,
      })
    );
    let bootstrapStep = 0;
    const listWorkspaces = mock(async () => {
      bootstrapStep += 1;

      if (bootstrapStep === 1) {
        return {
          workspaces: [WORKSPACE_A, WORKSPACE_B],
          activeWorkspaceId: null,
        };
      }

      return {
        workspaces: [WORKSPACE_A, WORKSPACE_B],
        activeWorkspaceId: WORKSPACE_B.id,
      };
    });
    const api = createApi({
      listWorkspaces,
      setActiveWorkspace,
      listStartups: mock(async () => ({
        workspace: WORKSPACE_B,
        startups: [],
      })),
    });

    const view = render(<OnboardingPage api={api} />);

    await view.findByText(
      "No active workspace yet. Create one or select an existing workspace to continue."
    );

    fireEvent.change(view.getByLabelText("Existing workspaces"), {
      target: { value: WORKSPACE_B.id },
    });
    fireEvent.submit(view.getByRole("form", { name: "workspace select form" }));

    await waitFor(() => {
      expect(setActiveWorkspace).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_B.id,
      });
    });
    expect(
      await view.findByText(
        "The first startup will be created inside Beta Ventures."
      )
    ).toBeTruthy();
  });

  // ---------------------------------------------------------------
  // Connector setup tests
  // ---------------------------------------------------------------

  test("shows PostHog and Stripe setup cards after startup creation", async () => {
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
      listConnectors: mock(async () => ({ connectors: [] })),
    });

    const view = render(<OnboardingPage api={api} />);

    expect(
      await view.findByRole("form", { name: "PostHog setup form" })
    ).toBeTruthy();
    expect(view.getByRole("form", { name: "Stripe setup form" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Connect PostHog" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Connect Stripe" })).toBeTruthy();
  });

  test("allows skipping connectors and shows the continue button", async () => {
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
      listConnectors: mock(async () => ({ connectors: [] })),
    });

    const navigateTo = mock(() => {
      /* noop */
    });
    const view = render(<OnboardingPage api={api} navigateTo={navigateTo} />);

    await view.findByRole("form", { name: "PostHog setup form" });

    // Skip PostHog (first skip button belongs to PostHog card)
    const skipButtons = view.getAllByRole("button", { name: "Skip for now" });
    fireEvent.click(skipButtons[0]!);

    // PostHog form should be gone but Stripe should remain
    await waitFor(() => {
      expect(
        view.queryByRole("form", { name: "PostHog setup form" })
      ).toBeNull();
    });
    expect(view.getByRole("form", { name: "Stripe setup form" })).toBeTruthy();

    // Skip Stripe (now only one skip button remains)
    const remainingSkipButtons = view.getAllByRole("button", {
      name: "Skip for now",
    });
    fireEvent.click(remainingSkipButtons[0]!);

    // Both skipped — continue button should appear
    expect(
      await view.findByRole("button", { name: "Continue to dashboard" })
    ).toBeTruthy();

    fireEvent.click(
      view.getByRole("button", { name: "Continue to dashboard" })
    );
    expect(navigateTo).toHaveBeenCalledWith("/app");
  });

  test("validates blank PostHog fields before submitting", async () => {
    const createConnectorCall = mock(
      async (_startupId: string, provider: ConnectorProvider) => ({
        connector: createConnector(provider, "pending"),
      })
    );
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
      listConnectors: mock(async () => ({ connectors: [] })),
      createConnector: createConnectorCall,
    });

    const view = render(<OnboardingPage api={api} />);
    await view.findByRole("form", { name: "PostHog setup form" });

    // Submit with empty fields
    fireEvent.submit(view.getByRole("form", { name: "PostHog setup form" }));

    const alerts = await view.findAllByRole("alert");
    const posthogAlert = alerts.find((a) =>
      a.textContent?.includes("PostHog API key")
    );
    expect(posthogAlert).toBeTruthy();
    expect(createConnectorCall).not.toHaveBeenCalled();
  });

  test("validates blank Stripe key before submitting", async () => {
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
      listConnectors: mock(async () => ({ connectors: [] })),
    });

    const view = render(<OnboardingPage api={api} />);
    await view.findByRole("form", { name: "Stripe setup form" });

    fireEvent.submit(view.getByRole("form", { name: "Stripe setup form" }));

    const alerts = await view.findAllByRole("alert");
    const stripeAlert = alerts.find((a) =>
      a.textContent?.includes("Stripe secret key")
    );
    expect(stripeAlert).toBeTruthy();
  });

  test("shows connector validation failure from the API without losing form state", async () => {
    const createConnector = mock(async () => {
      throw new Error("Provider credential validation failed.");
    });
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
      listConnectors: mock(async () => ({ connectors: [] })),
      createConnector,
    });

    const view = render(<OnboardingPage api={api} />);
    await view.findByRole("form", { name: "PostHog setup form" });

    setNativeInputValue(
      view.getByLabelText("API key") as HTMLInputElement,
      "phc_bad"
    );
    setNativeInputValue(
      view.getByLabelText("Project ID") as HTMLInputElement,
      "999"
    );

    fireEvent.submit(view.getByRole("form", { name: "PostHog setup form" }));

    const alerts = await view.findAllByRole("alert");
    const failureAlert = alerts.find((a) =>
      a.textContent?.includes("Provider credential validation failed")
    );
    expect(failureAlert).toBeTruthy();

    // Form values should be preserved
    expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe(
      "phc_bad"
    );
  });

  test("shows already-connected connectors loaded from bootstrap", async () => {
    const api = createApi({
      listWorkspaces: mock(async () => ({
        workspaces: [WORKSPACE_A],
        activeWorkspaceId: WORKSPACE_A.id,
      })),
      listStartups: mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()],
      })),
      listConnectors: mock(async () => ({
        connectors: [createConnector("posthog", "connected")],
      })),
    });

    const view = render(<OnboardingPage api={api} />);

    // PostHog should show as connected in the status panel, not the setup form
    expect(await view.findByText("Connected")).toBeTruthy();

    // Stripe setup form should still appear (not connected yet)
    expect(view.getByRole("form", { name: "Stripe setup form" })).toBeTruthy();

    // PostHog setup form should not appear
    expect(view.queryByRole("form", { name: "PostHog setup form" })).toBeNull();
  });
});
