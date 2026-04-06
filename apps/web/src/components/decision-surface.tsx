import type { AlertSeverity, AlertSummary } from "@shared/alert-rule";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Flame,
  Info,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreakInfo {
  currentDays: number;
  longestDays: number;
}

export interface DecisionSurfaceProps {
  alert: AlertSummary | null;
  error: string | null;
  loading: boolean;
  onAck?: (alertId: string) => void;
  onInvestigate?: (alertId: string) => void;
  onRetry?: () => void;
  onSnooze?: (alertId: string, durationHours: number) => void;
  streak: StreakInfo | null;
  triaging?: boolean;
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  {
    badgeVariant: "default" | "secondary" | "destructive" | "outline";
    cardClass: string;
    icon: typeof Flame;
    label: string;
  }
> = {
  critical: {
    icon: Flame,
    label: "Critical",
    badgeVariant: "destructive",
    cardClass: "border-danger-border bg-danger-bg",
  },
  high: {
    icon: AlertTriangle,
    label: "High",
    badgeVariant: "destructive",
    cardClass: "border-warning-border bg-warning-bg",
  },
  medium: {
    icon: Info,
    label: "Medium",
    badgeVariant: "secondary",
    cardClass: "",
  },
  low: {
    icon: Shield,
    label: "Low",
    badgeVariant: "outline",
    cardClass: "",
  },
};

const SNOOZE_OPTIONS = [
  { value: "1", label: "1 hour" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
] as const;

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

function formatMetricKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DecisionSurfaceSkeleton() {
  return (
    <Card aria-label="Loading alerts">
      <CardContent className="grid gap-4 pt-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-20 rounded-3xl" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-5 w-40" />
          <div className="flex items-baseline gap-3">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card aria-label="Alert error" className="border-danger-border">
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center gap-2 text-destructive">
          <XCircle className="size-4" />
          <span className="font-medium text-sm">Failed to load alerts</span>
        </div>
        <p className="text-muted-foreground text-sm">{message}</p>
        {onRetry ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ZeroAlertState({ streak }: { streak: StreakInfo | null }) {
  return (
    <Card
      aria-label="No active alerts"
      className="border-success-border bg-success-bg"
    >
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-success" />
          <span className="font-semibold text-base text-foreground">
            All clear
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          No active alerts. Your startup is running smoothly.
        </p>
        {streak && streak.currentDays > 0 ? (
          <div className="flex items-center gap-2">
            <Badge variant="default">
              {String(streak.currentDays)} day streak
            </Badge>
            {streak.longestDays > streak.currentDays ? (
              <span className="text-muted-foreground text-xs">
                Best: {String(streak.longestDays)} days
              </span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AlertCard({
  alert,
  onAck,
  onSnooze,
  onInvestigate,
  triaging,
}: {
  alert: AlertSummary;
  onAck?: (alertId: string) => void;
  onInvestigate?: (alertId: string) => void;
  onSnooze?: (alertId: string, durationHours: number) => void;
  triaging?: boolean;
}) {
  const [snoozeDuration, setSnoozeDuration] = useState("24");
  const config = SEVERITY_CONFIG[alert.severity];
  const SeverityIcon = config.icon;

  return (
    <Card aria-label="Top priority alert" className={config.cardClass}>
      <CardContent className="grid gap-4 pt-5">
        <div className="flex items-center justify-between">
          <Badge variant={config.badgeVariant}>
            <SeverityIcon className="size-3" />
            {config.label}
          </Badge>
          <span
            className="text-muted-foreground text-xs"
            title={new Date(alert.firedAt).toLocaleString()}
          >
            {formatRelativeTime(alert.firedAt)}
          </span>
        </div>

        <div className="grid gap-1">
          <p className="font-medium text-foreground text-sm">
            {formatMetricKey(alert.metricKey)}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-2xl tabular-nums">
              {String(alert.value)}
            </span>
            <span className="text-muted-foreground text-sm">
              threshold: {String(alert.threshold)}
            </span>
          </div>
          {alert.occurrenceCount > 1 ? (
            <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
              fired {String(alert.occurrenceCount)}x this week
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onAck ? (
            <Button
              disabled={triaging}
              onClick={() => onAck(alert.id)}
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" />
              Ack
            </Button>
          ) : null}

          {onSnooze ? (
            <div className="flex items-center gap-1">
              <Select onValueChange={setSnoozeDuration} value={snoozeDuration}>
                <SelectTrigger size="sm">
                  <Clock className="size-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {SNOOZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={triaging}
                onClick={() =>
                  onSnooze(alert.id, Number.parseInt(snoozeDuration, 10))
                }
                size="sm"
                variant="outline"
              >
                Snooze
              </Button>
            </div>
          ) : null}

          {onInvestigate ? (
            <Button
              onClick={() => onInvestigate(alert.id)}
              size="sm"
              variant="secondary"
            >
              Investigate
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DecisionSurface({
  alert,
  error,
  loading,
  onAck,
  onInvestigate,
  onRetry,
  onSnooze,
  streak,
  triaging,
}: DecisionSurfaceProps) {
  if (loading) {
    return <DecisionSurfaceSkeleton />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (!alert) {
    return <ZeroAlertState streak={streak} />;
  }

  return (
    <AlertCard
      alert={alert}
      onAck={onAck}
      onInvestigate={onInvestigate}
      onSnooze={onSnooze}
      triaging={triaging}
    />
  );
}
