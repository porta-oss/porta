import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import { useState } from "react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ConnectorStatusPanelProps {
  connectors: ConnectorSummary[];
  error?: string | null;
  loading?: boolean;
  onDisconnect?: (connectorId: string) => Promise<void>;
  onRefresh?: () => void;
  onResync?: (connectorId: string) => Promise<void>;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  posthog: "PostHog",
  stripe: "Stripe",
  postgres: "Postgres",
};

function statusBadgeColor(status: ConnectorSummary["status"]): string {
  switch (status) {
    case "connected":
      return "#065f46";
    case "pending":
      return "#92400e";
    case "error":
      return "#991b1b";
    case "disconnected":
      return "#6b7280";
    default:
      return "#374151";
  }
}

function statusLabel(status: ConnectorSummary["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "pending":
      return "Syncing…";
    case "error":
      return "Sync failed";
    case "disconnected":
      return "Disconnected";
    default:
      return status;
  }
}

function formatSyncAge(isoDate: string | null): string {
  if (!isoDate) {
    return "Never synced";
  }

  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function ConnectorStatusPanel({
  connectors,
  loading = false,
  error = null,
  onResync,
  onDisconnect,
  onRefresh,
}: ConnectorStatusPanelProps) {
  const [actionStates, setActionStates] = useState<
    Record<string, "idle" | "working" | "error">
  >({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  async function handleResync(connectorId: string) {
    if (!onResync) {
      return;
    }

    setActionStates((s) => ({ ...s, [connectorId]: "working" }));
    setActionErrors((s) => {
      const next = { ...s };
      delete next[connectorId];
      return next;
    });

    try {
      await onResync(connectorId);
      setActionStates((s) => ({ ...s, [connectorId]: "idle" }));
    } catch (err) {
      setActionStates((s) => ({ ...s, [connectorId]: "error" }));
      setActionErrors((s) => ({
        ...s,
        [connectorId]: err instanceof Error ? err.message : "Resync failed.",
      }));
    }
  }

  async function handleDisconnect(connectorId: string) {
    if (!onDisconnect) {
      return;
    }

    setActionStates((s) => ({ ...s, [connectorId]: "working" }));
    setActionErrors((s) => {
      const next = { ...s };
      delete next[connectorId];
      return next;
    });

    try {
      await onDisconnect(connectorId);
      setActionStates((s) => ({ ...s, [connectorId]: "idle" }));
    } catch (err) {
      setActionStates((s) => ({ ...s, [connectorId]: "error" }));
      setActionErrors((s) => ({
        ...s,
        [connectorId]:
          err instanceof Error ? err.message : "Disconnect failed.",
      }));
    }
  }

  return (
    <section
      aria-label="connector status"
      style={{
        display: "grid",
        gap: "1rem",
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3 style={{ margin: 0 }}>Connectors</h3>
        {onRefresh ? (
          <button disabled={loading} onClick={onRefresh} type="button">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {loading && connectors.length === 0 ? (
        <p role="status" style={{ margin: 0 }}>
          Loading connectors…
        </p>
      ) : null}

      {error ? (
        <p role="alert" style={{ margin: 0, color: "#991b1b" }}>
          {error}
        </p>
      ) : null}

      {!(loading || error) && connectors.length === 0 ? (
        <p style={{ margin: 0, color: "#6b7280" }}>
          No connectors configured yet. Connect PostHog or Stripe to start
          syncing data.
        </p>
      ) : null}

      {connectors.map((c) => {
        const providerLabel = PROVIDER_LABELS[c.provider] ?? c.provider;
        const actionState = actionStates[c.id] ?? "idle";
        const actionError = actionErrors[c.id] ?? null;

        return (
          <div
            aria-label={`${providerLabel} status`}
            key={c.id}
            style={{
              display: "grid",
              gap: "0.5rem",
              padding: "0.75rem",
              border: "1px solid #f3f4f6",
              borderRadius: "0.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600 }}>{providerLabel}</span>
              <span
                role="status"
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  color: statusBadgeColor(c.status),
                }}
              >
                {statusLabel(c.status)}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                gap: "1rem",
                fontSize: "0.8rem",
                color: "#6b7280",
              }}
            >
              <span>Last sync: {formatSyncAge(c.lastSyncAt)}</span>
              {c.lastSyncDurationMs === null ? null : (
                <span>{String(c.lastSyncDurationMs)}ms</span>
              )}
            </div>

            {c.lastSyncError ? (
              <p
                role="alert"
                style={{ margin: 0, fontSize: "0.8rem", color: "#991b1b" }}
              >
                {c.lastSyncError}
              </p>
            ) : null}

            {actionError ? (
              <p
                role="alert"
                style={{ margin: 0, fontSize: "0.8rem", color: "#991b1b" }}
              >
                {actionError}
              </p>
            ) : null}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              {c.status !== "disconnected" && onResync ? (
                <button
                  disabled={actionState === "working"}
                  onClick={() => void handleResync(c.id)}
                  type="button"
                >
                  {actionState === "working" ? "Syncing…" : "Resync"}
                </button>
              ) : null}
              {c.status !== "disconnected" && onDisconnect ? (
                <button
                  disabled={actionState === "working"}
                  onClick={() => void handleDisconnect(c.id)}
                  type="button"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
