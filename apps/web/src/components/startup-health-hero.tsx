import type { HealthState, NorthStarMetric } from "@shared/startup-health";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartupHealthHeroProps {
  blockedReasons: Array<{ code: string; message: string }>;
  healthState: HealthState;
  lastSnapshotAt: string | null;
  northStarKey: NorthStarMetric;
  northStarPreviousValue: number | null;
  northStarValue: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NORTH_STAR_LABELS: Record<NorthStarMetric, string> = {
  mrr: "Monthly Recurring Revenue",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function computeDelta(
  current: number,
  previous: number | null
): { label: string; direction: "up" | "down" | "flat" } | null {
  if (previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.01) {
    return { label: "0%", direction: "flat" };
  }
  const sign = pct > 0 ? "+" : "";
  return {
    label: `${sign}${pct.toFixed(1)}%`,
    direction: pct > 0 ? "up" : "down",
  };
}

function healthStateBanner(state: HealthState): {
  color: string;
  bg: string;
  text: string;
} {
  switch (state) {
    case "ready":
      return { color: "#065f46", bg: "#ecfdf5", text: "Healthy" };
    case "syncing":
      return { color: "#92400e", bg: "#fffbeb", text: "Syncing…" };
    case "stale":
      return { color: "#92400e", bg: "#fffbeb", text: "Stale data" };
    case "blocked":
      return { color: "#991b1b", bg: "#fef2f2", text: "Blocked" };
    case "error":
      return { color: "#991b1b", bg: "#fef2f2", text: "Error" };
    default:
      return { color: "#374151", bg: "#f9fafb", text: String(state) };
  }
}

function formatSnapshotAge(iso: string | null): string {
  if (!iso) {
    return "No snapshot yet";
  }
  const diff = Date.now() - new Date(iso).getTime();
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
// Component
// ---------------------------------------------------------------------------

export function StartupHealthHero({
  healthState,
  northStarKey,
  northStarValue,
  northStarPreviousValue,
  lastSnapshotAt,
  blockedReasons,
}: StartupHealthHeroProps) {
  const banner = healthStateBanner(healthState);
  const delta = computeDelta(northStarValue, northStarPreviousValue);
  const isBlocked = healthState === "blocked" || healthState === "error";

  return (
    <section
      aria-label="startup health hero"
      style={{
        display: "grid",
        gap: "0.75rem",
        padding: "1.25rem",
        border: `1px solid ${banner.color}20`,
        borderRadius: "1rem",
        background: banner.bg,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          role="status"
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: banner.color,
          }}
        >
          {banner.text}
        </span>
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
          {formatSnapshotAge(lastSnapshotAt)}
        </span>
      </div>

      <div>
        <p
          style={{
            margin: 0,
            fontSize: "0.8rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          {NORTH_STAR_LABELS[northStarKey]}
        </p>
        <p
          data-testid="north-star-value"
          style={{
            margin: "0.25rem 0 0",
            fontSize: "2.25rem",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color: isBlocked ? "#9ca3af" : "#111827",
          }}
        >
          {formatCurrency(northStarValue)}
        </p>
        {delta ? (
          <span
            data-testid="north-star-delta"
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: (() => {
                if (delta.direction === "up") {
                  return "#065f46";
                }
                if (delta.direction === "down") {
                  return "#991b1b";
                }
                return "#6b7280";
              })(),
            }}
          >
            {delta.label} from previous
          </span>
        ) : null}
      </div>

      {blockedReasons.length > 0 ? (
        <div
          aria-label="blocked reasons"
          role="alert"
          style={{ display: "grid", gap: "0.35rem" }}
        >
          {blockedReasons.map((reason) => (
            <p
              key={reason.code}
              style={{ margin: 0, fontSize: "0.85rem", color: banner.color }}
            >
              {reason.message}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
