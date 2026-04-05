// Startup health read-model helpers.
// Loads the latest persisted health snapshot and connector freshness
// for a given startup, then produces an explicit health status payload.
//
// The route handler calls `loadStartupHealth` which joins snapshot +
// connector data and returns one of: blocked, syncing, ready, stale.
// Missing connectors, stale syncs, and failed syncs produce explicit
// blocked-state reasons instead of blank metrics.

import type { ConnectorProvider, ConnectorStatus } from "@shared/connectors";
import type { CustomMetricSummary } from "@shared/custom-metric";
import { isCustomMetricCategory } from "@shared/custom-metric";
import type {
  FunnelStageRow,
  HealthSnapshotSummary,
  HealthState,
} from "@shared/startup-health";
import { isHealthState } from "@shared/startup-health";
import type { UniversalMetrics } from "@shared/universal-metrics";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Freshness window — a snapshot older than this is considered stale. */
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Per-connector freshness summary surfaced alongside health. */
export interface ConnectorFreshness {
  lastSyncAt: string | null;
  lastSyncError: string | null;
  provider: ConnectorProvider;
  status: ConnectorStatus;
}

/** Blocked reason produced when connectors are missing or unhealthy. */
export interface BlockedReason {
  code: string;
  message: string;
}

/** Full payload returned by the startup-health route. */
export interface StartupHealthPayload {
  blockedReasons: BlockedReason[];
  connectors: ConnectorFreshness[];
  /** Optional custom metric from a Postgres prepared view. Null if not configured. */
  customMetric: CustomMetricSummary | null;
  health: HealthSnapshotSummary | null;
  lastSnapshotAt: string | null;
  status: HealthState;
}

/** Minimal DB interface — works with any Drizzle instance. */
interface HealthDb {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

// ---------------------------------------------------------------------------
// DB reads
// ---------------------------------------------------------------------------

interface SnapshotRow {
  blocked_reason: string | null;
  computed_at: string | Date;
  health_state: string;
  id: string;
  north_star_key: string;
  north_star_previous_value: number | null;
  north_star_value: number;
  startup_id: string;
  supporting_metrics: unknown;
  sync_job_id: string | null;
}

interface FunnelRow {
  label: string;
  position: number;
  stage: string;
  value: number;
}

interface ConnectorRow {
  last_sync_at: string | Date | null;
  last_sync_error: string | null;
  provider: string;
  status: string;
}

async function loadLatestSnapshot(
  db: HealthDb,
  startupId: string
): Promise<SnapshotRow | null> {
  const result = await db.execute(
    sql`SELECT id, startup_id, health_state, blocked_reason,
               north_star_key, north_star_value, north_star_previous_value,
               supporting_metrics, sync_job_id, computed_at
        FROM health_snapshot
        WHERE startup_id = ${startupId}
        LIMIT 1`
  );
  const row = result.rows[0] as SnapshotRow | undefined;
  return row ?? null;
}

async function loadFunnelStages(
  db: HealthDb,
  startupId: string
): Promise<FunnelRow[]> {
  const result = await db.execute(
    sql`SELECT stage, label, value, position
        FROM health_funnel_stage
        WHERE startup_id = ${startupId}
        ORDER BY position ASC`
  );
  return result.rows as FunnelRow[];
}

async function loadConnectorFreshness(
  db: HealthDb,
  startupId: string
): Promise<ConnectorRow[]> {
  const result = await db.execute(
    sql`SELECT provider, status, last_sync_at, last_sync_error
        FROM connector
        WHERE startup_id = ${startupId}
        ORDER BY provider ASC`
  );
  return result.rows as ConnectorRow[];
}

interface CustomMetricDbRow {
  captured_at: string | Date | null;
  category: string | null;
  connector_id: string;
  created_at: string | Date;
  delta: string | null;
  id: string;
  key: string | null;
  label: string;
  metric_value: string | null;
  previous_value: string | null;
  startup_id: string;
  unit: string;
  updated_at: string | Date;
}

async function loadCustomMetric(
  db: HealthDb,
  startupId: string
): Promise<CustomMetricDbRow | null> {
  const result = await db.execute(
    sql`SELECT id, startup_id, connector_id, key, category, label, unit,
               metric_value, previous_value, delta, captured_at, created_at, updated_at
        FROM custom_metric
        WHERE startup_id = ${startupId}
        LIMIT 1`
  );
  const row = result.rows[0] as CustomMetricDbRow | undefined;
  return row ?? null;
}

function serializeCustomMetricRow(row: CustomMetricDbRow): CustomMetricSummary {
  const metricValue =
    row.metric_value === null ? null : Number.parseFloat(row.metric_value);
  const previousValue =
    row.previous_value === null ? null : Number.parseFloat(row.previous_value);
  let delta: number | null = null;
  if (row.delta != null) {
    delta = Number.parseFloat(row.delta);
  } else if (metricValue != null && previousValue != null) {
    delta = metricValue - previousValue;
  }

  return {
    id: row.id,
    startupId: row.startup_id,
    connectorId: row.connector_id,
    key: row.key ?? "",
    category: (isCustomMetricCategory(row.category ?? "")
      ? row.category
      : "custom") as CustomMetricSummary["category"],
    label: row.label,
    unit: row.unit,
    metricValue,
    previousValue,
    delta,
    capturedAt: toIsoString(row.captured_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Serialization + state computation
// ---------------------------------------------------------------------------

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function requireIsoString(
  value: string | Date | null | undefined,
  fieldName: string
): string {
  const isoString = toIsoString(value);

  if (!isoString) {
    throw new Error(`Expected ${fieldName} to be present.`);
  }

  return isoString;
}

function serializeFunnelRows(rows: FunnelRow[]): FunnelStageRow[] {
  return rows.map((row) => ({
    key: row.stage,
    label: row.label,
    value: row.value,
    position: row.position,
  }));
}

function serializeConnectors(rows: ConnectorRow[]): ConnectorFreshness[] {
  return rows.map((row) => ({
    provider: row.provider as ConnectorProvider,
    status: row.status as ConnectorStatus,
    lastSyncAt: toIsoString(row.last_sync_at),
    lastSyncError: row.last_sync_error,
  }));
}

function computeBlockedReasons(
  connectors: ConnectorFreshness[],
  snapshot: SnapshotRow | null
): BlockedReason[] {
  const reasons: BlockedReason[] = [];

  // No connectors at all
  if (connectors.length === 0) {
    reasons.push({
      code: "NO_CONNECTORS",
      message:
        "No data connectors are configured. Connect PostHog or Stripe to populate health metrics.",
    });
    return reasons;
  }

  // Check for disconnected or errored connectors
  for (const conn of connectors) {
    if (conn.status === "disconnected") {
      reasons.push({
        code: "CONNECTOR_DISCONNECTED",
        message: `The ${conn.provider} connector is disconnected. Reconnect it to resume syncing.`,
      });
    }
    if (conn.status === "error") {
      reasons.push({
        code: "CONNECTOR_ERROR",
        message: `The ${conn.provider} connector has a sync error: ${conn.lastSyncError ?? "unknown error"}.`,
      });
    }
  }

  // All connectors still pending (no sync has run yet)
  const allPending = connectors.every((c) => c.status === "pending");
  if (allPending && !snapshot) {
    reasons.push({
      code: "AWAITING_FIRST_SYNC",
      message:
        "Connectors are configured but the first sync has not completed yet.",
    });
  }

  return reasons;
}

function computeHealthState(
  snapshot: SnapshotRow | null,
  connectors: ConnectorFreshness[],
  blockedReasons: BlockedReason[]
): HealthState {
  // No snapshot yet
  if (!snapshot) {
    // If connectors exist and are pending, we're syncing
    if (
      connectors.length > 0 &&
      connectors.some((c) => c.status === "pending")
    ) {
      return "syncing";
    }
    return "blocked";
  }

  // If we have hard blocked reasons, respect them
  if (blockedReasons.length > 0) {
    // If snapshot state was explicitly set to a non-blocked state but connectors
    // are all disconnected/error, override to blocked
    const allBad =
      connectors.length > 0 &&
      connectors.every(
        (c) => c.status === "disconnected" || c.status === "error"
      );
    if (allBad) {
      return "stale";
    }
  }

  // Check freshness
  const computedAt =
    snapshot.computed_at instanceof Date
      ? snapshot.computed_at.getTime()
      : new Date(snapshot.computed_at).getTime();
  const age = Date.now() - computedAt;
  if (age > FRESHNESS_WINDOW_MS) {
    return "stale";
  }

  // Trust the persisted state
  const persistedState = snapshot.health_state;
  if (isHealthState(persistedState)) {
    return persistedState;
  }

  // Unknown state — treat as error
  return "error";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the full startup health payload for a given startup.
 * Joins the latest snapshot, funnel stages, and connector freshness.
 * Returns an explicit health state with blocked reasons.
 */
export async function loadStartupHealth(
  db: HealthDb,
  startupId: string
): Promise<StartupHealthPayload> {
  const [snapshot, funnelRows, connectorRows, customMetricRow] =
    await Promise.all([
      loadLatestSnapshot(db, startupId),
      loadFunnelStages(db, startupId),
      loadConnectorFreshness(db, startupId),
      loadCustomMetric(db, startupId),
    ]);

  const connectors = serializeConnectors(connectorRows);
  const blockedReasons = computeBlockedReasons(connectors, snapshot);
  const status = computeHealthState(snapshot, connectors, blockedReasons);

  const customMetric = customMetricRow
    ? serializeCustomMetricRow(customMetricRow)
    : null;

  if (!snapshot) {
    return {
      health: null,
      connectors,
      status,
      blockedReasons,
      lastSnapshotAt: null,
      customMetric,
    };
  }

  const supportingMetrics =
    typeof snapshot.supporting_metrics === "object" &&
    snapshot.supporting_metrics !== null
      ? (snapshot.supporting_metrics as UniversalMetrics)
      : null;

  const funnel = serializeFunnelRows(funnelRows);

  const health: HealthSnapshotSummary = {
    startupId: snapshot.startup_id,
    healthState: status,
    blockedReason: snapshot.blocked_reason,
    northStarKey: snapshot.north_star_key,
    northStarValue: snapshot.north_star_value,
    northStarPreviousValue: snapshot.north_star_previous_value,
    supportingMetrics,
    funnel,
    computedAt: requireIsoString(snapshot.computed_at, "snapshot.computed_at"),
    syncJobId: snapshot.sync_job_id,
  };

  return {
    health,
    connectors,
    status,
    blockedReasons,
    lastSnapshotAt: toIsoString(snapshot.computed_at),
    customMetric,
  };
}
