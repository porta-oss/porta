import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import {
  DEFAULT_STARTUP_DRAFT,
  type StartupDraft,
  type StartupRecord,
  type WorkspaceSummary,
} from "@shared/types";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectorSetupCard } from "../../components/connector-setup-card";
import { ConnectorStatusPanel } from "../../components/connector-status-panel";
import { StartupForm } from "../../components/startup-form";
import { API_BASE_URL, getErrorMessage } from "../../lib/auth-client";
import { authenticatedRoute } from "../_authenticated";

// ------------------------------------------------------------------
// API interface
// ------------------------------------------------------------------

export interface OnboardingApi {
  createConnector: (
    startupId: string,
    provider: ConnectorProvider,
    config: Record<string, string>
  ) => Promise<{ connector: ConnectorSummary }>;
  createStartup: (input: StartupDraft) => Promise<{
    workspace: WorkspaceSummary;
    startup: StartupRecord;
    startups: StartupRecord[];
  }>;
  createWorkspace: (input: {
    name: string;
  }) => Promise<{ workspace: WorkspaceSummary; activeWorkspaceId: string }>;
  listConnectors: (
    startupId: string
  ) => Promise<{ connectors: ConnectorSummary[] }>;
  listStartups: () => Promise<{
    workspace: WorkspaceSummary;
    startups: StartupRecord[];
  }>;
  listWorkspaces: () => Promise<{
    workspaces: WorkspaceSummary[];
    activeWorkspaceId: string | null;
  }>;
  setActiveWorkspace: (input: {
    workspaceId: string;
  }) => Promise<{ activeWorkspaceId: string; workspace: WorkspaceSummary }>;
}

export interface OnboardingPageProps {
  api?: OnboardingApi;
  navigateTo?: (to: "/app") => void;
}

// ------------------------------------------------------------------
// Internal types
// ------------------------------------------------------------------

interface OnboardingApiErrorShape {
  code: string;
  message: string;
}

interface BootstrapState {
  activeWorkspaceId: string | null;
  connectors: ConnectorSummary[];
  startups: StartupRecord[];
  workspaces: WorkspaceSummary[];
}

const REQUEST_TIMEOUT_MS = 4000;

const EMPTY_BOOTSTRAP: BootstrapState = {
  workspaces: [],
  activeWorkspaceId: null,
  startups: [],
  connectors: [],
};

// ------------------------------------------------------------------
// Validation / request helpers
// ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.slug === "string"
  );
}

function isStartupRecord(value: unknown): value is StartupRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.stage === "string" &&
    typeof value.timezone === "string" &&
    typeof value.currency === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isConnectorSummary(value: unknown): value is ConnectorSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startupId === "string" &&
    typeof value.provider === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

class OnboardingApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OnboardingApiError";
    this.code = code;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new OnboardingApiError(
            "REQUEST_TIMEOUT",
            "The request took too long. Retry without re-entering your work."
          )
        ),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function requestJson(path: string, init?: RequestInit) {
  const normalizedPath = path.replace(/^\//, "");
  const response = await withTimeout(
    fetch(new URL(normalizedPath, `${API_BASE_URL}/`).toString(), {
      ...init,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    throw new OnboardingApiError(
      "MALFORMED_RESPONSE",
      "Something went wrong. Please try again."
    );
  }

  if (!response.ok) {
    const error =
      isRecord(payload) && isRecord(payload.error)
        ? ({
            code:
              typeof payload.error.code === "string"
                ? payload.error.code
                : `HTTP_${response.status}`,
            message:
              typeof payload.error.message === "string"
                ? payload.error.message
                : "The request could not be completed. Please try again.",
          } satisfies OnboardingApiErrorShape)
        : {
            code: `HTTP_${response.status}`,
            message: "The request could not be completed. Please try again.",
          };

    throw new OnboardingApiError(error.code, error.message);
  }

  return payload;
}

// ------------------------------------------------------------------
// Default API implementation
// ------------------------------------------------------------------

function createDefaultOnboardingApi(): OnboardingApi {
  return {
    async listWorkspaces() {
      const payload = await requestJson("/workspaces");

      if (
        !(
          isRecord(payload) &&
          Array.isArray(payload.workspaces) &&
          payload.workspaces.every(isWorkspaceSummary)
        )
      ) {
        throw new OnboardingApiError(
          "MALFORMED_WORKSPACE_CONTEXT",
          "Could not load workspace data. Please try again."
        );
      }

      return {
        workspaces: payload.workspaces,
        activeWorkspaceId:
          typeof payload.activeWorkspaceId === "string"
            ? payload.activeWorkspaceId
            : null,
      };
    },
    async createWorkspace(input) {
      const payload = await requestJson("/workspaces", {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (
        !(isRecord(payload) && isWorkspaceSummary(payload.workspace)) ||
        typeof payload.activeWorkspaceId !== "string"
      ) {
        throw new OnboardingApiError(
          "MALFORMED_WORKSPACE_CREATE",
          "Workspace creation returned an unexpected response. Retry the setup step."
        );
      }

      return {
        workspace: payload.workspace,
        activeWorkspaceId: payload.activeWorkspaceId,
      };
    },
    async setActiveWorkspace(input) {
      const payload = await requestJson("/workspaces/active", {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (
        !(isRecord(payload) && isWorkspaceSummary(payload.workspace)) ||
        typeof payload.activeWorkspaceId !== "string"
      ) {
        throw new OnboardingApiError(
          "MALFORMED_WORKSPACE_SWITCH",
          "Workspace selection returned an unexpected response. Retry the setup step."
        );
      }

      return {
        workspace: payload.workspace,
        activeWorkspaceId: payload.activeWorkspaceId,
      };
    },
    async listStartups() {
      const payload = await requestJson("/startups");

      if (
        !(
          isRecord(payload) &&
          isWorkspaceSummary(payload.workspace) &&
          Array.isArray(payload.startups) &&
          payload.startups.every(isStartupRecord)
        )
      ) {
        throw new OnboardingApiError(
          "MALFORMED_STARTUP_LIST",
          "The startup list was malformed. Retry the onboarding step."
        );
      }

      return {
        workspace: payload.workspace,
        startups: payload.startups,
      };
    },
    async createStartup(input) {
      const payload = await requestJson("/startups", {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (
        !(
          isRecord(payload) &&
          isWorkspaceSummary(payload.workspace) &&
          isStartupRecord(payload.startup) &&
          Array.isArray(payload.startups) &&
          payload.startups.every(isStartupRecord)
        )
      ) {
        throw new OnboardingApiError(
          "MALFORMED_STARTUP_CREATE",
          "Startup creation returned an unexpected response. Retry the onboarding step."
        );
      }

      return {
        workspace: payload.workspace,
        startup: payload.startup,
        startups: payload.startups,
      };
    },
    async listConnectors(startupId) {
      const payload = await requestJson(
        `/connectors?startupId=${encodeURIComponent(startupId)}`
      );

      if (
        !(
          isRecord(payload) &&
          Array.isArray(payload.connectors) &&
          payload.connectors.every(isConnectorSummary)
        )
      ) {
        throw new OnboardingApiError(
          "MALFORMED_CONNECTOR_LIST",
          "The connector list was malformed. Retry the onboarding step."
        );
      }

      return { connectors: payload.connectors };
    },
    async createConnector(startupId, provider, config) {
      const payload = await requestJson("/connectors", {
        method: "POST",
        body: JSON.stringify({ startupId, provider, config }),
      });

      if (!(isRecord(payload) && isConnectorSummary(payload.connector))) {
        throw new OnboardingApiError(
          "MALFORMED_CONNECTOR_CREATE",
          "Connector creation returned an unexpected response. Retry the setup step."
        );
      }

      return { connector: payload.connector };
    },
  };
}

// ------------------------------------------------------------------
// Error message
// ------------------------------------------------------------------

function getOnboardingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof OnboardingApiError) {
    return error.message;
  }

  return getErrorMessage(error, fallback);
}

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------

export const onboardingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "app/onboarding",
  component: OnboardingRouteComponent,
});

function OnboardingRouteComponent() {
  const navigate = useNavigate();

  return (
    <OnboardingPage
      navigateTo={(to) => {
        void navigate({ to });
      }}
    />
  );
}

// ------------------------------------------------------------------
// Page component
// ------------------------------------------------------------------

export function OnboardingPage({
  api = createDefaultOnboardingApi(),
  navigateTo,
}: OnboardingPageProps) {
  const [bootstrapState, setBootstrapState] =
    useState<BootstrapState>(EMPTY_BOOTSTRAP);
  const [workspaceName, setWorkspaceName] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [startupDraft, setStartupDraft] = useState<StartupDraft>(
    DEFAULT_STARTUP_DRAFT
  );
  const [viewState, setViewState] = useState<
    | "loading"
    | "ready"
    | "submitting-workspace"
    | "submitting-startup"
    | "error"
  >("loading");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skippedProviders, setSkippedProviders] = useState<
    Set<ConnectorProvider>
  >(new Set());

  const activeWorkspace = useMemo(
    () =>
      bootstrapState.workspaces.find(
        (workspace) => workspace.id === bootstrapState.activeWorkspaceId
      ) ?? null,
    [bootstrapState.activeWorkspaceId, bootstrapState.workspaces]
  );

  const primaryStartup = bootstrapState.startups[0] ?? null;

  // Determine which connectors exist per provider
  const posthogConnector =
    bootstrapState.connectors.find((c) => c.provider === "posthog") ?? null;
  const stripeConnector =
    bootstrapState.connectors.find((c) => c.provider === "stripe") ?? null;

  // Connector step is visible after a startup exists
  const showConnectorStep = activeWorkspace !== null && primaryStartup !== null;

  // All connectors done or skipped?
  const posthogDone =
    posthogConnector !== null || skippedProviders.has("posthog");
  const stripeDone = stripeConnector !== null || skippedProviders.has("stripe");
  const allConnectorsDone = posthogDone && stripeDone;

  async function loadBootstrap() {
    setViewState("loading");
    setBootstrapError(null);

    try {
      const workspaceState = await api.listWorkspaces();
      let startups: StartupRecord[] = [];
      let connectors: ConnectorSummary[] = [];

      if (workspaceState.activeWorkspaceId) {
        const startupState = await api.listStartups();
        startups = startupState.startups;

        // Load connectors for the primary startup
        if (startups[0]) {
          try {
            const connectorState = await api.listConnectors(startups[0].id);
            connectors = connectorState.connectors;
          } catch {
            // Non-fatal — show connector setup even if list fails
            connectors = [];
          }
        }
      }

      setBootstrapState({
        workspaces: workspaceState.workspaces,
        activeWorkspaceId: workspaceState.activeWorkspaceId,
        startups,
        connectors,
      });
      setSelectedWorkspaceId((current) => {
        if (current) {
          return current;
        }

        return (
          workspaceState.activeWorkspaceId ??
          workspaceState.workspaces[0]?.id ??
          ""
        );
      });
      setViewState("ready");
    } catch (error) {
      setBootstrapError(
        getOnboardingErrorMessage(
          error,
          "The onboarding surface could not load. Retry the workspace lookup."
        )
      );
      setViewState("error");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only bootstrap effect
  useEffect(() => {
    void loadBootstrap();
  }, []);

  async function handleCreateWorkspace() {
    setWorkspaceError(null);
    setNotice(null);

    const trimmedName = workspaceName.trim();

    if (!trimmedName) {
      setWorkspaceError("Workspace name cannot be blank.");
      return;
    }

    setViewState("submitting-workspace");

    try {
      const response = await api.createWorkspace({ name: trimmedName });
      setWorkspaceName("");
      setSelectedWorkspaceId(response.activeWorkspaceId);
      setNotice(
        `Workspace ${response.workspace.name} is active. Add the first startup profile next.`
      );
      await loadBootstrap();
    } catch (error) {
      setWorkspaceError(
        getOnboardingErrorMessage(
          error,
          "Workspace creation failed. Retry without leaving the form."
        )
      );
      setViewState("ready");
    }
  }

  async function handleSelectWorkspace() {
    setWorkspaceError(null);
    setNotice(null);

    if (!selectedWorkspaceId) {
      setWorkspaceError("Choose a workspace before continuing.");
      return;
    }

    setViewState("submitting-workspace");

    try {
      const response = await api.setActiveWorkspace({
        workspaceId: selectedWorkspaceId,
      });
      setNotice(
        `Workspace ${response.workspace.name} is active. Add the first startup profile next.`
      );
      await loadBootstrap();
    } catch (error) {
      setWorkspaceError(
        getOnboardingErrorMessage(
          error,
          "Workspace selection failed. Retry without leaving the form."
        )
      );
      setViewState("ready");
    }
  }

  async function handleCreateStartup() {
    setStartupError(null);
    setNotice(null);

    if (!startupDraft.name.trim()) {
      setStartupError("Startup name cannot be blank.");
      return;
    }

    setViewState("submitting-startup");

    try {
      const response = await api.createStartup({
        ...startupDraft,
        name: startupDraft.name.trim(),
      });
      setBootstrapState((current) => ({
        ...current,
        startups: response.startups,
      }));
      setNotice(
        `${response.startup.name} is ready inside ${response.workspace.name}. Connect your data sources next, or skip to the dashboard.`
      );
      setViewState("ready");
    } catch (error) {
      setStartupError(
        getOnboardingErrorMessage(
          error,
          "Startup creation failed. Retry without leaving the form."
        )
      );
      setViewState("ready");
    }
  }

  async function handleConnectProvider(
    provider: ConnectorProvider,
    config: Record<string, string>
  ) {
    if (!primaryStartup) {
      return;
    }

    setConnectorError(null);
    const result = await api.createConnector(
      primaryStartup.id,
      provider,
      config
    );
    setBootstrapState((current) => ({
      ...current,
      connectors: [
        ...current.connectors.filter((c) => c.provider !== provider),
        result.connector,
      ],
    }));
  }

  function handleSkipProvider(provider: ConnectorProvider) {
    setSkippedProviders((current) => new Set([...current, provider]));
  }

  function handleFinishOnboarding() {
    navigateTo?.("/app");
  }

  return (
    <main aria-label="startup onboarding" className="grid gap-6 p-6">
      <header>
        <h2>Finish workspace onboarding</h2>
        <p>
          Create or select a workspace, then add the first B2B SaaS startup
          profile.
        </p>
      </header>

      {viewState === "loading" ? (
        <Alert>
          <AlertDescription>
            Loading workspace and startup context…
          </AlertDescription>
        </Alert>
      ) : null}
      {bootstrapError ? (
        <Alert variant="destructive">
          <AlertDescription>{bootstrapError}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {/* Step 1: Workspace */}
      <Card aria-label="workspace setup">
        <CardContent className="grid gap-4 pt-6">
          <div>
            <h3 className="mb-2 font-semibold text-lg">
              1. Pick the active workspace
            </h3>
            <p className="text-muted-foreground text-sm">
              {activeWorkspace
                ? `Active workspace: ${activeWorkspace.name}`
                : "No active workspace yet. Create one or select an existing workspace to continue."}
            </p>
          </div>

          <form
            aria-label="workspace create form"
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateWorkspace();
            }}
          >
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              disabled={
                viewState === "loading" || viewState === "submitting-workspace"
              }
              id="workspace-name"
              name="workspaceName"
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Acme Ventures"
              type="text"
              value={workspaceName}
            />
            <Button
              disabled={
                viewState === "loading" || viewState === "submitting-workspace"
              }
              type="submit"
            >
              {viewState === "submitting-workspace"
                ? "Saving workspace…"
                : "Create workspace"}
            </Button>
          </form>

          {bootstrapState.workspaces.length > 0 ? (
            <form
              aria-label="workspace select form"
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSelectWorkspace();
              }}
            >
              <Label htmlFor="workspace-select">Existing workspaces</Label>
              <Select
                disabled={
                  viewState === "loading" ||
                  viewState === "submitting-workspace"
                }
                onValueChange={setSelectedWorkspaceId}
                value={selectedWorkspaceId}
              >
                <SelectTrigger id="workspace-select">
                  <SelectValue placeholder="Choose a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {bootstrapState.workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={
                  viewState === "loading" ||
                  viewState === "submitting-workspace"
                }
                type="submit"
              >
                Use selected workspace
              </Button>
            </form>
          ) : null}

          {workspaceError ? (
            <Alert variant="destructive">
              <AlertDescription>{workspaceError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 2: Startup */}
      <Card aria-label="startup setup">
        <CardContent className="grid gap-4 pt-6">
          <div>
            <h3 className="mb-2 font-semibold text-lg">
              2. Add the first startup
            </h3>
            <p className="text-muted-foreground text-sm">
              {activeWorkspace
                ? `The first startup will be created inside ${activeWorkspace.name}.`
                : "Create a workspace first, then add your startup."}
            </p>
          </div>

          {primaryStartup ? (
            <Alert>
              <AlertDescription>
                Startup onboarding is complete. {primaryStartup.name} is
                attached to {activeWorkspace?.name ?? "the active workspace"}.
              </AlertDescription>
            </Alert>
          ) : (
            <StartupForm
              disabled={
                !activeWorkspace ||
                viewState === "loading" ||
                viewState === "submitting-startup"
              }
              error={startupError}
              onChange={setStartupDraft}
              onSubmit={handleCreateStartup}
              value={startupDraft}
            />
          )}
        </CardContent>
      </Card>

      {/* Step 3: Connectors */}
      {showConnectorStep ? (
        <Card aria-label="connector setup">
          <CardContent className="grid gap-4 pt-6">
            <div>
              <h3 className="mb-2 font-semibold text-lg">
                3. Connect data sources
              </h3>
              <p className="text-muted-foreground text-sm">
                Connect PostHog and Stripe to start syncing product and revenue
                data for {primaryStartup.name}. You can skip and add them later
                from the dashboard.
              </p>
            </div>

            {connectorError ? (
              <Alert variant="destructive">
                <AlertDescription>{connectorError}</AlertDescription>
              </Alert>
            ) : null}

            {/* Show already-connected connectors */}
            {bootstrapState.connectors.length > 0 ? (
              <ConnectorStatusPanel connectors={bootstrapState.connectors} />
            ) : null}

            {/* PostHog setup card (unless connected or skipped) */}
            {posthogConnector || skippedProviders.has("posthog") ? null : (
              <ConnectorSetupCard
                disabled={viewState === "loading"}
                existing={posthogConnector}
                onConnect={handleConnectProvider}
                onSkip={handleSkipProvider}
                provider="posthog"
              />
            )}

            {/* Stripe setup card (unless connected or skipped) */}
            {stripeConnector || skippedProviders.has("stripe") ? null : (
              <ConnectorSetupCard
                disabled={viewState === "loading"}
                existing={stripeConnector}
                onConnect={handleConnectProvider}
                onSkip={handleSkipProvider}
                provider="stripe"
              />
            )}

            {allConnectorsDone ? (
              <div className="grid gap-2">
                <Alert>
                  <AlertDescription>
                    {bootstrapState.connectors.length > 0
                      ? "Data sources configured. You can proceed to the dashboard."
                      : "Connectors skipped. You can add them later from the dashboard."}
                  </AlertDescription>
                </Alert>
                <Button onClick={handleFinishOnboarding} type="button">
                  Continue to dashboard
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Legacy: if startup exists but no connector step, still show dashboard nav */}
      {primaryStartup && !showConnectorStep ? (
        <Button onClick={() => navigateTo?.("/app")} type="button">
          Go to dashboard
        </Button>
      ) : null}

      {viewState === "error" ? (
        <Button onClick={() => void loadBootstrap()} type="button">
          Retry onboarding load
        </Button>
      ) : null}
    </main>
  );
}
