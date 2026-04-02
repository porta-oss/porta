import { useEffect, useMemo, useState } from 'react';
import { createRoute } from '@tanstack/react-router';

import type { ConnectorProvider, ConnectorSummary } from '@shared/connectors';
import type { CustomMetricSummary } from '@shared/custom-metric';
import { isCustomMetricStatus } from '@shared/custom-metric';
import type {
  FunnelStageRow,
  HealthSnapshotSummary,
  HealthState,
  SupportingMetricsSnapshot,
} from '@shared/startup-health';
import {
  emptySupportingMetrics,
  emptyFunnelStages,
  isHealthState,
  validateSupportingMetrics,
  validateFunnelStages,
} from '@shared/startup-health';
import type { InternalTaskPayload } from '@shared/internal-task';
import { isTaskSyncStatus } from '@shared/internal-task';
import type { LatestInsightPayload } from '@shared/startup-insight';
import {
  isInsightConditionCode,
  isInsightGenerationStatus,
  validateEvidencePacket,
  validateInsightExplanation,
} from '@shared/startup-insight';
import type { StartupRecord, WorkspaceSummary } from '@shared/types';

import { AppShell } from '../../components/app-shell';
import { ConnectorSetupCard } from '../../components/connector-setup-card';
import { ConnectorStatusPanel } from '../../components/connector-status-panel';
import { CustomMetricPanel } from '../../components/custom-metric-panel';
import { PortfolioStartupCard } from '../../components/portfolio-startup-card';
import { PostgresCustomMetricCard } from '../../components/postgres-custom-metric-card';
import type { PostgresSetupFormValues } from '../../components/postgres-custom-metric-card';
import { StartupFunnelPanel } from '../../components/startup-funnel-panel';
import { StartupHealthHero } from '../../components/startup-health-hero';
import { StartupInsightCard } from '../../components/startup-insight-card';
import type { InsightDisplayStatus } from '../../components/startup-insight-card-types';
import { StartupMetricsGrid } from '../../components/startup-metrics-grid';
import { StartupTaskList } from '../../components/startup-task-list';
import { API_BASE_URL, getErrorMessage, type AuthSnapshot } from '../../lib/auth-client';
import { buildPortfolioCardViewModel, buildPortfolioErrorViewModel } from '../../lib/portfolio-card';
import { authenticatedRoute } from '../_authenticated';

// ------------------------------------------------------------------
// API interface
// ------------------------------------------------------------------

/** Connector freshness surfaced alongside health. */
export interface ConnectorFreshness {
  provider: ConnectorProvider;
  status: ConnectorSummary['status'];
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/** Blocked reason from the health API. */
export interface BlockedReason {
  code: string;
  message: string;
}

/** Health payload returned by GET /startups/:id/health */
export interface StartupHealthPayload {
  health: HealthSnapshotSummary | null;
  connectors: ConnectorFreshness[];
  status: HealthState;
  blockedReasons: BlockedReason[];
  lastSnapshotAt: string | null;
  /** Optional custom metric from a Postgres prepared view. Null if not configured. */
  customMetric: CustomMetricSummary | null;
}

/** Insight payload returned by GET /startups/:id/insight */
export interface StartupInsightPayload {
  insight: LatestInsightPayload | null;
  displayStatus: InsightDisplayStatus;
  diagnosticMessage: string | null;
}

export interface DashboardApi {
  listWorkspaces: () => Promise<{ workspaces: WorkspaceSummary[]; activeWorkspaceId: string | null }>;
  setActiveWorkspace: (input: { workspaceId: string }) => Promise<{ activeWorkspaceId: string; workspace: WorkspaceSummary }>;
  listStartups: () => Promise<{ workspace: WorkspaceSummary; startups: StartupRecord[] }>;
  listConnectors: (startupId: string) => Promise<{ connectors: ConnectorSummary[] }>;
  createConnector: (startupId: string, provider: ConnectorProvider, config: Record<string, string>) => Promise<{ connector: ConnectorSummary }>;
  triggerSync: (connectorId: string) => Promise<void>;
  deleteConnector: (connectorId: string) => Promise<void>;
  fetchHealth: (startupId: string) => Promise<StartupHealthPayload>;
  fetchInsight: (startupId: string) => Promise<StartupInsightPayload>;
  listTasks: (startupId: string) => Promise<{ tasks: InternalTaskPayload[]; startupId: string; count: number }>;
  createTask: (startupId: string, actionIndex: number) => Promise<{ task: InternalTaskPayload; created: boolean }>;
  createPostgresMetric: (startupId: string, setup: PostgresSetupFormValues) => Promise<{ connector: ConnectorSummary; customMetric: CustomMetricSummary }>;
}

export interface DashboardPageProps {
  authState: AuthSnapshot;
  api?: DashboardApi;
}

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
    this.name = 'DashboardApiError';
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 4000;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.slug === 'string';
}

function isStartupRecord(value: unknown): value is StartupRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.stage === 'string' &&
    typeof value.timezone === 'string' &&
    typeof value.currency === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isConnectorSummary(value: unknown): value is ConnectorSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.startupId === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.status === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isInternalTaskPayload(value: unknown): value is InternalTaskPayload {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.startupId === 'string' &&
    typeof value.sourceInsightId === 'string' &&
    typeof value.sourceActionIndex === 'number' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.linkedMetricKeys) &&
    typeof value.syncStatus === 'string' &&
    isTaskSyncStatus(value.syncStatus) &&
    typeof value.createdAt === 'string'
  );
}

function isCustomMetricSummary(value: unknown): value is CustomMetricSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.startupId === 'string' &&
    typeof value.connectorId === 'string' &&
    typeof value.label === 'string' &&
    typeof value.unit === 'string' &&
    typeof value.schema === 'string' &&
    typeof value.view === 'string' &&
    typeof value.status === 'string' &&
    isCustomMetricStatus(value.status) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new DashboardApiError('REQUEST_TIMEOUT', 'The dashboard shell timed out while loading. Retry the bootstrap.')), timeoutMs);
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
  const normalizedPath = path.replace(/^\//, '');
  const response = await withTimeout(
    fetch(new URL(normalizedPath, `${API_BASE_URL}/`).toString(), {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {})
      }
    }),
    REQUEST_TIMEOUT_MS
  );

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    throw new DashboardApiError('MALFORMED_RESPONSE', 'The dashboard shell received a malformed response. Retry the bootstrap.');
  }

  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error)
      ? ({
          code: typeof payload.error.code === 'string' ? payload.error.code : `HTTP_${response.status}`,
          message:
            typeof payload.error.message === 'string'
              ? payload.error.message
              : 'The dashboard shell request could not be completed.'
        } satisfies DashboardApiErrorShape)
      : {
          code: `HTTP_${response.status}`,
          message: 'The dashboard shell request could not be completed.'
        };

    throw new DashboardApiError(error.code, error.message);
  }

  return payload;
}

// ------------------------------------------------------------------
// Default API implementation
// ------------------------------------------------------------------

function createDefaultDashboardApi(): DashboardApi {
  return {
    async listWorkspaces() {
      const payload = await requestJson('/workspaces');

      if (!isRecord(payload) || !Array.isArray(payload.workspaces) || !payload.workspaces.every(isWorkspaceSummary)) {
        throw new DashboardApiError('MALFORMED_WORKSPACE_CONTEXT', 'The dashboard shell could not parse the workspace context.');
      }

      return {
        workspaces: payload.workspaces,
        activeWorkspaceId: typeof payload.activeWorkspaceId === 'string' ? payload.activeWorkspaceId : null
      };
    },
    async setActiveWorkspace(input) {
      const payload = await requestJson('/workspaces/active', {
        method: 'POST',
        body: JSON.stringify(input)
      });

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || typeof payload.activeWorkspaceId !== 'string') {
        throw new DashboardApiError('MALFORMED_WORKSPACE_SWITCH', 'Workspace selection returned an unexpected shell payload.');
      }

      return {
        activeWorkspaceId: payload.activeWorkspaceId,
        workspace: payload.workspace
      };
    },
    async listStartups() {
      const payload = await requestJson('/startups');

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || !Array.isArray(payload.startups) || !payload.startups.every(isStartupRecord)) {
        throw new DashboardApiError('MALFORMED_STARTUP_LIST', 'The dashboard shell could not parse the startup list.');
      }

      return {
        workspace: payload.workspace,
        startups: payload.startups
      };
    },
    async listConnectors(startupId) {
      const payload = await requestJson(`/connectors?startupId=${encodeURIComponent(startupId)}`);

      if (!isRecord(payload) || !Array.isArray(payload.connectors) || !payload.connectors.every(isConnectorSummary)) {
        throw new DashboardApiError('MALFORMED_CONNECTOR_LIST', 'The dashboard shell could not parse the connector list.');
      }

      return { connectors: payload.connectors };
    },
    async createConnector(startupId, provider, config) {
      const payload = await requestJson('/connectors', {
        method: 'POST',
        body: JSON.stringify({ startupId, provider, config })
      });

      if (!isRecord(payload) || !isConnectorSummary(payload.connector)) {
        throw new DashboardApiError('MALFORMED_CONNECTOR_CREATE', 'Connector creation returned an unexpected response.');
      }

      return { connector: payload.connector };
    },
    async triggerSync(connectorId) {
      await requestJson(`/connectors/${encodeURIComponent(connectorId)}/sync`, {
        method: 'POST'
      });
    },
    async deleteConnector(connectorId) {
      await requestJson(`/connectors/${encodeURIComponent(connectorId)}`, {
        method: 'DELETE'
      });
    },
    async fetchHealth(startupId) {
      const payload = await requestJson(`/startups/${encodeURIComponent(startupId)}/health`);

      if (!isRecord(payload)) {
        throw new DashboardApiError('MALFORMED_HEALTH', 'Health response is not an object.');
      }

      // Validate the status field
      const status = typeof payload.status === 'string' && isHealthState(payload.status)
        ? payload.status
        : 'error';

      // Validate blockedReasons
      const blockedReasons: BlockedReason[] = [];
      if (Array.isArray(payload.blockedReasons)) {
        for (const r of payload.blockedReasons) {
          if (isRecord(r) && typeof r.code === 'string' && typeof r.message === 'string') {
            blockedReasons.push({ code: r.code, message: r.message });
          }
        }
      }

      const lastSnapshotAt = typeof payload.lastSnapshotAt === 'string' ? payload.lastSnapshotAt : null;

      // Validate health snapshot
      let health: HealthSnapshotSummary | null = null;
      if (isRecord(payload.health) && payload.health !== null) {
        const h = payload.health as Record<string, unknown>;
        const metricsError = validateSupportingMetrics(h.supportingMetrics);
        const funnelError = validateFunnelStages(h.funnel);

        if (metricsError || funnelError) {
          throw new DashboardApiError(
            'MALFORMED_HEALTH_SNAPSHOT',
            `Health snapshot contains invalid data: ${metricsError ?? funnelError ?? 'unknown'}.`,
          );
        }

        health = {
          startupId: typeof h.startupId === 'string' ? h.startupId : startupId,
          healthState: typeof h.healthState === 'string' && isHealthState(h.healthState) ? h.healthState : status,
          blockedReason: typeof h.blockedReason === 'string' ? h.blockedReason : null,
          northStarKey: 'mrr',
          northStarValue: typeof h.northStarValue === 'number' ? h.northStarValue : 0,
          northStarPreviousValue: typeof h.northStarPreviousValue === 'number' ? h.northStarPreviousValue : null,
          supportingMetrics: h.supportingMetrics as SupportingMetricsSnapshot,
          funnel: h.funnel as FunnelStageRow[],
          computedAt: typeof h.computedAt === 'string' ? h.computedAt : new Date().toISOString(),
          syncJobId: typeof h.syncJobId === 'string' ? h.syncJobId : null,
        };
      }

      // Validate connector freshness
      const connectors: ConnectorFreshness[] = [];
      if (Array.isArray(payload.connectors)) {
        for (const c of payload.connectors) {
          if (isRecord(c) && typeof c.provider === 'string' && typeof c.status === 'string') {
            connectors.push({
              provider: c.provider as ConnectorProvider,
              status: c.status as ConnectorSummary['status'],
              lastSyncAt: typeof c.lastSyncAt === 'string' ? c.lastSyncAt : null,
              lastSyncError: typeof c.lastSyncError === 'string' ? c.lastSyncError : null,
            });
          }
        }
      }

      // Validate optional custom metric
      let customMetric: CustomMetricSummary | null = null;
      if (isRecord(payload.customMetric) && payload.customMetric !== null) {
        if (isCustomMetricSummary(payload.customMetric)) {
          customMetric = payload.customMetric;
        }
      }

      return { health, connectors, status, blockedReasons, lastSnapshotAt, customMetric };
    },
    async fetchInsight(startupId) {
      const payload = await requestJson(`/startups/${encodeURIComponent(startupId)}/insight`);

      if (!isRecord(payload)) {
        throw new DashboardApiError('MALFORMED_INSIGHT', 'Insight response is not an object.');
      }

      // Validate display status
      const displayStatus = typeof payload.displayStatus === 'string'
        && ['ready', 'unavailable', 'blocked', 'error'].includes(payload.displayStatus)
        ? payload.displayStatus as InsightDisplayStatus
        : 'error';

      const diagnosticMessage = typeof payload.diagnosticMessage === 'string'
        ? payload.diagnosticMessage
        : null;

      // Validate insight payload
      let insight: LatestInsightPayload | null = null;
      if (isRecord(payload.insight) && payload.insight !== null) {
        const ins = payload.insight as Record<string, unknown>;

        // Validate condition code
        if (typeof ins.conditionCode !== 'string' || !isInsightConditionCode(ins.conditionCode)) {
          throw new DashboardApiError('MALFORMED_INSIGHT', `Invalid condition code in insight: ${String(ins.conditionCode)}`);
        }

        // Validate evidence
        const evidenceErr = validateEvidencePacket(ins.evidence);
        if (evidenceErr) {
          throw new DashboardApiError('MALFORMED_INSIGHT', `Invalid evidence in insight: ${evidenceErr}`);
        }

        // Validate generation status
        if (typeof ins.generationStatus !== 'string' || !isInsightGenerationStatus(ins.generationStatus)) {
          throw new DashboardApiError('MALFORMED_INSIGHT', `Invalid generation status: ${String(ins.generationStatus)}`);
        }

        // Validate explanation (nullable)
        let explanation: import('@shared/startup-insight').InsightExplanation | null = null;
        if (ins.explanation !== null && ins.explanation !== undefined) {
          const explErr = validateInsightExplanation(ins.explanation);
          if (explErr) {
            throw new DashboardApiError('MALFORMED_INSIGHT', `Invalid explanation: ${explErr}`);
          }
          explanation = ins.explanation as import('@shared/startup-insight').InsightExplanation;
        }

        insight = {
          startupId: typeof ins.startupId === 'string' ? ins.startupId : startupId,
          conditionCode: ins.conditionCode,
          evidence: ins.evidence as import('@shared/startup-insight').EvidencePacket,
          explanation,
          generationStatus: ins.generationStatus,
          generatedAt: typeof ins.generatedAt === 'string' ? ins.generatedAt : new Date().toISOString(),
          lastError: typeof ins.lastError === 'string' ? ins.lastError : null,
        };
      }

      return { insight, displayStatus, diagnosticMessage };
    },
    async listTasks(startupId) {
      const payload = await requestJson(`/tasks?startupId=${encodeURIComponent(startupId)}`);

      if (!isRecord(payload) || !Array.isArray(payload.tasks) || !payload.tasks.every(isInternalTaskPayload)) {
        throw new DashboardApiError('MALFORMED_TASK_LIST', 'The dashboard could not parse the task list.');
      }

      return {
        tasks: payload.tasks,
        startupId: typeof payload.startupId === 'string' ? payload.startupId : startupId,
        count: typeof payload.count === 'number' ? payload.count : payload.tasks.length,
      };
    },
    async createTask(startupId, actionIndex) {
      const payload = await requestJson('/tasks', {
        method: 'POST',
        body: JSON.stringify({ startupId, actionIndex }),
      });

      if (!isRecord(payload) || !isInternalTaskPayload(payload.task)) {
        throw new DashboardApiError('MALFORMED_TASK_CREATE', 'Task creation returned an unexpected response.');
      }

      return {
        task: payload.task,
        created: payload.created === true,
      };
    },
    async createPostgresMetric(startupId, setup) {
      const payload = await requestJson('/connectors', {
        method: 'POST',
        body: JSON.stringify({
          startupId,
          provider: 'postgres',
          config: {
            connectionUri: setup.connectionUri,
            schema: setup.schema,
            view: setup.view,
            label: setup.label,
            unit: setup.unit,
          },
        }),
      });

      if (!isRecord(payload) || !isConnectorSummary(payload.connector)) {
        throw new DashboardApiError('MALFORMED_POSTGRES_SETUP', 'Postgres metric setup returned an unexpected response.');
      }

      const customMetric = isRecord(payload.customMetric) && isCustomMetricSummary(payload.customMetric)
        ? payload.customMetric
        : null;

      if (!customMetric) {
        throw new DashboardApiError('MALFORMED_POSTGRES_SETUP', 'Postgres metric setup did not return the custom metric definition.');
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

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------

export const dashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'app',
  component: DashboardRouteComponent
});

function DashboardRouteComponent() {
  const authState = dashboardRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot
  });

  return <DashboardPage authState={authState} />;
}

// ------------------------------------------------------------------
// Page component
// ------------------------------------------------------------------

export function DashboardPage({ authState, api = createDefaultDashboardApi() }: DashboardPageProps) {
  const [shellStatus, setShellStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [startupStatus, setStartupStatus] = useState<'idle' | 'loading' | 'refreshing' | 'ready' | 'error'>('idle');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(authState.session?.session.activeOrganizationId ?? null);
  const [startups, setStartups] = useState<StartupRecord[]>([]);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  // Health state
  const [healthPayload, setHealthPayload] = useState<StartupHealthPayload | null>(null);
  const [healthStatus, setHealthStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [healthError, setHealthError] = useState<string | null>(null);

  // Insight state
  const [insightPayload, setInsightPayload] = useState<StartupInsightPayload | null>(null);
  const [insightStatus, setInsightStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [insightError, setInsightError] = useState<string | null>(null);

  // Task state — independent from health/insight
  const [tasks, setTasks] = useState<InternalTaskPayload[]>([]);
  const [taskListStatus, setTaskListStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [taskListError, setTaskListError] = useState<string | null>(null);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);
  const [creatingActionIndex, setCreatingActionIndex] = useState<number | null>(null);

  // Custom metric state
  const [customMetric, setCustomMetric] = useState<CustomMetricSummary | null>(null);
  const [pgSetupError, setPgSetupError] = useState<string | null>(null);
  const [pgSetupSubmitting, setPgSetupSubmitting] = useState(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces]
  );

  const primaryStartup = startups[0] ?? null;

  // Determine which providers already have a connector
  const posthogConnector = connectors.find((c) => c.provider === 'posthog' && c.status !== 'disconnected') ?? null;
  const stripeConnector = connectors.find((c) => c.provider === 'stripe' && c.status !== 'disconnected') ?? null;
  const postgresConnector = connectors.find((c) => c.provider === 'postgres' && c.status !== 'disconnected') ?? null;

  async function refreshConnectors(startupId: string | null) {
    if (!startupId || !api.listConnectors) {
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
      setConnectorError(getDashboardErrorMessage(error, 'Failed to load connectors.'));
    } finally {
      setConnectorLoading(false);
    }
  }

  async function refreshHealth(startupId: string | null) {
    if (!startupId) {
      setHealthPayload(null);
      setHealthStatus('idle');
      return;
    }

    setHealthStatus('loading');
    setHealthError(null);

    try {
      const payload = await api.fetchHealth(startupId);
      setHealthPayload(payload);
      setCustomMetric(payload.customMetric);
      setHealthStatus('ready');
    } catch (error) {
      // Preserve the previous payload so stale data stays visible
      setHealthError(getDashboardErrorMessage(error, 'Failed to load startup health data.'));
      setHealthStatus('error');
    }
  }

  async function refreshInsight(startupId: string | null) {
    if (!startupId) {
      setInsightPayload(null);
      setInsightStatus('idle');
      return;
    }

    setInsightStatus('loading');
    setInsightError(null);

    try {
      const payload = await api.fetchInsight(startupId);
      setInsightPayload(payload);
      setInsightStatus('ready');
    } catch (error) {
      // Preserve the previous insight payload for last-good semantics
      setInsightError(getDashboardErrorMessage(error, 'Failed to load insight data.'));
      setInsightStatus('error');
    }
  }

  async function refreshTasks(startupId: string | null) {
    if (!startupId) {
      setTasks([]);
      setTaskListStatus('idle');
      return;
    }

    setTaskListStatus('loading');
    setTaskListError(null);

    try {
      const payload = await api.listTasks(startupId);
      setTasks(payload.tasks);
      setTaskListStatus('ready');
    } catch (error) {
      setTaskListError(getDashboardErrorMessage(error, 'Failed to load tasks.'));
      setTaskListStatus('error');
    }
  }

  async function handleCreateTaskFromAction(actionIndex: number) {
    if (!primaryStartup || creatingActionIndex !== null) return;

    setCreatingActionIndex(actionIndex);
    setTaskCreateError(null);

    try {
      const result = await api.createTask(primaryStartup.id, actionIndex);
      // Merge the new/updated task into local state
      setTasks((prev) => {
        const exists = prev.some((t) => t.id === result.task.id);
        if (exists) {
          return prev.map((t) => (t.id === result.task.id ? result.task : t));
        }
        return [...prev, result.task];
      });
    } catch (error) {
      setTaskCreateError(getDashboardErrorMessage(error, 'Failed to create task.'));
    } finally {
      setCreatingActionIndex(null);
    }
  }

  async function refreshStartups(workspaceId: string | null, mode: 'loading' | 'refreshing' = 'loading') {
    setStartupError(null);

    if (!workspaceId) {
      setStartups([]);
      setConnectors([]);
      setStartupStatus('ready');
      return;
    }

    setStartupStatus(mode);

    try {
      const startupState = await api.listStartups();

      if (startupState.workspace.id !== workspaceId) {
        throw new DashboardApiError('WORKSPACE_SCOPE_MISMATCH', 'The dashboard shell received startup data for the wrong workspace.');
      }

      setStartups(startupState.startups);
      setStartupStatus('ready');

      // Load connectors and health for the primary startup
      const primaryId = startupState.startups[0]?.id ?? null;
      await refreshConnectors(primaryId);
      await refreshHealth(primaryId);
      await refreshInsight(primaryId);
      await refreshTasks(primaryId);
    } catch (error) {
      setStartups([]);
      setConnectors([]);
      setStartupError(getDashboardErrorMessage(error, 'Startup navigation failed to load. Retry from the shell.'));
      setStartupStatus('error');
    }
  }

  async function refreshShell() {
    setShellStatus('loading');
    setShellError(null);
    setWorkspaceError(null);

    try {
      const workspaceState = await api.listWorkspaces();
      setWorkspaces(workspaceState.workspaces);
      setActiveWorkspaceId(workspaceState.activeWorkspaceId);
      setShellStatus('ready');
      await refreshStartups(workspaceState.activeWorkspaceId, 'loading');
    } catch (error) {
      setShellError(getDashboardErrorMessage(error, 'The dashboard shell could not be bootstrapped. Retry the workspace lookup.'));
      setStartupStatus('idle');
      setShellStatus('error');
    }
  }

  useEffect(() => {
    void refreshShell();
  }, []);

  async function handleActivateWorkspace(workspaceId: string) {
    setWorkspaceError(null);
    setIsSwitchingWorkspace(true);

    try {
      const response = await api.setActiveWorkspace({ workspaceId });
      setActiveWorkspaceId(response.activeWorkspaceId);
      await refreshStartups(response.activeWorkspaceId, 'loading');
    } catch (error) {
      setWorkspaceError(getDashboardErrorMessage(error, 'Workspace switching failed. Retry from the shell.'));
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }

  async function handleConnectProvider(provider: ConnectorProvider, config: Record<string, string>) {
    if (!primaryStartup) return;

    try {
      const result = await api.createConnector(primaryStartup.id, provider, config);
      setConnectors((current) => [...current.filter((c) => c.provider !== provider), result.connector]);
    } catch (error) {
      throw error; // Let the card component handle the error display
    }
  }

  async function handleResync(connectorId: string) {
    await api.triggerSync(connectorId);
    // Refresh connectors to show updated status
    if (primaryStartup) {
      await refreshConnectors(primaryStartup.id);
    }
  }

  async function handleDisconnect(connectorId: string) {
    await api.deleteConnector(connectorId);
    // Refresh connectors to reflect disconnected state
    if (primaryStartup) {
      await refreshConnectors(primaryStartup.id);
    }
  }

  async function handlePostgresSetup(values: PostgresSetupFormValues) {
    if (!primaryStartup) return;

    setPgSetupError(null);
    setPgSetupSubmitting(true);

    try {
      const result = await api.createPostgresMetric(primaryStartup.id, values);
      setConnectors((current) => [...current.filter((c) => c.provider !== 'postgres'), result.connector]);
      setCustomMetric(result.customMetric);
    } catch (error) {
      // Re-throw to let the card component show the error
      throw error;
    } finally {
      setPgSetupSubmitting(false);
    }
  }

  // Filter active connectors for the status panel
  const activeConnectors = connectors.filter((c) => c.status !== 'disconnected');

  return (
    <AppShell
      user={{
        email: authState.session?.user.email ?? 'founder@example.com',
        name: authState.session?.user.name ?? null
      }}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      startups={startups}
      shellStatus={shellStatus}
      startupStatus={startupStatus}
      shellError={shellError}
      workspaceError={workspaceError}
      startupError={startupError}
      isSwitchingWorkspace={isSwitchingWorkspace}
      onRetryShell={refreshShell}
      onRetryStartups={() => refreshStartups(activeWorkspaceId, 'refreshing')}
      onActivateWorkspace={handleActivateWorkspace}
    >
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {/* ── Portfolio prioritization surface ── */}
        <div>
          <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280' }}>
            Portfolio
          </p>
          <h2 style={{ margin: '0.35rem 0 0' }}>Startup prioritization</h2>
        </div>

        {activeWorkspace && startups.length > 0 ? (
          <>
            {/* Portfolio card — the primary founder-facing representation */}
            {healthStatus === 'ready' && healthPayload && primaryStartup ? (
              <PortfolioStartupCard viewModel={buildPortfolioCardViewModel(primaryStartup, healthPayload)} />
            ) : null}
            {healthStatus === 'error' && primaryStartup ? (
              <PortfolioStartupCard viewModel={buildPortfolioErrorViewModel(primaryStartup, healthError ?? 'Failed to load startup health data.')} />
            ) : null}
            {healthStatus === 'loading' && primaryStartup ? (
              <section
                aria-label="portfolio startup card"
                data-testid="portfolio-startup-card"
                style={{
                  display: 'grid',
                  gap: '0.75rem',
                  padding: '1.25rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: '1rem',
                  background: '#ffffff',
                }}
              >
                <p role="status" style={{ margin: 0, color: '#6b7280' }}>Loading portfolio…</p>
              </section>
            ) : null}

            {/* Health error banner — preserves connector panel and shell */}
            {healthStatus === 'error' ? (
              <section
                aria-label="health error"
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  padding: '1rem',
                  border: '1px solid #fecaca',
                  borderRadius: '0.75rem',
                  background: '#fef2f2',
                }}
              >
                <p role="alert" style={{ margin: 0, color: '#991b1b' }}>
                  {healthError ?? 'Failed to load startup health data.'}
                </p>
                <button type="button" onClick={() => void refreshHealth(primaryStartup?.id ?? null)}>
                  Retry health load
                </button>
              </section>
            ) : null}

            {/* ── Grounded Insight ── */}
            {insightStatus === 'ready' && insightPayload ? (
              <StartupInsightCard
                insight={insightPayload.insight}
                displayStatus={insightPayload.displayStatus}
                diagnosticMessage={insightPayload.diagnosticMessage}
                onRetry={() => void refreshInsight(primaryStartup?.id ?? null)}
                tasks={tasks}
                creatingActionIndex={creatingActionIndex}
                taskCreateError={taskCreateError}
                onCreateTask={handleCreateTaskFromAction}
              />
            ) : null}
            {insightStatus === 'error' ? (
              <section
                aria-label="insight error"
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  padding: '1rem',
                  border: '1px solid #fecaca',
                  borderRadius: '0.75rem',
                  background: '#fef2f2',
                }}
              >
                <p role="alert" style={{ margin: 0, color: '#991b1b' }}>
                  {insightError ?? 'Failed to load insight data.'}
                </p>
                <button type="button" onClick={() => void refreshInsight(primaryStartup?.id ?? null)}>
                  Retry insight load
                </button>
              </section>
            ) : null}
            {insightStatus === 'loading' ? (
              <p role="status" style={{ margin: 0, color: '#6b7280' }}>Loading insight…</p>
            ) : null}

            {/* ── Tasks ── */}
            <StartupTaskList
              tasks={tasks}
              status={taskListStatus}
              error={taskListError}
              onRetry={() => void refreshTasks(primaryStartup?.id ?? null)}
            />

            {/* ── Health & connector drill-down ── */}
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1.25rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280' }}>
                Health detail
              </p>
            </div>

            {/* Health hero: show when we have health data or when blocked/syncing */}
            {healthStatus === 'ready' && healthPayload ? (
              <>
                <StartupHealthHero
                  healthState={healthPayload.status}
                  northStarKey={healthPayload.health?.northStarKey ?? 'mrr'}
                  northStarValue={healthPayload.health?.northStarValue ?? 0}
                  northStarPreviousValue={healthPayload.health?.northStarPreviousValue ?? null}
                  lastSnapshotAt={healthPayload.lastSnapshotAt}
                  blockedReasons={healthPayload.blockedReasons}
                />

                {/* Supporting metrics grid — show even when stale with muted styling */}
                {healthPayload.health ? (
                  <>
                    <StartupMetricsGrid
                      metrics={healthPayload.health.supportingMetrics}
                      muted={healthPayload.status === 'stale' || healthPayload.status === 'blocked'}
                    />
                    <StartupFunnelPanel
                      stages={healthPayload.health.funnel}
                      muted={healthPayload.status === 'stale' || healthPayload.status === 'blocked'}
                    />
                  </>
                ) : null}

                {/* Stale state guidance */}
                {healthPayload.status === 'stale' ? (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#92400e' }}>
                    Health data is stale. Resync your connectors below to refresh metrics.
                  </p>
                ) : null}

                {/* Optional custom metric — shown beneath the fixed health template */}
                <CustomMetricPanel
                  customMetric={customMetric ?? healthPayload.customMetric}
                  healthError={false}
                />
              </>
            ) : null}

            {/* Custom metric panel when health errored but we have a previous custom metric */}
            {healthStatus === 'error' && customMetric ? (
              <CustomMetricPanel
                customMetric={customMetric}
                healthError={true}
              />
            ) : null}

            {/* Loading state */}
            {healthStatus === 'loading' ? (
              <p role="status" style={{ margin: 0, color: '#6b7280' }}>Loading health data…</p>
            ) : null}

            {/* Connector status panel */}
            <ConnectorStatusPanel
              connectors={activeConnectors}
              loading={connectorLoading}
              error={connectorError}
              onResync={handleResync}
              onDisconnect={handleDisconnect}
              onRefresh={() => void refreshConnectors(primaryStartup?.id ?? null)}
            />

            {/* Connect missing providers */}
            {!posthogConnector ? (
              <ConnectorSetupCard
                provider="posthog"
                existing={null}
                onConnect={handleConnectProvider}
              />
            ) : null}
            {!stripeConnector ? (
              <ConnectorSetupCard
                provider="stripe"
                existing={null}
                onConnect={handleConnectProvider}
              />
            ) : null}

            {/* Optional Postgres custom metric setup — post-onboarding */}
            {!postgresConnector ? (
              <PostgresCustomMetricCard
                existing={null}
                disabled={pgSetupSubmitting}
                onSetup={handlePostgresSetup}
              />
            ) : (
              <PostgresCustomMetricCard
                existing={customMetric}
                disabled={pgSetupSubmitting}
                onSetup={handlePostgresSetup}
              />
            )}
          </>
        ) : null}

        {activeWorkspace && startups.length === 0 && startupStatus === 'ready' ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ margin: 0 }}>No startups are attached to this workspace yet.</p>
            <a href="/app/onboarding">Complete onboarding</a>
          </div>
        ) : null}

        {!activeWorkspace && shellStatus === 'ready' ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ margin: 0 }}>Create or select a workspace before the dashboard can load scoped product data.</p>
            <a href="/app/onboarding">Open workspace onboarding</a>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
