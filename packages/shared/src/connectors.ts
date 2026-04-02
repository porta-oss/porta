// Connector provider and status contracts shared across API, worker, and UI.

export const CONNECTOR_PROVIDERS = ['posthog', 'stripe', 'postgres'] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const CONNECTOR_STATUSES = ['pending', 'connected', 'error', 'disconnected'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export const SYNC_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number];

export const SYNC_TRIGGERS = ['initial', 'manual', 'scheduled'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

/** Shape returned to the UI — never includes raw credentials. */
export interface ConnectorSummary {
  id: string;
  startupId: string;
  provider: ConnectorProvider;
  status: ConnectorStatus;
  lastSyncAt: string | null;
  lastSyncDurationMs: number | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Shape of a sync-job row exposed through the API. */
export interface SyncJobSummary {
  id: string;
  connectorId: string;
  status: SyncJobStatus;
  trigger: SyncTrigger;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

/** Payload carried on the BullMQ queue — reference IDs only, never credentials. */
export interface SyncJobPayload {
  connectorId: string;
  startupId: string;
  provider: ConnectorProvider;
  trigger: SyncTrigger;
  syncJobId: string;
}

/** Result of a provider validation call — shared across API and worker. */
export interface ProviderValidationResult {
  valid: boolean;
  error?: string;
  retryable?: boolean;
}

export function isConnectorProvider(value: string): value is ConnectorProvider {
  return CONNECTOR_PROVIDERS.includes(value as ConnectorProvider);
}

export function isConnectorStatus(value: string): value is ConnectorStatus {
  return CONNECTOR_STATUSES.includes(value as ConnectorStatus);
}

export function isSyncJobStatus(value: string): value is SyncJobStatus {
  return SYNC_JOB_STATUSES.includes(value as SyncJobStatus);
}

export function isSyncTrigger(value: string): value is SyncTrigger {
  return SYNC_TRIGGERS.includes(value as SyncTrigger);
}
