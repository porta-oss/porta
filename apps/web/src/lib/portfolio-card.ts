// Deterministic view-model for the portfolio startup card.
// Derives health badge, trend summary, freshness copy, and top-issue text
// from the existing startup record + health payload. Pure functions — no
// side effects, no secrets, no raw provider payloads.

import type { HealthState } from "@shared/startup-health";
import type { StartupRecord } from "@shared/types";
import type {
  BlockedReason,
  ConnectorFreshness,
  StartupHealthPayload,
} from "../routes/_authenticated/dashboard";

// ---------------------------------------------------------------------------
// View-model shape
// ---------------------------------------------------------------------------

export type PortfolioBadge =
  | "healthy"
  | "attention"
  | "blocked"
  | "syncing"
  | "error"
  | "unknown";

export interface PortfolioCardViewModel {
  /** Badge for the priority surface — maps health states to founder-level labels. */
  badge: PortfolioBadge;
  /** Human-readable badge label. */
  badgeLabel: string;
  /** Freshness copy, e.g. "Updated 3h ago". */
  freshnessCopy: string;
  /** The underlying health state for downstream branching. */
  healthState: HealthState;
  /** Display name of the startup. */
  name: string;
  /** North-star formatted value. */
  northStarDisplay: string;
  /** North-star key for labeling. */
  northStarKey: string;
  /** Top issue — the single most important thing the founder needs to know. */
  topIssue: string;
  /** One-line trend summary, e.g. "MRR +13.6%". Null when no trend is available. */
  trendSummary: string | null;
}

// ---------------------------------------------------------------------------
// Badge derivation
// ---------------------------------------------------------------------------

function deriveBadge(state: HealthState): {
  badge: PortfolioBadge;
  label: string;
} {
  switch (state) {
    case "ready":
      return { badge: "healthy", label: "Healthy" };
    case "stale":
      return { badge: "attention", label: "Needs attention" };
    case "blocked":
      return { badge: "blocked", label: "Blocked" };
    case "syncing":
      return { badge: "syncing", label: "Syncing" };
    case "error":
      return { badge: "error", label: "Error" };
    default:
      return { badge: "unknown", label: "Unknown" };
  }
}

// ---------------------------------------------------------------------------
// Trend derivation
// ---------------------------------------------------------------------------

const NORTH_STAR_LABELS: Record<string, string> = {
  mrr: "MRR",
};

function deriveTrend(
  northStarKey: string,
  current: number | null,
  previous: number | null
): string | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct)) {
    return null;
  }
  const sign = pct > 0 ? "+" : "";
  return `${NORTH_STAR_LABELS[northStarKey] ?? northStarKey} ${sign}${pct.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Freshness derivation
// ---------------------------------------------------------------------------

export function deriveFreshness(lastSnapshotAt: string | null): string {
  if (!lastSnapshotAt) {
    return "No snapshot yet";
  }
  const diff = Date.now() - new Date(lastSnapshotAt).getTime();
  if (diff < 0) {
    return "Updated just now";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "Updated just now";
  }
  if (minutes < 60) {
    return `Updated ${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Updated ${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `Updated ${String(days)}d ago`;
}

// ---------------------------------------------------------------------------
// Top-issue derivation
// ---------------------------------------------------------------------------

function deriveTopIssue(
  state: HealthState,
  blockedReasons: BlockedReason[],
  connectors: ConnectorFreshness[]
): string {
  // Blocked: surface the first blocked reason.
  if (state === "blocked") {
    const first = blockedReasons[0];
    return first
      ? first.message
      : "Startup is blocked — check connector configuration.";
  }

  // Error: surface the first connector with a sync error.
  if (state === "error") {
    const failedConnector = connectors.find((c) => c.lastSyncError !== null);
    return failedConnector?.lastSyncError ?? "A data sync error occurred.";
  }

  // Stale: prompt a resync.
  if (state === "stale") {
    return "Health data is stale. Resync connectors to refresh.";
  }

  // Syncing: inform the founder.
  if (state === "syncing") {
    return "Data sync in progress.";
  }

  // Ready — steady-state summary.
  return "All systems operational.";
}

// ---------------------------------------------------------------------------
// Currency formatting
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the portfolio-card view model from a startup record and health payload.
 * Returns null when the health payload is null (should not happen in normal flow
 * but guards the boundary).
 */
export function buildPortfolioCardViewModel(
  startup: StartupRecord,
  healthPayload: StartupHealthPayload
): PortfolioCardViewModel {
  const { badge, label: badgeLabel } = deriveBadge(healthPayload.status);

  const northStarKey: string = healthPayload.health?.northStarKey ?? "mrr";
  const northStarValue = healthPayload.health?.northStarValue ?? null;
  const northStarPrevious =
    healthPayload.health?.northStarPreviousValue ?? null;

  return {
    name: startup.name,
    badge,
    badgeLabel,
    trendSummary: deriveTrend(northStarKey, northStarValue, northStarPrevious),
    freshnessCopy: deriveFreshness(healthPayload.lastSnapshotAt),
    topIssue: deriveTopIssue(
      healthPayload.status,
      healthPayload.blockedReasons,
      healthPayload.connectors
    ),
    healthState: healthPayload.status,
    northStarKey,
    northStarDisplay: formatCurrency(northStarValue ?? 0),
  };
}

/**
 * Build a view model for the health-error state (when the fetch itself fails).
 * The card should still be visible — just in an error state with the error message.
 */
export function buildPortfolioErrorViewModel(
  startup: StartupRecord,
  errorMessage: string
): PortfolioCardViewModel {
  return {
    name: startup.name,
    badge: "error",
    badgeLabel: "Error",
    trendSummary: null,
    freshnessCopy: "Unable to load",
    topIssue: errorMessage,
    healthState: "error",
    northStarKey: "mrr",
    northStarDisplay: "—",
  };
}
