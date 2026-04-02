import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ConnectorStatusPanelProps {
  connectors: ConnectorSummary[];
  error?: string | null;
  loading?: boolean;
  onDisconnect?: (connectorId: string) => Promise<void>;
  onRefresh?: () => void;
  onResync?: (connectorId: string) => Promise<void>;
}

const PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  posthog: "PostHog",
  stripe: "Stripe",
  postgres: "Postgres",
};

function statusBadgeVariant(
  status: ConnectorSummary["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "connected":
      return "default";
    case "pending":
      return "secondary";
    case "error":
      return "destructive";
    case "disconnected":
      return "outline";
    default:
      return "secondary";
  }
}

function statusLabel(status: ConnectorSummary["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "pending":
      return "Syncing\u2026";
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
    <Card aria-label="connector status">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Connectors</CardTitle>
        {onRefresh ? (
          <Button
            disabled={loading}
            onClick={onRefresh}
            size="sm"
            variant="outline"
          >
            {loading ? "Refreshing\u2026" : "Refresh"}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-3">
        {loading && connectors.length === 0 ? (
          <p className="text-muted-foreground text-sm" role="status">
            Loading connectors\u2026
          </p>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!(loading || error) && connectors.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No connectors configured yet. Connect PostHog or Stripe to start
            syncing data.
          </p>
        ) : null}

        {connectors.map((c) => {
          const providerLabel = PROVIDER_LABELS[c.provider] ?? c.provider;
          const actionState = actionStates[c.id] ?? "idle";
          const actionError = actionErrors[c.id] ?? null;

          return (
            <Card aria-label={`${providerLabel} status`} key={c.id}>
              <CardContent className="grid gap-2 pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{providerLabel}</span>
                  <Badge role="status" variant={statusBadgeVariant(c.status)}>
                    {statusLabel(c.status)}
                  </Badge>
                </div>

                <div className="flex gap-4 text-muted-foreground text-sm">
                  <span>Last sync: {formatSyncAge(c.lastSyncAt)}</span>
                  {c.lastSyncDurationMs === null ? null : (
                    <span>{String(c.lastSyncDurationMs)}ms</span>
                  )}
                </div>

                {c.lastSyncError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">
                      {c.lastSyncError}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {actionError ? (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">
                      {actionError}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex gap-2">
                  {c.status !== "disconnected" && onResync ? (
                    <Button
                      disabled={actionState === "working"}
                      onClick={() => void handleResync(c.id)}
                      size="sm"
                      variant="outline"
                    >
                      {actionState === "working" ? "Syncing\u2026" : "Resync"}
                    </Button>
                  ) : null}
                  {c.status !== "disconnected" && onDisconnect ? (
                    <Button
                      disabled={actionState === "working"}
                      onClick={() => void handleDisconnect(c.id)}
                      size="sm"
                      variant="destructive"
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
