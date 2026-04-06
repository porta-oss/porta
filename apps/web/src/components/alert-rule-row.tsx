import type {
  AlertCondition,
  AlertRuleSummary,
  AlertSeverity,
} from "@shared/alert-rule";
import {
  isUniversalMetricKey,
  METRIC_LABELS,
  METRIC_UNITS,
  type UniversalMetricKey,
} from "@shared/universal-metrics";
import { AlertTriangle, Flame, Info, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  {
    badgeVariant: "default" | "secondary" | "destructive" | "outline";
    icon: typeof Flame;
    label: string;
  }
> = {
  critical: { icon: Flame, label: "Critical", badgeVariant: "destructive" },
  high: {
    icon: AlertTriangle,
    label: "High",
    badgeVariant: "destructive",
  },
  medium: { icon: Info, label: "Medium", badgeVariant: "secondary" },
  low: { icon: Shield, label: "Low", badgeVariant: "outline" },
};

// ---------------------------------------------------------------------------
// Condition formatting
// ---------------------------------------------------------------------------

const CONDITION_LABELS: Record<AlertCondition, string> = {
  drop_wow_pct: "drops week-over-week",
  spike_vs_avg: "spikes vs average",
  below_threshold: "falls below",
  above_threshold: "rises above",
};

function formatThreshold(
  threshold: number,
  condition: AlertCondition,
  metricKey: string
): string {
  const unit = isUniversalMetricKey(metricKey)
    ? METRIC_UNITS[metricKey]
    : undefined;

  const isPct = condition === "drop_wow_pct" || condition === "spike_vs_avg";
  if (isPct) {
    return `>${String(threshold)}%`;
  }

  if (unit === "currency") {
    return `$${String(threshold)}`;
  }
  if (unit === "percent") {
    return `${String(threshold)}%`;
  }
  return String(threshold);
}

function formatCondition(
  condition: AlertCondition,
  threshold: number,
  metricKey: string
): string {
  const label = CONDITION_LABELS[condition];
  const formatted = formatThreshold(threshold, condition, metricKey);
  return `${label} ${formatted}`;
}

// ---------------------------------------------------------------------------
// Metric label helper
// ---------------------------------------------------------------------------

function getMetricLabel(metricKey: string): string {
  if (isUniversalMetricKey(metricKey)) {
    return METRIC_LABELS[metricKey as UniversalMetricKey];
  }
  return metricKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AlertRuleRowProps {
  className?: string;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
  rule: AlertRuleSummary;
}

export function AlertRuleRow({
  rule,
  onToggle,
  onClick,
  className,
}: AlertRuleRowProps) {
  const severity = SEVERITY_CONFIG[rule.severity];
  const SeverityIcon = severity.icon;
  const conditionText = formatCondition(
    rule.condition,
    rule.threshold,
    rule.metricKey
  );
  const metricLabel = getMetricLabel(rule.metricKey);

  return (
    <div
      className={`flex min-h-[44px] items-center gap-3 rounded-md border px-3 py-2 text-sm ${rule.enabled ? "" : "opacity-60"} ${className ?? ""}`}
      data-testid="alert-rule-row"
    >
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
        onClick={onClick}
        type="button"
      >
        <span className="shrink-0 font-medium">{metricLabel}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {conditionText}
        </span>
        <Badge className="shrink-0" variant={severity.badgeVariant}>
          <SeverityIcon />
          {severity.label}
        </Badge>
      </button>

      <Switch
        aria-label={`${rule.enabled ? "Disable" : "Enable"} alert rule for ${metricLabel}`}
        checked={rule.enabled}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
