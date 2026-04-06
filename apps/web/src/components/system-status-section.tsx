import type { AlertSeverity } from "@shared/alert-rule";
import type { ConnectorStatus } from "@shared/connectors";
import { Bell, Clock, Link2, MessageSquare, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectorSyncInfo {
  hasError: boolean;
  lastSyncAt: string | null;
  provider: string;
  status: ConnectorStatus;
}

export interface SystemStatusSectionProps {
  /** Breakdown of active alerts by severity. */
  alertsBySeverity?: Partial<Record<AlertSeverity, number>>;
  /** Connector sync statuses. */
  connectors?: ConnectorSyncInfo[];
  /** ISO timestamp of the last digest sent. */
  lastDigestAt?: string | null;
  /** Number of MCP queries made today. */
  mcpQueryCount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
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

const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium", "low"];

const SEVERITY_BADGE_VARIANT: Record<
  AlertSeverity,
  "default" | "secondary" | "destructive" | "outline"
> = {
  critical: "destructive",
  high: "destructive",
  medium: "secondary",
  low: "outline",
};

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

function StatusRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Icon className="size-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      <div className="text-right text-sm">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SystemStatusSection({
  lastDigestAt,
  mcpQueryCount = 0,
  alertsBySeverity = {},
  connectors = [],
}: SystemStatusSectionProps) {
  const totalAlerts = SEVERITY_ORDER.reduce(
    (sum, s) => sum + (alertsBySeverity[s] ?? 0),
    0
  );

  const connectorsWithErrors = connectors.filter((c) => c.hasError);

  const lastSync = connectors
    .filter((c) => c.lastSyncAt !== null)
    .map((c) => new Date(c.lastSyncAt as string).getTime())
    .sort((a, b) => b - a)[0];

  return (
    <section aria-label="System status" className="grid gap-1">
      <h3 className="mb-1 font-semibold text-foreground text-sm">
        System Status
      </h3>

      <StatusRow
        icon={Clock}
        label="Last digest"
        value={
          lastDigestAt ? (
            <span title={new Date(lastDigestAt).toLocaleString()}>
              {formatRelativeTime(lastDigestAt)}
            </span>
          ) : (
            <span className="text-muted-foreground">Never</span>
          )
        }
      />

      <StatusRow
        icon={MessageSquare}
        label="MCP queries today"
        value={<span className="tabular-nums">{String(mcpQueryCount)}</span>}
      />

      <StatusRow
        icon={Bell}
        label="Active alerts"
        value={
          totalAlerts > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {SEVERITY_ORDER.map((s) => {
                const count = alertsBySeverity[s];
                if (!count) {
                  return null;
                }
                return (
                  <Badge key={s} variant={SEVERITY_BADGE_VARIANT[s]}>
                    {String(count)} {s}
                  </Badge>
                );
              })}
            </div>
          ) : (
            <span className="text-muted-foreground">None</span>
          )
        }
      />

      <StatusRow
        icon={Link2}
        label="Connectors"
        value={
          connectors.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {lastSync ? (
                <span
                  className="text-muted-foreground text-xs"
                  title={new Date(lastSync).toLocaleString()}
                >
                  {formatRelativeTime(new Date(lastSync).toISOString())}
                </span>
              ) : null}
              {connectorsWithErrors.length > 0 ? (
                <Badge variant="destructive">
                  <TriangleAlert className="size-3" />
                  {String(connectorsWithErrors.length)} error
                  {connectorsWithErrors.length > 1 ? "s" : ""}
                </Badge>
              ) : null}
              {connectorsWithErrors.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  {String(connectors.length)} ok
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-muted-foreground">None</span>
          )
        }
      />
    </section>
  );
}
