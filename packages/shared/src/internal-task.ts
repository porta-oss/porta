// Internal-task contract shared across API, worker, and UI.
// Defines the founder-visible task derived from an insight action,
// including startup linkage, source insight/action metadata,
// linked metric keys, and Linear sync status.
//
// The API persists tasks; the worker syncs to Linear; the UI renders.
// Never persist or expose Linear API keys, raw GraphQL headers,
// or secret response payloads in task data.

// ---------------------------------------------------------------------------
// Sync status — tracks Linear sync state for the task
// ---------------------------------------------------------------------------

export const TASK_SYNC_STATUSES = [
  "not_synced",
  "queued",
  "syncing",
  "synced",
  "failed",
] as const;
export type TaskSyncStatus = (typeof TASK_SYNC_STATUSES)[number];

export function isTaskSyncStatus(value: string): value is TaskSyncStatus {
  return TASK_SYNC_STATUSES.includes(value as TaskSyncStatus);
}

// ---------------------------------------------------------------------------
// Internal task payload — returned by the API, consumed by the UI
// ---------------------------------------------------------------------------

/** A single internal task derived from an insight action. */
export interface InternalTaskPayload {
  /** ISO timestamp when the task was created. */
  createdAt: string;
  /** Task description — derived from the insight action rationale. */
  description: string;
  /** Task row ID. */
  id: string;
  /** ISO timestamp of the last sync attempt, null before first attempt. */
  lastSyncAttemptAt: string | null;
  /** Last sync error message, null on success or before sync. */
  lastSyncError: string | null;
  /** External Linear issue ID, null until synced. */
  linearIssueId: string | null;
  /** Metric keys from the insight evidence packet linked to this task. */
  linkedMetricKeys: string[];
  /** Zero-based index into the insight explanation actions array. */
  sourceActionIndex: number;
  /** ID of the source insight row that produced the action. */
  sourceInsightId: string;
  /** The startup this task belongs to. */
  startupId: string;
  /** Current sync status for Linear delivery. */
  syncStatus: TaskSyncStatus;
  /** Task title — derived from the insight action label. */
  title: string;
}

// ---------------------------------------------------------------------------
// Create-task input — what the API accepts from the founder
// ---------------------------------------------------------------------------

/** Input for creating a task from an insight action. */
export interface CreateTaskInput {
  /** Zero-based index into the latest insight's explanation.actions array. */
  actionIndex: number;
  /** Startup ID scoping the task. */
  startupId: string;
}
