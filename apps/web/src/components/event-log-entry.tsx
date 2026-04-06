import type { EventLogEntrySummary, EventType } from "@shared/event-log";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Eye,
  Flame,
  Info,
  Key,
  KeyRound,
  Lightbulb,
  Link2,
  Link2Off,
  ListChecks,
  type LucideIcon,
  MessageCircle,
  Plug,
  PlugZap,
  Send,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventLogEntryProps {
  event: EventLogEntrySummary;
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

// ---------------------------------------------------------------------------
// Event type config
// ---------------------------------------------------------------------------

interface EventConfig {
  icon: LucideIcon;
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
}

const EVENT_CONFIG: Record<EventType, EventConfig> = {
  "alert.fired": {
    icon: Flame,
    label: "Alert Fired",
    variant: "destructive",
  },
  "alert.ack": { icon: Eye, label: "Alert Acked", variant: "secondary" },
  "alert.snoozed": {
    icon: BellOff,
    label: "Alert Snoozed",
    variant: "secondary",
  },
  "alert.dismissed": {
    icon: XCircle,
    label: "Alert Dismissed",
    variant: "outline",
  },
  "alert.resolved": {
    icon: CheckCircle2,
    label: "Alert Resolved",
    variant: "default",
  },
  "connector.synced": {
    icon: PlugZap,
    label: "Connector Synced",
    variant: "default",
  },
  "connector.errored": {
    icon: Plug,
    label: "Connector Error",
    variant: "destructive",
  },
  "connector.created": {
    icon: Plug,
    label: "Connector Created",
    variant: "secondary",
  },
  "connector.deleted": {
    icon: Trash2,
    label: "Connector Deleted",
    variant: "outline",
  },
  "insight.generated": {
    icon: Sparkles,
    label: "Insight Generated",
    variant: "default",
  },
  "insight.viewed": {
    icon: Lightbulb,
    label: "Insight Viewed",
    variant: "outline",
  },
  "telegram.digest": {
    icon: Send,
    label: "Telegram Digest",
    variant: "secondary",
  },
  "telegram.alert": {
    icon: Bell,
    label: "Telegram Alert",
    variant: "secondary",
  },
  "telegram.reaction": {
    icon: MessageCircle,
    label: "Telegram Reaction",
    variant: "outline",
  },
  "mcp.query": { icon: Terminal, label: "MCP Query", variant: "secondary" },
  "mcp.action": { icon: Zap, label: "MCP Action", variant: "secondary" },
  "mcp.key_created": {
    icon: Key,
    label: "MCP Key Created",
    variant: "default",
  },
  "mcp.key_revoked": {
    icon: KeyRound,
    label: "MCP Key Revoked",
    variant: "outline",
  },
  "task.created": {
    icon: ListChecks,
    label: "Task Created",
    variant: "default",
  },
  "task.completed": {
    icon: CheckCircle2,
    label: "Task Completed",
    variant: "default",
  },
  "webhook.delivered": {
    icon: Link2,
    label: "Webhook Delivered",
    variant: "default",
  },
  "webhook.failed": {
    icon: Link2Off,
    label: "Webhook Failed",
    variant: "destructive",
  },
};

// ---------------------------------------------------------------------------
// Severity helpers (for alert events)
// ---------------------------------------------------------------------------

const ALERT_SEVERITY_CONFIG: Record<
  string,
  {
    badgeVariant: "default" | "secondary" | "destructive" | "outline";
    icon: LucideIcon;
  }
> = {
  critical: { icon: Flame, badgeVariant: "destructive" },
  high: { icon: AlertTriangle, badgeVariant: "destructive" },
  medium: { icon: Info, badgeVariant: "secondary" },
  low: { icon: Shield, badgeVariant: "outline" },
};

// ---------------------------------------------------------------------------
// Per-type detail renderers
// ---------------------------------------------------------------------------

function AlertEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;
  const eventType = event.eventType;

  if (eventType === "alert.fired") {
    const severity = String(p.severity ?? "medium");
    const config = ALERT_SEVERITY_CONFIG[severity];
    const SevIcon = config?.icon ?? Info;
    return (
      <div className="flex items-center gap-2">
        <Badge variant={config?.badgeVariant ?? "secondary"}>
          <SevIcon className="size-3" />
          {severity}
        </Badge>
        <span className="text-foreground text-sm">
          {formatMetricKey(String(p.metricKey ?? ""))}
        </span>
        <span className="text-muted-foreground text-sm">
          {String(p.value ?? "")} (threshold: {String(p.threshold ?? "")})
        </span>
      </div>
    );
  }

  if (eventType === "alert.snoozed") {
    return (
      <span className="text-muted-foreground text-sm">
        Snoozed until{" "}
        {p.snoozedUntil
          ? new Date(String(p.snoozedUntil)).toLocaleString()
          : "unknown"}
      </span>
    );
  }

  if (eventType === "alert.resolved") {
    return (
      <span className="text-muted-foreground text-sm">
        Resolved
        {p.resolvedValue == null ? "" : ` (value: ${String(p.resolvedValue)})`}
      </span>
    );
  }

  return null;
}

function ConnectorEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;
  const provider = String(p.provider ?? "unknown");

  if (event.eventType === "connector.synced") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">{provider}</Badge>
        <span className="text-muted-foreground text-sm">
          {String(p.recordsProcessed ?? 0)} records synced
        </span>
      </div>
    );
  }

  if (event.eventType === "connector.errored") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">{provider}</Badge>
        <span className="text-destructive text-sm">
          {String(p.error ?? "Unknown error")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline">{provider}</Badge>
    </div>
  );
}

function InsightEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;

  if (event.eventType === "insight.generated") {
    return (
      <span className="line-clamp-2 text-muted-foreground text-sm">
        {String(p.summary ?? "")}
      </span>
    );
  }

  return null;
}

function TelegramEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;

  if (event.eventType === "telegram.digest") {
    return (
      <span className="text-muted-foreground text-sm">
        {String(p.startupCount ?? 0)} startups, {String(p.metricsIncluded ?? 0)}{" "}
        metrics
      </span>
    );
  }

  if (event.eventType === "telegram.alert") {
    const severity = String(p.severity ?? "medium");
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">{severity}</Badge>
        <span className="text-muted-foreground text-sm">
          {formatMetricKey(String(p.metricKey ?? ""))}
        </span>
      </div>
    );
  }

  if (event.eventType === "telegram.reaction") {
    return (
      <span className="text-muted-foreground text-sm">
        Reaction: {String(p.reaction ?? "")}
      </span>
    );
  }

  return null;
}

function McpEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;

  if (event.eventType === "mcp.query" || event.eventType === "mcp.action") {
    return (
      <span className="text-muted-foreground text-sm">
        Tool: {String(p.tool ?? "unknown")}
      </span>
    );
  }

  if (
    event.eventType === "mcp.key_created" ||
    event.eventType === "mcp.key_revoked"
  ) {
    return (
      <span className="text-muted-foreground text-sm">
        Key: {String(p.keyPrefix ?? "")}...
      </span>
    );
  }

  return null;
}

function TaskEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;

  return (
    <span className="text-muted-foreground text-sm">
      {String(p.title ?? "Untitled task")}
    </span>
  );
}

function WebhookEventDetail({ event }: { event: EventLogEntrySummary }) {
  const p = event.payload;

  if (event.eventType === "webhook.delivered") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">{String(p.eventType ?? "")}</Badge>
        <span className="text-muted-foreground text-sm">
          {String(p.statusCode ?? "")}
        </span>
      </div>
    );
  }

  if (event.eventType === "webhook.failed") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">{String(p.eventType ?? "")}</Badge>
        <span className="text-destructive text-sm">
          {String(p.error ?? "Unknown error")}
        </span>
        <span className="text-muted-foreground text-xs">
          attempt {String(p.attempt ?? 1)}
        </span>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Detail dispatcher
// ---------------------------------------------------------------------------

function EventDetail({ event }: { event: EventLogEntrySummary }) {
  const category = event.eventType.split(".")[0];

  switch (category) {
    case "alert":
      return <AlertEventDetail event={event} />;
    case "connector":
      return <ConnectorEventDetail event={event} />;
    case "insight":
      return <InsightEventDetail event={event} />;
    case "telegram":
      return <TelegramEventDetail event={event} />;
    case "mcp":
      return <McpEventDetail event={event} />;
    case "task":
      return <TaskEventDetail event={event} />;
    case "webhook":
      return <WebhookEventDetail event={event} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMetricKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EventLogEntry({ event }: EventLogEntryProps) {
  const config = EVENT_CONFIG[event.eventType];
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground text-sm">
            {config.label}
          </span>
          <span
            className="shrink-0 text-muted-foreground text-xs"
            title={new Date(event.createdAt).toLocaleString()}
          >
            {formatRelativeTime(event.createdAt)}
          </span>
        </div>

        <EventDetail event={event} />
      </div>
    </div>
  );
}
