import type { AlertSummary } from "@shared/alert-rule";
import {
  ALERT_SEVERITIES,
  isAlertSeverity,
  isAlertStatus,
} from "@shared/alert-rule";
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import type { CustomMetricSummary } from "@shared/custom-metric";
import { isCustomMetricCategory } from "@shared/custom-metric";
import type { InternalTaskPayload } from "@shared/internal-task";
import { isTaskSyncStatus } from "@shared/internal-task";
import type {
  FunnelStageRow,
  HealthSnapshotSummary,
  HealthState,
} from "@shared/startup-health";
import { isHealthState } from "@shared/startup-health";
import type { LatestInsightPayload } from "@shared/startup-insight";
import {
  type EvidencePacket,
  type InsightExplanation,
  isInsightConditionCode,
  isInsightGenerationStatus,
  validateEvidencePacket,
  validateInsightExplanation,
} from "@shared/startup-insight";
import type { StartupRecord, WorkspaceSummary } from "@shared/types";
import type { UniversalMetrics } from "@shared/universal-metrics";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AppShell } from "../../components/app-shell";
import { ConnectorSetupCard } from "../../components/connector-setup-card";
import { ConnectorStatusPanel } from "../../components/connector-status-panel";
import { CustomMetricPanel } from "../../components/custom-metric-panel";
import {
  DecisionSurface,
  type StreakInfo,
} from "../../components/decision-surface";
import { DisclosureSection } from "../../components/disclosure-section";
import { FadeIn } from "../../components/fade-in";
import type { DashboardMode } from "../../components/mode-switcher";
import { ModeSwitcher } from "../../components/mode-switcher";
import { PortfolioStartupCard } from "../../components/portfolio-startup-card";
import type { PostgresSetupFormValues } from "../../components/postgres-custom-metric-card";
import { PostgresCustomMetricCard } from "../../components/postgres-custom-metric-card";
import {
  HealthHeroSkeleton,
  InsightCardSkeleton,
  PortfolioCardSkeleton,
} from "../../components/skeleton-screens";
import { StartupFunnelPanel } from "../../components/startup-funnel-panel";
import { StartupHealthHero } from "../../components/startup-health-hero";
import { StartupInsightCard } from "../../components/startup-insight-card";
import type { InsightDisplayStatus } from "../../components/startup-insight-card-types";
import { StartupMetricsGrid } from "../../components/startup-metrics-grid";
import { StartupTaskList } from "../../components/startup-task-list";
import {
  API_BASE_URL,
  type AuthSnapshot,
  getErrorMessage,
} from "../../lib/auth-client";
import {
  buildPortfolioCardViewModel,
  buildPortfolioErrorViewModel,
} from "../../lib/portfolio-card";

// ------------------------------------------------------------------
// API interface
// ------------------------------------------------------------------

/** Connector freshness surfaced alongside health. */
export interface ConnectorFreshness {
  lastSyncAt: string | null;
  lastSyncError: string | null;
  provider: ConnectorProvider;
  status: ConnectorSummary["status"];
}

/** Blocked reason from the health API. */
export interface BlockedReason {
  code: string;
  message: string;
}

/** Health payload returned by GET /startups/:id/health */
export interface StartupHealthPayload {
  blockedReasons: BlockedReason[];
  connectors: ConnectorFreshness[];
  /** Optional custom metric from a Postgres prepared view. Null if not configured. */
  customMetric: CustomMetricSummary | null;
  health: HealthSnapshotSummary | null;
  lastSnapshotAt: string | null;
  status: HealthState;
}

/** Insight payload returned by GET /startups/:id/insight */
export interface StartupInsightPayload {
  diagnosticMessage: string | null;
  displayStatus: InsightDisplayStatus;
  insight: LatestInsightPayload | null;
}

export interface DashboardApi {
  createConnector: (
    startupId: string,
    provider: ConnectorProvider,
    config: Record<string, string>
  ) => Promise<{ connector: ConnectorSummary }>;
  createPostgresMetric: (
    startupId: string,
    setup: PostgresSetupFormValues
  ) => Promise<{
    connector: ConnectorSummary;
    customMetric: CustomMetricSummary;
  }>;
  createTask: (
    startupId: string,
    actionIndex: number
  ) => Promise<{ task: InternalTaskPayload; created: boolean }>;
  deleteConnector: (connectorId: string) => Promise<void>;
  fetchHealth: (startupId: string) => Promise<StartupHealthPayload>;
  fetchInsight: (startupId: string) => Promise<StartupInsightPayload>;
  listAlerts: (
    startupId: string,
    status?: string
  ) => Promise<{ alerts: AlertSummary[] }>;
  listConnectors: (
    startupId: string
  ) => Promise<{ connectors: ConnectorSummary[] }>;
  listStartups: () => Promise<{
    workspace: WorkspaceSummary;
    startups: StartupRecord[];
  }>;
  listTasks: (startupId: string) => Promise<{
    tasks: InternalTaskPayload[];
    startupId: string;
    count: number;
  }>;
  listWorkspaces: () => Promise<{
    workspaces: WorkspaceSummary[];
    activeWorkspaceId: string | null;
  }>;
  setActiveWorkspace: (input: {
    workspaceId: string;
  }) => Promise<{ activeWorkspaceId: string; workspace: WorkspaceSummary }>;
  triageAlert: (
    alertId: string,
    action: "ack" | "snooze" | "dismiss",
    snoozeDurationHours?: number
  ) => Promise<{ alert: AlertSummary }>;
  triggerSync: (connectorId: string) => Promise<void>;
}

export interface DashboardSearch {
  mode?: DashboardMode;
}

export interface DashboardPageProps {
  api?: DashboardApi;
  authState: AuthSnapshot;
  mode?: DashboardMode;
  navigateToStartup?: (
    startupId: string,
    replace?: boolean
  ) => void | Promise<void>;
  onModeChange?: (mode: DashboardMode) => void;
  routeStartupId?: string | null;
}

type DashboardContentView = "overview" | "health-connectors";
type StartupHealthSummaryMap = Record<string, HealthState | "load-error">;

// ------------------------------------------------------------------
// Internal types
// ------------------------------------------------------------------

interface DashboardApiErrorShape {
  code: string;
  message: string;
}

class DashboardApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DashboardApiError";
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 4000;
const INSIGHT_DISPLAY_STATUSES = [
  "ready",
  "unavailable",
  "blocked",
  "error",
] as const satisfies InsightDisplayStatus[];

const SEVERITY_ORDER: Record<string, number> = Object.fromEntries(
  ALERT_SEVERITIES.map((s, i) => [s, i])
);

function sortAlertsByPriority(alerts: AlertSummary[]): AlertSummary[] {
  return [...alerts].sort((a, b) => {
    const sevDiff =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (sevDiff !== 0) {
      return sevDiff;
    }
    return new Date(b.firedAt).getTime() - new Date(a.firedAt).getTime();
  });
}

// ------------------------------------------------------------------
// Helpers
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

function isInternalTaskPayload(value: unknown): value is InternalTaskPayload {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startupId === "string" &&
    typeof value.sourceInsightId === "string" &&
    typeof value.sourceActionIndex === "number" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.linkedMetricKeys) &&
    typeof value.syncStatus === "string" &&
    isTaskSyncStatus(value.syncStatus) &&
    typeof value.createdAt === "string"
  );
}

function isAlertSummary(value: unknown): value is AlertSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startupId === "string" &&
    typeof value.ruleId === "string" &&
    typeof value.metricKey === "string" &&
    typeof value.severity === "string" &&
    isAlertSeverity(value.severity) &&
    typeof value.status === "string" &&
    isAlertStatus(value.status) &&
    typeof value.firedAt === "string" &&
    typeof value.lastFiredAt === "string" &&
    typeof value.threshold === "number" &&
    typeof value.value === "number" &&
    typeof value.occurrenceCount === "number"
  );
}

function isCustomMetricSummary(value: unknown): value is CustomMetricSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startupId === "string" &&
    typeof value.connectorId === "string" &&
    typeof value.key === "string" &&
    typeof value.category === "string" &&
    isCustomMetricCategory(value.category) &&
    typeof value.label === "string" &&
    typeof value.unit === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new DashboardApiError(
            "REQUEST_TIMEOUT",
            "The request timed out. Please try again."
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
    throw new DashboardApiError(
      "MALFORMED_RESPONSE",
      "Something went wrong loading the dashboard. Please try again."
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
          } satisfies DashboardApiErrorShape)
        : {
            code: `HTTP_${response.status}`,
            message: "The request could not be completed. Please try again.",
          };

    throw new DashboardApiError(error.code, error.message);
  }

  return payload;
}

function parseBlockedReasons(payload: unknown): BlockedReason[] {
  const blockedReasons: BlockedReason[] = [];
  if (!Array.isArray(payload)) {
    return blockedReasons;
  }

  for (const reason of payload) {
    if (
      isRecord(reason) &&
      typeof reason.code === "string" &&
      typeof reason.message === "string"
    ) {
      blockedReasons.push({ code: reason.code, message: reason.message });
    }
  }

  return blockedReasons;
}

function parseHealthSnapshot(
  payload: unknown,
  startupId: string,
  status: HealthState
): HealthSnapshotSummary | null {
  if (!isRecord(payload)) {
    return null;
  }

  return {
    startupId:
      typeof payload.startupId === "string" ? payload.startupId : startupId,
    healthState:
      typeof payload.healthState === "string" &&
      isHealthState(payload.healthState)
        ? payload.healthState
        : status,
    blockedReason:
      typeof payload.blockedReason === "string" ? payload.blockedReason : null,
    northStarKey:
      typeof payload.northStarKey === "string" ? payload.northStarKey : "mrr",
    northStarValue:
      typeof payload.northStarValue === "number"
        ? payload.northStarValue
        : null,
    northStarPreviousValue:
      typeof payload.northStarPreviousValue === "number"
        ? payload.northStarPreviousValue
        : null,
    supportingMetrics:
      typeof payload.supportingMetrics === "object" &&
      payload.supportingMetrics !== null
        ? (payload.supportingMetrics as UniversalMetrics)
        : null,
    funnel: Array.isArray(payload.funnel)
      ? (payload.funnel as FunnelStageRow[])
      : [],
    computedAt:
      typeof payload.computedAt === "string"
        ? payload.computedAt
        : new Date().toISOString(),
    syncJobId: typeof payload.syncJobId === "string" ? payload.syncJobId : null,
  };
}

function parseConnectorFreshness(payload: unknown): ConnectorFreshness[] {
  const connectors: ConnectorFreshness[] = [];
  if (!Array.isArray(payload)) {
    return connectors;
  }

  for (const connector of payload) {
    if (
      isRecord(connector) &&
      typeof connector.provider === "string" &&
      typeof connector.status === "string"
    ) {
      connectors.push({
        provider: connector.provider as ConnectorProvider,
        status: connector.status as ConnectorSummary["status"],
        lastSyncAt:
          typeof connector.lastSyncAt === "string"
            ? connector.lastSyncAt
            : null,
        lastSyncError:
          typeof connector.lastSyncError === "string"
            ? connector.lastSyncError
            : null,
      });
    }
  }

  return connectors;
}

function parseHealthPayload(
  payload: unknown,
  startupId: string
): StartupHealthPayload {
  if (!isRecord(payload)) {
    throw new DashboardApiError(
      "MALFORMED_HEALTH",
      "Could not load health data. Please try again."
    );
  }

  const status =
    typeof payload.status === "string" && isHealthState(payload.status)
      ? payload.status
      : "error";

  return {
    health: parseHealthSnapshot(payload.health, startupId, status),
    connectors: parseConnectorFreshness(payload.connectors),
    status,
    blockedReasons: parseBlockedReasons(payload.blockedReasons),
    lastSnapshotAt:
      typeof payload.lastSnapshotAt === "string"
        ? payload.lastSnapshotAt
        : null,
    customMetric:
      isRecord(payload.customMetric) &&
      payload.customMetric !== null &&
      isCustomMetricSummary(payload.customMetric)
        ? payload.customMetric
        : null,
  };
}

function parseInsightDisplayStatus(payload: unknown): InsightDisplayStatus {
  if (
    typeof payload === "string" &&
    INSIGHT_DISPLAY_STATUSES.includes(payload as InsightDisplayStatus)
  ) {
    return payload as InsightDisplayStatus;
  }

  return "error";
}

function parseInsightExplanationValue(
  payload: unknown
): InsightExplanation | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  const explanationError = validateInsightExplanation(payload);
  if (explanationError) {
    throw new DashboardApiError(
      "MALFORMED_INSIGHT",
      `Invalid explanation: ${explanationError}`
    );
  }

  return payload as InsightExplanation;
}

function parseInsightRecord(
  payload: unknown,
  startupId: string
): LatestInsightPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (
    typeof payload.conditionCode !== "string" ||
    !isInsightConditionCode(payload.conditionCode)
  ) {
    throw new DashboardApiError(
      "MALFORMED_INSIGHT",
      "Insight data is incomplete. Please try again."
    );
  }

  const evidenceError = validateEvidencePacket(payload.evidence);
  if (evidenceError) {
    throw new DashboardApiError(
      "MALFORMED_INSIGHT",
      "Insight data is incomplete. Please try again."
    );
  }

  if (
    typeof payload.generationStatus !== "string" ||
    !isInsightGenerationStatus(payload.generationStatus)
  ) {
    throw new DashboardApiError(
      "MALFORMED_INSIGHT",
      `Invalid generation status: ${String(payload.generationStatus)}`
    );
  }

  return {
    startupId:
      typeof payload.startupId === "string" ? payload.startupId : startupId,
    conditionCode: payload.conditionCode,
    evidence: payload.evidence as EvidencePacket,
    explanation: parseInsightExplanationValue(payload.explanation),
    generationStatus: payload.generationStatus,
    generatedAt:
      typeof payload.generatedAt === "string"
        ? payload.generatedAt
        : new Date().toISOString(),
    lastError: typeof payload.lastError === "string" ? payload.lastError : null,
  };
}

function parseInsightPayload(
  payload: unknown,
  startupId: string
): StartupInsightPayload {
  if (!isRecord(payload)) {
    throw new DashboardApiError(
      "MALFORMED_INSIGHT",
      "Could not load insight data. Please try again."
    );
  }

  return {
    insight: parseInsightRecord(payload.insight, startupId),
    displayStatus: parseInsightDisplayStatus(payload.displayStatus),
    diagnosticMessage:
      typeof payload.diagnosticMessage === "string"
        ? payload.diagnosticMessage
        : null,
  };
}

function parseTaskListPayload(payload: unknown, startupId: string) {
  if (
    !(
      isRecord(payload) &&
      Array.isArray(payload.tasks) &&
      payload.tasks.every(isInternalTaskPayload)
    )
  ) {
    throw new DashboardApiError(
      "MALFORMED_TASK_LIST",
      "The dashboard could not parse the task list."
    );
  }

  return {
    tasks: payload.tasks,
    startupId:
      typeof payload.startupId === "string" ? payload.startupId : startupId,
    count:
      typeof payload.count === "number" ? payload.count : payload.tasks.length,
  };
}

// ------------------------------------------------------------------
// Default API implementation
// ------------------------------------------------------------------

function createDefaultDashboardApi(): DashboardApi {
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
        throw new DashboardApiError(
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
    async setActiveWorkspace(input) {
      const payload = await requestJson("/workspaces/active", {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (
        !(isRecord(payload) && isWorkspaceSummary(payload.workspace)) ||
        typeof payload.activeWorkspaceId !== "string"
      ) {
        throw new DashboardApiError(
          "MALFORMED_WORKSPACE_SWITCH",
          "Workspace switch failed. Please try again."
        );
      }

      return {
        activeWorkspaceId: payload.activeWorkspaceId,
        workspace: payload.workspace,
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
        throw new DashboardApiError(
          "MALFORMED_STARTUP_LIST",
          "Could not load startups. Please try again."
        );
      }

      return {
        workspace: payload.workspace,
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
        throw new DashboardApiError(
          "MALFORMED_CONNECTOR_LIST",
          "Could not load connectors. Please try again."
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
        throw new DashboardApiError(
          "MALFORMED_CONNECTOR_CREATE",
          "Could not save connector. Please try again."
        );
      }

      return { connector: payload.connector };
    },
    async triggerSync(connectorId) {
      await requestJson(`/connectors/${encodeURIComponent(connectorId)}/sync`, {
        method: "POST",
      });
    },
    async deleteConnector(connectorId) {
      await requestJson(`/connectors/${encodeURIComponent(connectorId)}`, {
        method: "DELETE",
      });
    },
    async fetchHealth(startupId) {
      const payload = await requestJson(
        `/startups/${encodeURIComponent(startupId)}/health`
      );
      return parseHealthPayload(payload, startupId);
    },
    async fetchInsight(startupId) {
      const payload = await requestJson(
        `/startups/${encodeURIComponent(startupId)}/insight`
      );
      return parseInsightPayload(payload, startupId);
    },
    async listAlerts(startupId, status) {
      const params = new URLSearchParams();
      if (status) {
        params.set("status", status);
      }
      const qs = params.toString();
      const payload = await requestJson(
        `/startups/${encodeURIComponent(startupId)}/alerts${qs ? `?${qs}` : ""}`
      );

      if (
        !(
          isRecord(payload) &&
          Array.isArray(payload.alerts) &&
          payload.alerts.every(isAlertSummary)
        )
      ) {
        throw new DashboardApiError(
          "MALFORMED_ALERT_LIST",
          "Could not load alerts. Please try again."
        );
      }

      return { alerts: payload.alerts };
    },
    async triageAlert(alertId, action, snoozeDurationHours) {
      const body: Record<string, unknown> = { action };
      if (snoozeDurationHours !== undefined) {
        body.snoozeDurationHours = snoozeDurationHours;
      }

      const payload = await requestJson(
        `/alerts/${encodeURIComponent(alertId)}/triage`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      if (!(isRecord(payload) && isAlertSummary(payload.alert))) {
        throw new DashboardApiError(
          "MALFORMED_TRIAGE_RESPONSE",
          "Alert triage returned an unexpected response."
        );
      }

      return { alert: payload.alert };
    },
    async listTasks(startupId) {
      const payload = await requestJson(
        `/tasks?startupId=${encodeURIComponent(startupId)}`
      );
      return parseTaskListPayload(payload, startupId);
    },
    async createTask(startupId, actionIndex) {
      const payload = await requestJson("/tasks", {
        method: "POST",
        body: JSON.stringify({ startupId, actionIndex }),
      });

      if (!(isRecord(payload) && isInternalTaskPayload(payload.task))) {
        throw new DashboardApiError(
          "MALFORMED_TASK_CREATE",
          "Task creation returned an unexpected response."
        );
      }

      return {
        task: payload.task,
        created: payload.created === true,
      };
    },
    async createPostgresMetric(startupId, setup) {
      const payload = await requestJson("/connectors", {
        method: "POST",
        body: JSON.stringify({
          startupId,
          provider: "postgres",
          config: {
            connectionUri: setup.connectionUri,
            label: setup.label,
            unit: setup.unit,
          },
        }),
      });

      if (!(isRecord(payload) && isConnectorSummary(payload.connector))) {
        throw new DashboardApiError(
          "MALFORMED_POSTGRES_SETUP",
          "Postgres metric setup returned an unexpected response."
        );
      }

      const customMetric =
        isRecord(payload.customMetric) &&
        isCustomMetricSummary(payload.customMetric)
          ? payload.customMetric
          : null;

      if (!customMetric) {
        throw new DashboardApiError(
          "MALFORMED_POSTGRES_SETUP",
          "Postgres metric setup did not return the custom metric definition."
        );
      }

      return {
        connector: payload.connector,
        customMetric,
      };
    },
  };
}

// ------------------------------------------------------------------
// Error message
// ------------------------------------------------------------------

function getDashboardErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DashboardApiError) {
    return error.message;
  }

  return getErrorMessage(error, fallback);
}

function getDashboardViewCopy(contentView: DashboardContentView) {
  if (contentView === "overview") {
    return {
      title: "Daily triage",
      description:
        "Stay in the founder scan by default: portfolio status, grounded insight, and next tasks.",
    };
  }

  return {
    title: "Health & connectors",
    description:
      "Drill into health signals or manage sources only when you need deeper diagnostics and setup work.",
  };
}

function mergeTask(taskList: InternalTaskPayload[], task: InternalTaskPayload) {
  const existingTask = taskList.some((entry) => entry.id === task.id);
  if (existingTask) {
    return taskList.map((entry) => (entry.id === task.id ? task : entry));
  }

  return [...taskList, task];
}

function replaceConnectorByProvider(
  connectors: ConnectorSummary[],
  provider: ConnectorProvider,
  connector: ConnectorSummary
) {
  return [
    ...connectors.filter(
      (currentConnector) => currentConnector.provider !== provider
    ),
    connector,
  ];
}

interface DashboardContentHeaderProps {
  contentView: DashboardContentView;
  missingCoreConnectorCount: number;
  onChangeView: (view: DashboardContentView) => void;
}

function DashboardContentHeader({
  contentView,
  missingCoreConnectorCount,
  onChangeView,
}: DashboardContentHeaderProps) {
  const copy = getDashboardViewCopy(contentView);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid gap-1">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
          Content view
        </p>
        <div className="grid gap-1">
          <h2
            className="font-semibold text-lg tracking-tight"
            id="dashboard-content-heading"
          >
            {copy.title}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.description}</p>
        </div>
      </div>

      <div
        aria-label="Dashboard content views"
        className="inline-flex w-fit rounded-lg border border-border bg-muted p-1"
        role="tablist"
      >
        <Button
          aria-controls="dashboard-overview-panel"
          aria-selected={contentView === "overview"}
          id="dashboard-overview-tab"
          onClick={() => onChangeView("overview")}
          role="tab"
          size="sm"
          type="button"
          variant={contentView === "overview" ? "secondary" : "ghost"}
        >
          Overview
        </Button>
        <Button
          aria-controls="dashboard-health-connectors-panel"
          aria-selected={contentView === "health-connectors"}
          id="dashboard-health-connectors-tab"
          onClick={() => onChangeView("health-connectors")}
          role="tab"
          size="sm"
          type="button"
          variant={contentView === "health-connectors" ? "secondary" : "ghost"}
        >
          Health & connectors
          {missingCoreConnectorCount > 0
            ? ` (${String(missingCoreConnectorCount)})`
            : ""}
        </Button>
      </div>
    </div>
  );
}

interface DashboardOverviewPanelProps {
  creatingActionIndex: number | null;
  healthError: string | null;
  healthPayload: StartupHealthPayload | null;
  healthStatus: "idle" | "loading" | "ready" | "error";
  insightError: string | null;
  insightPayload: StartupInsightPayload | null;
  insightStatus: "idle" | "loading" | "ready" | "error";
  onCreateTask: (actionIndex: number) => Promise<void>;
  onRetryInsight: () => void;
  onRetryTasks: () => void;
  primaryStartup: StartupRecord | null;
  taskCreateError: string | null;
  taskListError: string | null;
  taskListStatus: "idle" | "loading" | "ready" | "error";
  tasks: InternalTaskPayload[];
}

function DashboardOverviewPanel({
  creatingActionIndex,
  healthError,
  healthPayload,
  healthStatus,
  insightError,
  insightPayload,
  insightStatus,
  onCreateTask,
  onRetryInsight,
  onRetryTasks,
  primaryStartup,
  taskCreateError,
  taskListError,
  taskListStatus,
  tasks,
}: DashboardOverviewPanelProps) {
  return (
    <div
      aria-labelledby="dashboard-overview-tab"
      className="grid gap-4"
      id="dashboard-overview-panel"
      role="tabpanel"
    >
      <section
        aria-labelledby="dashboard-triage-heading"
        className="grid gap-4"
      >
        <div className="grid gap-1">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
            Triage
          </p>
          <h3
            className="font-semibold text-lg tracking-tight"
            id="dashboard-triage-heading"
          >
            What needs attention now
          </h3>
        </div>

        {healthStatus === "ready" && healthPayload && primaryStartup ? (
          <FadeIn>
            <PortfolioStartupCard
              viewModel={buildPortfolioCardViewModel(
                primaryStartup,
                healthPayload
              )}
            />
          </FadeIn>
        ) : null}
        {healthStatus === "error" && primaryStartup ? (
          <PortfolioStartupCard
            viewModel={buildPortfolioErrorViewModel(
              primaryStartup,
              healthError ?? "Failed to load startup health data."
            )}
          />
        ) : null}
        {healthStatus === "loading" && primaryStartup ? (
          <div role="status">
            <span className="sr-only">Loading portfolio</span>
            <PortfolioCardSkeleton />
          </div>
        ) : null}

        {insightStatus === "ready" && insightPayload ? (
          <FadeIn>
            <StartupInsightCard
              creatingActionIndex={creatingActionIndex}
              diagnosticMessage={insightPayload.diagnosticMessage}
              displayStatus={insightPayload.displayStatus}
              insight={insightPayload.insight}
              onCreateTask={onCreateTask}
              onRetry={onRetryInsight}
              taskCreateError={taskCreateError}
              tasks={tasks}
            />
          </FadeIn>
        ) : null}
        {insightStatus === "error" ? (
          <Card
            aria-label="insight error"
            className="border-danger-border bg-danger-bg"
          >
            <CardContent className="grid gap-2 pt-5">
              <Alert variant="destructive">
                <AlertDescription>
                  {insightError ?? "Failed to load insight data."}
                </AlertDescription>
              </Alert>
              <Button onClick={onRetryInsight} type="button" variant="outline">
                Retry insight load
              </Button>
            </CardContent>
          </Card>
        ) : null}
        {insightStatus === "loading" ? (
          <div role="status">
            <span className="sr-only">Loading insight</span>
            <InsightCardSkeleton />
          </div>
        ) : null}

        <StartupTaskList
          error={taskListError}
          onRetry={onRetryTasks}
          status={taskListStatus}
          tasks={tasks}
        />
      </section>
    </div>
  );
}

interface DashboardHealthConnectorsPanelProps {
  activeConnectors: ConnectorSummary[];
  connectorError: string | null;
  connectorLoading: boolean;
  healthError: string | null;
  healthPayload: StartupHealthPayload | null;
  healthStatus: "idle" | "loading" | "ready" | "error";
  onConnectProvider: (
    provider: ConnectorProvider,
    config: Record<string, string>
  ) => Promise<void>;
  onDisconnect: (connectorId: string) => Promise<void>;
  onPostgresSetup: (values: PostgresSetupFormValues) => Promise<void>;
  onRefreshConnectors: () => void;
  onResync: (connectorId: string) => Promise<void>;
  onRetryHealth: () => void;
  pgSetupSubmitting: boolean;
  postgresConnector: ConnectorSummary | null;
  posthogConnector: ConnectorSummary | null;
  resolvedCustomMetric: CustomMetricSummary | null;
  showConnectorStatusPanel: boolean;
  stripeConnector: ConnectorSummary | null;
}

interface DashboardHealthSectionProps {
  healthError: string | null;
  healthPayload: StartupHealthPayload | null;
  healthStatus: "idle" | "loading" | "ready" | "error";
  onRetryHealth: () => void;
  resolvedCustomMetric: CustomMetricSummary | null;
}

function DashboardHealthSection({
  healthError,
  healthPayload,
  healthStatus,
  onRetryHealth,
  resolvedCustomMetric,
}: DashboardHealthSectionProps) {
  const isHealthMuted =
    healthPayload?.status === "stale" || healthPayload?.status === "blocked";

  return (
    <section aria-labelledby="dashboard-health-heading" className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
          Health
        </p>
        <h3
          className="font-semibold text-lg tracking-tight"
          id="dashboard-health-heading"
        >
          Startup health detail
        </h3>
      </div>

      <Separator
        className="bg-border/60"
        data-testid="health-detail-separator"
      />

      {healthStatus === "ready" && healthPayload ? (
        <FadeIn className="grid gap-4">
          <StartupHealthHero
            blockedReasons={healthPayload.blockedReasons}
            healthState={healthPayload.status}
            lastSnapshotAt={healthPayload.lastSnapshotAt}
            northStarKey={healthPayload.health?.northStarKey ?? "mrr"}
            northStarPreviousValue={
              healthPayload.health?.northStarPreviousValue ?? null
            }
            northStarValue={healthPayload.health?.northStarValue ?? 0}
          />

          {healthPayload.health ? (
            <>
              <DisclosureSection title="Supporting metrics">
                <StartupMetricsGrid
                  metrics={healthPayload.health.supportingMetrics ?? {}}
                  muted={isHealthMuted}
                />
              </DisclosureSection>
              <DisclosureSection title="Acquisition funnel">
                <StartupFunnelPanel
                  muted={isHealthMuted}
                  stages={healthPayload.health.funnel}
                />
              </DisclosureSection>
            </>
          ) : null}

          {healthPayload.status === "stale" ? (
            <p className="text-sm text-warning">
              Health data is stale. Refresh your connectors in the setup section
              below.
            </p>
          ) : null}

          {resolvedCustomMetric ? (
            <CustomMetricPanel
              customMetric={resolvedCustomMetric}
              healthError={false}
            />
          ) : null}
        </FadeIn>
      ) : null}

      {healthStatus === "error" ? (
        <Card
          aria-label="health error"
          className="border-danger-border bg-danger-bg"
        >
          <CardContent className="grid gap-2 pt-5">
            <Alert variant="destructive">
              <AlertDescription>
                {healthError ?? "Failed to load startup health data."}
              </AlertDescription>
            </Alert>
            <Button onClick={onRetryHealth} type="button" variant="outline">
              Retry health load
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {healthStatus === "error" && resolvedCustomMetric ? (
        <CustomMetricPanel
          customMetric={resolvedCustomMetric}
          healthError={true}
        />
      ) : null}

      {healthStatus === "loading" ? (
        <div role="status">
          <span className="sr-only">Loading health data</span>
          <HealthHeroSkeleton />
        </div>
      ) : null}
    </section>
  );
}

interface DashboardConnectorsSectionProps {
  activeConnectors: ConnectorSummary[];
  connectorError: string | null;
  connectorLoading: boolean;
  onConnectProvider: (
    provider: ConnectorProvider,
    config: Record<string, string>
  ) => Promise<void>;
  onDisconnect: (connectorId: string) => Promise<void>;
  onPostgresSetup: (values: PostgresSetupFormValues) => Promise<void>;
  onRefreshConnectors: () => void;
  onResync: (connectorId: string) => Promise<void>;
  pgSetupSubmitting: boolean;
  postgresConnector: ConnectorSummary | null;
  posthogConnector: ConnectorSummary | null;
  resolvedCustomMetric: CustomMetricSummary | null;
  showConnectorStatusPanel: boolean;
  stripeConnector: ConnectorSummary | null;
}

function DashboardConnectorsSection({
  activeConnectors,
  connectorError,
  connectorLoading,
  onConnectProvider,
  onDisconnect,
  onPostgresSetup,
  onRefreshConnectors,
  onResync,
  pgSetupSubmitting,
  postgresConnector,
  posthogConnector,
  resolvedCustomMetric,
  showConnectorStatusPanel,
  stripeConnector,
}: DashboardConnectorsSectionProps) {
  const showCoreConnectorSetup = !(posthogConnector && stripeConnector);

  return (
    <section
      aria-labelledby="dashboard-connectors-heading"
      className="grid gap-4 border-border border-t pt-6"
    >
      <div className="grid gap-1">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
          Connectors
        </p>
        <h3
          className="font-semibold text-lg tracking-tight"
          id="dashboard-connectors-heading"
        >
          Sources and setup
        </h3>
      </div>

      {showConnectorStatusPanel ? (
        <ConnectorStatusPanel
          connectors={activeConnectors}
          error={connectorError}
          loading={connectorLoading}
          onDisconnect={onDisconnect}
          onRefresh={onRefreshConnectors}
          onResync={onResync}
        />
      ) : null}

      {showCoreConnectorSetup ? (
        <section className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="font-semibold text-sm">Connect core sources</h3>
            <p className="text-muted-foreground text-sm">
              Only the sources that still need setup appear here.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {posthogConnector ? null : (
              <ConnectorSetupCard
                existing={null}
                onConnect={onConnectProvider}
                provider="posthog"
              />
            )}
            {stripeConnector ? null : (
              <ConnectorSetupCard
                existing={null}
                onConnect={onConnectProvider}
                provider="stripe"
              />
            )}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="font-semibold text-sm">Optional Postgres metric</h3>
          <p className="text-muted-foreground text-sm">
            Add a Postgres-backed KPI only if you need a custom signal in the
            health view.
          </p>
        </div>

        <PostgresCustomMetricCard
          disabled={pgSetupSubmitting}
          existing={postgresConnector ? resolvedCustomMetric : null}
          onSetup={onPostgresSetup}
        />
      </section>
    </section>
  );
}

function DashboardHealthConnectorsPanel({
  activeConnectors,
  connectorError,
  connectorLoading,
  healthError,
  healthPayload,
  healthStatus,
  onConnectProvider,
  onDisconnect,
  onPostgresSetup,
  onRefreshConnectors,
  onResync,
  onRetryHealth,
  pgSetupSubmitting,
  postgresConnector,
  posthogConnector,
  resolvedCustomMetric,
  showConnectorStatusPanel,
  stripeConnector,
}: DashboardHealthConnectorsPanelProps) {
  return (
    <div
      aria-labelledby="dashboard-health-connectors-tab"
      className="grid gap-4"
      id="dashboard-health-connectors-panel"
      role="tabpanel"
    >
      <DashboardHealthSection
        healthError={healthError}
        healthPayload={healthPayload}
        healthStatus={healthStatus}
        onRetryHealth={onRetryHealth}
        resolvedCustomMetric={resolvedCustomMetric}
      />
      <DashboardConnectorsSection
        activeConnectors={activeConnectors}
        connectorError={connectorError}
        connectorLoading={connectorLoading}
        onConnectProvider={onConnectProvider}
        onDisconnect={onDisconnect}
        onPostgresSetup={onPostgresSetup}
        onRefreshConnectors={onRefreshConnectors}
        onResync={onResync}
        pgSetupSubmitting={pgSetupSubmitting}
        postgresConnector={postgresConnector}
        posthogConnector={posthogConnector}
        resolvedCustomMetric={resolvedCustomMetric}
        showConnectorStatusPanel={showConnectorStatusPanel}
        stripeConnector={stripeConnector}
      />
    </div>
  );
}

export function DashboardPage({
  authState,
  api = createDefaultDashboardApi(),
  mode = "decide",
  navigateToStartup,
  onModeChange,
  routeStartupId = null,
}: DashboardPageProps) {
  const [shellStatus, setShellStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [startupStatus, setStartupStatus] = useState<
    "idle" | "loading" | "refreshing" | "ready" | "error"
  >("idle");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    authState.session?.session.activeOrganizationId ?? null
  );
  const [startups, setStartups] = useState<StartupRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [startupHealthById, setStartupHealthById] =
    useState<StartupHealthSummaryMap>({});

  // Health state
  const [healthPayload, setHealthPayload] =
    useState<StartupHealthPayload | null>(null);
  const [healthStatus, setHealthStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [healthError, setHealthError] = useState<string | null>(null);

  // Insight state
  const [insightPayload, setInsightPayload] =
    useState<StartupInsightPayload | null>(null);
  const [insightStatus, setInsightStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [insightError, setInsightError] = useState<string | null>(null);

  // Task state — independent from health/insight
  const [tasks, setTasks] = useState<InternalTaskPayload[]>([]);
  const [taskListStatus, setTaskListStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [taskListError, setTaskListError] = useState<string | null>(null);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [creatingActionIndex, setCreatingActionIndex] = useState<number | null>(
    null
  );

  // Alert state — Decide mode
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [alertStatus, setAlertStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [alertError, setAlertError] = useState<string | null>(null);
  const [triaging, setTriaging] = useState(false);

  // Custom metric state
  const [customMetric, setCustomMetric] = useState<CustomMetricSummary | null>(
    null
  );
  const [_pgSetupError, setPgSetupError] = useState<string | null>(null);
  const [pgSetupSubmitting, setPgSetupSubmitting] = useState(false);
  const [contentView, setContentView] = useState<DashboardContentView | null>(
    null
  );

  const activeWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
      null,
    [activeWorkspaceId, workspaces]
  );

  const selectedStartup =
    startups.find((startup) => startup.id === routeStartupId) ??
    startups[0] ??
    null;
  const selectedStartupId = selectedStartup?.id ?? null;
  const hasMatchingRouteStartup =
    routeStartupId !== null &&
    startups.some((startup) => startup.id === routeStartupId);

  useEffect(() => {
    if (!selectedStartupId) {
      setContentView(null);
      return;
    }
    setContentView(null);
  }, [selectedStartupId]);

  useEffect(() => {
    if (
      !navigateToStartup ||
      startupStatus !== "ready" ||
      startups.length === 0 ||
      (routeStartupId !== null && hasMatchingRouteStartup)
    ) {
      return;
    }

    const fallbackStartupId = startups[0]?.id;
    if (!fallbackStartupId) {
      return;
    }

    void navigateToStartup(fallbackStartupId, true);
  }, [
    hasMatchingRouteStartup,
    navigateToStartup,
    routeStartupId,
    startupStatus,
    startups,
  ]);

  useEffect(() => {
    if (startups.length === 0) {
      setStartupHealthById({});
      return;
    }

    const sidebarSummaryStartups = startups.filter(
      (startup) => startup.id !== selectedStartupId
    );

    if (sidebarSummaryStartups.length === 0) {
      setStartupHealthById((current) =>
        selectedStartupId && current[selectedStartupId]
          ? { [selectedStartupId]: current[selectedStartupId] }
          : {}
      );
      return;
    }

    let cancelled = false;

    void Promise.all(
      sidebarSummaryStartups.map(async (startup) => {
        try {
          const payload = await api.fetchHealth(startup.id);
          return [startup.id, payload.status] as const;
        } catch {
          return [startup.id, "load-error"] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) {
        setStartupHealthById((current) => {
          const nextEntries = Object.fromEntries(entries);

          if (selectedStartupId && current[selectedStartupId]) {
            return {
              ...nextEntries,
              [selectedStartupId]: current[selectedStartupId],
            };
          }

          return nextEntries;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [api, selectedStartupId, startups]);

  useEffect(() => {
    if (!selectedStartupId) {
      return;
    }

    if (healthStatus === "ready" && healthPayload) {
      setStartupHealthById((current) => ({
        ...current,
        [selectedStartupId]: healthPayload.status,
      }));
      return;
    }

    if (healthStatus === "error") {
      setStartupHealthById((current) =>
        current[selectedStartupId]
          ? current
          : {
              ...current,
              [selectedStartupId]: "load-error",
            }
      );
    }
  }, [healthPayload, healthStatus, selectedStartupId]);

  // Determine which providers already have a connector
  const posthogConnector =
    connectors.find(
      (c) => c.provider === "posthog" && c.status !== "disconnected"
    ) ?? null;
  const stripeConnector =
    connectors.find(
      (c) => c.provider === "stripe" && c.status !== "disconnected"
    ) ?? null;
  const postgresConnector =
    connectors.find(
      (c) => c.provider === "postgres" && c.status !== "disconnected"
    ) ?? null;

  async function refreshConnectors(startupId: string | null) {
    if (!(startupId && api.listConnectors)) {
      setConnectors([]);
      return;
    }

    setConnectorLoading(true);
    setConnectorError(null);

    try {
      const result = await api.listConnectors(startupId);
      setConnectors(result.connectors);
    } catch (error) {
      setConnectors([]);
      setConnectorError(
        getDashboardErrorMessage(error, "Failed to load connectors.")
      );
    } finally {
      setConnectorLoading(false);
    }
  }

  async function refreshHealth(startupId: string | null) {
    if (!startupId) {
      setHealthPayload(null);
      setHealthStatus("idle");
      return;
    }

    setHealthStatus("loading");
    setHealthError(null);

    try {
      const payload = await api.fetchHealth(startupId);
      setHealthPayload(payload);
      setCustomMetric(payload.customMetric);
      setHealthStatus("ready");
    } catch (error) {
      // Preserve the previous payload so stale data stays visible
      setHealthError(
        getDashboardErrorMessage(error, "Failed to load startup health data.")
      );
      setHealthStatus("error");
    }
  }

  async function refreshInsight(startupId: string | null) {
    if (!startupId) {
      setInsightPayload(null);
      setInsightStatus("idle");
      return;
    }

    setInsightStatus("loading");
    setInsightError(null);

    try {
      const payload = await api.fetchInsight(startupId);
      setInsightPayload(payload);
      setInsightStatus("ready");
    } catch (error) {
      // Preserve the previous insight payload for last-good semantics
      setInsightError(
        getDashboardErrorMessage(error, "Failed to load insight data.")
      );
      setInsightStatus("error");
    }
  }

  async function refreshTasks(startupId: string | null) {
    if (!startupId) {
      setTasks([]);
      setTaskListStatus("idle");
      return;
    }

    setTaskListStatus("loading");
    setTaskListError(null);

    try {
      const payload = await api.listTasks(startupId);
      setTasks(payload.tasks);
      setTaskListStatus("ready");
    } catch (error) {
      setTaskListError(
        getDashboardErrorMessage(error, "Failed to load tasks.")
      );
      setTaskListStatus("error");
    }
  }

  async function refreshAlerts(startupId: string | null) {
    if (!startupId) {
      setAlerts([]);
      setAlertStatus("idle");
      return;
    }

    setAlertStatus("loading");
    setAlertError(null);

    try {
      const payload = await api.listAlerts(startupId, "active");
      setAlerts(sortAlertsByPriority(payload.alerts));
      setAlertStatus("ready");
    } catch (error) {
      setAlertError(getDashboardErrorMessage(error, "Failed to load alerts."));
      setAlertStatus("error");
    }
  }

  async function handleTriageAck(alertId: string) {
    setTriaging(true);
    try {
      await api.triageAlert(alertId, "ack");
      await refreshAlerts(selectedStartupId);
    } catch (error) {
      setAlertError(
        getDashboardErrorMessage(error, "Failed to acknowledge alert.")
      );
    } finally {
      setTriaging(false);
    }
  }

  async function handleTriageSnooze(alertId: string, durationHours: number) {
    setTriaging(true);
    try {
      await api.triageAlert(alertId, "snooze", durationHours);
      await refreshAlerts(selectedStartupId);
    } catch (error) {
      setAlertError(getDashboardErrorMessage(error, "Failed to snooze alert."));
    } finally {
      setTriaging(false);
    }
  }

  async function handleCreateTaskFromAction(actionIndex: number) {
    if (!selectedStartup || creatingActionIndex !== null) {
      return;
    }

    setCreatingActionIndex(actionIndex);
    setTaskCreateError(null);

    try {
      const result = await api.createTask(selectedStartup.id, actionIndex);
      setTasks((currentTasks) => mergeTask(currentTasks, result.task));
    } catch (error) {
      setTaskCreateError(
        getDashboardErrorMessage(error, "Failed to create task.")
      );
    } finally {
      setCreatingActionIndex(null);
    }
  }

  async function refreshStartups(
    workspaceId: string | null,
    mode: "loading" | "refreshing" = "loading"
  ) {
    setStartupError(null);

    if (!workspaceId) {
      setStartups([]);
      setConnectors([]);
      setStartupStatus("ready");
      return;
    }

    setStartupStatus(mode);

    try {
      const startupState = await api.listStartups();

      if (startupState.workspace.id !== workspaceId) {
        throw new DashboardApiError(
          "WORKSPACE_SCOPE_MISMATCH",
          "Startup data does not match the active workspace. Please try again."
        );
      }

      setStartups(startupState.startups);
      setStartupStatus("ready");
    } catch (error) {
      setStartups([]);
      setConnectors([]);
      setStartupError(
        getDashboardErrorMessage(
          error,
          "Startups could not be loaded. Please try again."
        )
      );
      setStartupStatus("error");
    }
  }

  async function refreshShell() {
    setShellStatus("loading");
    setShellError(null);
    setWorkspaceError(null);

    try {
      const workspaceState = await api.listWorkspaces();
      setWorkspaces(workspaceState.workspaces);
      setActiveWorkspaceId(workspaceState.activeWorkspaceId);
      setShellStatus("ready");
      await refreshStartups(workspaceState.activeWorkspaceId, "loading");
    } catch (error) {
      setShellError(
        getDashboardErrorMessage(
          error,
          "Could not load the dashboard. Please try again."
        )
      );
      setStartupStatus("idle");
      setShellStatus("error");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only bootstrap effect
  useEffect(() => {
    void refreshShell();
  }, []);

  async function handleActivateWorkspace(workspaceId: string) {
    setWorkspaceError(null);
    setIsSwitchingWorkspace(true);

    try {
      const response = await api.setActiveWorkspace({ workspaceId });
      setActiveWorkspaceId(response.activeWorkspaceId);
      await refreshStartups(response.activeWorkspaceId, "loading");
    } catch (error) {
      setWorkspaceError(
        getDashboardErrorMessage(
          error,
          "Could not switch workspace. Please try again."
        )
      );
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }

  async function handleConnectProvider(
    provider: ConnectorProvider,
    config: Record<string, string>
  ) {
    if (!selectedStartup) {
      return;
    }
    const result = await api.createConnector(
      selectedStartup.id,
      provider,
      config
    );
    setConnectors((currentConnectors) =>
      replaceConnectorByProvider(currentConnectors, provider, result.connector)
    );
  }

  async function handleResync(connectorId: string) {
    await api.triggerSync(connectorId);
    // Refresh connectors to show updated status
    if (selectedStartup) {
      await refreshConnectors(selectedStartup.id);
    }
  }

  async function handleDisconnect(connectorId: string) {
    await api.deleteConnector(connectorId);
    // Refresh connectors to reflect disconnected state
    if (selectedStartup) {
      await refreshConnectors(selectedStartup.id);
    }
  }

  async function handlePostgresSetup(values: PostgresSetupFormValues) {
    if (!selectedStartup) {
      return;
    }

    setPgSetupError(null);
    setPgSetupSubmitting(true);

    try {
      const result = await api.createPostgresMetric(selectedStartup.id, values);
      setConnectors((currentConnectors) =>
        replaceConnectorByProvider(
          currentConnectors,
          "postgres",
          result.connector
        )
      );
      setCustomMetric(result.customMetric);
    } finally {
      setPgSetupSubmitting(false);
    }
  }

  const refreshSelectedStartupData = useEffectEvent(
    (startupId: string | null) => {
      void refreshConnectors(startupId);
      void refreshHealth(startupId);
      void refreshInsight(startupId);
      void refreshTasks(startupId);
      void refreshAlerts(startupId);
    }
  );

  useEffect(() => {
    refreshSelectedStartupData(selectedStartupId);
  }, [selectedStartupId]);

  // Filter active connectors for the status panel
  const activeConnectors = connectors.filter(
    (c) => c.status !== "disconnected"
  );
  const resolvedCustomMetric =
    customMetric ?? healthPayload?.customMetric ?? null;
  const missingCoreConnectorCount =
    Number(!posthogConnector) + Number(!stripeConnector);
  const resolvedContentView = contentView ?? "overview";
  const showConnectorStatusPanel =
    connectorLoading || connectorError !== null || activeConnectors.length > 0;
  const showPrimaryDashboard = activeWorkspace && startups.length > 0;
  const showEmptyWorkspaceState =
    activeWorkspace && startups.length === 0 && startupStatus === "ready";
  const showNoWorkspaceState = !activeWorkspace && shellStatus === "ready";

  const topAlert = alerts.length > 0 ? (alerts[0] ?? null) : null;
  const streakInfo: StreakInfo | null =
    alertStatus === "ready" && alerts.length === 0
      ? { currentDays: 0, longestDays: 0 }
      : null;
  const supportingMetrics = healthPayload?.health?.supportingMetrics ?? null;

  return (
    <AppShell
      activeStartupId={selectedStartupId}
      activeWorkspaceId={activeWorkspaceId}
      isSwitchingWorkspace={isSwitchingWorkspace}
      onActivateWorkspace={handleActivateWorkspace}
      onRetryShell={refreshShell}
      onRetryStartups={() => refreshStartups(activeWorkspaceId, "refreshing")}
      onSelectStartup={(startupId) => {
        void navigateToStartup?.(startupId, false);
      }}
      shellError={shellError}
      shellStatus={shellStatus}
      startupError={startupError}
      startupHealthById={startupHealthById}
      startupStatus={startupStatus}
      startups={startups}
      workspaceError={workspaceError}
      workspaces={workspaces}
    >
      <div className="grid gap-6">
        {showPrimaryDashboard ? (
          <>
            <ModeSwitcher
              onChange={onModeChange ?? ((_m: DashboardMode) => undefined)}
              value={mode}
            />

            {mode === "decide" ? (
              <section
                aria-labelledby="dashboard-content-heading"
                className="grid gap-4"
              >
                <DashboardContentHeader
                  contentView={resolvedContentView}
                  missingCoreConnectorCount={missingCoreConnectorCount}
                  onChangeView={setContentView}
                />

                <DecisionSurface
                  alert={topAlert}
                  error={alertError}
                  loading={alertStatus === "loading"}
                  onAck={handleTriageAck}
                  onInvestigate={(_alertId) => {
                    onModeChange?.("journal");
                  }}
                  onRetry={() => {
                    void refreshAlerts(selectedStartupId);
                  }}
                  onSnooze={handleTriageSnooze}
                  streak={streakInfo}
                  triaging={triaging}
                />

                {supportingMetrics && resolvedContentView === "overview" ? (
                  <StartupMetricsGrid metrics={supportingMetrics} />
                ) : null}

                {resolvedContentView === "overview" ? (
                  <DashboardOverviewPanel
                    creatingActionIndex={creatingActionIndex}
                    healthError={healthError}
                    healthPayload={healthPayload}
                    healthStatus={healthStatus}
                    insightError={insightError}
                    insightPayload={insightPayload}
                    insightStatus={insightStatus}
                    onCreateTask={handleCreateTaskFromAction}
                    onRetryInsight={() => {
                      void refreshInsight(selectedStartupId);
                    }}
                    onRetryTasks={() => {
                      void refreshTasks(selectedStartupId);
                    }}
                    primaryStartup={selectedStartup}
                    taskCreateError={taskCreateError}
                    taskListError={taskListError}
                    taskListStatus={taskListStatus}
                    tasks={tasks}
                  />
                ) : (
                  <DashboardHealthConnectorsPanel
                    activeConnectors={activeConnectors}
                    connectorError={connectorError}
                    connectorLoading={connectorLoading}
                    healthError={healthError}
                    healthPayload={healthPayload}
                    healthStatus={healthStatus}
                    onConnectProvider={handleConnectProvider}
                    onDisconnect={handleDisconnect}
                    onPostgresSetup={handlePostgresSetup}
                    onRefreshConnectors={() => {
                      void refreshConnectors(selectedStartupId);
                    }}
                    onResync={handleResync}
                    onRetryHealth={() => {
                      void refreshHealth(selectedStartupId);
                    }}
                    pgSetupSubmitting={pgSetupSubmitting}
                    postgresConnector={postgresConnector}
                    posthogConnector={posthogConnector}
                    resolvedCustomMetric={resolvedCustomMetric}
                    showConnectorStatusPanel={showConnectorStatusPanel}
                    stripeConnector={stripeConnector}
                  />
                )}
              </section>
            ) : null}

            {mode === "journal" ? (
              <section aria-label="Journal mode" className="grid gap-4">
                <p className="text-muted-foreground text-sm">
                  Journal mode — event log coming soon.
                </p>
              </section>
            ) : null}

            {mode === "compare" ? (
              <section aria-label="Compare mode" className="grid gap-4">
                <p className="text-muted-foreground text-sm">
                  Compare mode — startup comparison coming soon.
                </p>
              </section>
            ) : null}
          </>
        ) : null}

        {showEmptyWorkspaceState ? (
          <div className="grid gap-2">
            <p className="text-sm">
              No startups are attached to this workspace yet.
            </p>
            <a
              className="text-primary text-sm underline-offset-4 hover:underline"
              href="/app/onboarding"
            >
              Complete onboarding
            </a>
          </div>
        ) : null}

        {showNoWorkspaceState ? (
          <div className="grid gap-2">
            <p className="text-sm">
              Create or select a workspace to see your portfolio.
            </p>
            <a
              className="text-primary text-sm underline-offset-4 hover:underline"
              href="/app/onboarding"
            >
              Get started
            </a>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
