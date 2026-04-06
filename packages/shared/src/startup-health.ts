// B2B SaaS health snapshot contract shared across API, worker, and UI.
// Defines the health-state enum, snapshot summary, and funnel stage shapes.
//
// This is the single source of truth for health states and payload shapes.
// Worker writes, API reads, UI renders — all from these types.
// Never store raw provider payloads or connector credentials in health
// snapshot data.

import type { UniversalMetrics } from "./universal-metrics";

// ---------------------------------------------------------------------------
// Health state
// ---------------------------------------------------------------------------

export const HEALTH_STATES = [
  "blocked",
  "syncing",
  "ready",
  "stale",
  "error",
] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export function isHealthState(value: string): value is HealthState {
  return HEALTH_STATES.includes(value as HealthState);
}

// ---------------------------------------------------------------------------
// Funnel stage row
// ---------------------------------------------------------------------------

/** A single funnel stage row for the startup health page. */
export interface FunnelStageRow {
  key: string;
  label: string;
  position: number;
  value: number;
}

// ---------------------------------------------------------------------------
// Health snapshot summary
// ---------------------------------------------------------------------------

/**
 * The complete health snapshot payload — returned by the API and consumed by the UI.
 * Never contains connector credentials, raw PostHog events, or Stripe customer data.
 */
export interface HealthSnapshotSummary {
  blockedReason: string | null;
  computedAt: string;
  funnel: FunnelStageRow[];
  healthState: HealthState;
  northStarKey: string;
  northStarPreviousValue: number | null;
  northStarValue: number | null;
  startupId: string;
  supportingMetrics: UniversalMetrics | null;
  syncJobId: string | null;
}
