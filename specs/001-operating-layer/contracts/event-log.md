# Event Log Contracts

**Spec ref**: US-4

## Query API

### List events

**Route**: `GET /api/events`

```typescript
// Query params
{
  startupId?: string;
  eventTypes?: string[];       // Comma-separated event types
  from?: string;               // ISO 8601
  to?: string;                 // ISO 8601
  cursor?: string;             // Opaque cursor for pagination
  limit?: number;              // Default 50, max 200
}

// Response
{
  events: EventLogEntry[];
  pagination: {
    cursor: string | null;     // null = no more pages
    hasMore: boolean;
    limit: number;
  };
}
```

**Tenant isolation**: ALL queries filtered by `workspace_id` from auth context. No cross-tenant access.

**Sort order**: `created_at DESC` (newest first).

**Cursor format**: Opaque base64 string encoding `(created_at, id)` for stable pagination.

## Write API (internal only)

Event log writes are internal — no public API for creating events. Events are emitted by the system via `EventEmitter` helper.

```typescript
// Internal emitter interface
interface EventEmitter {
  emit(event: {
    workspaceId: string;
    startupId?: string;
    eventType: EventType;
    actorType: "system" | "user" | "ai" | "mcp";
    actorId?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}
```

## Event Type Enum

Full discriminated union with per-type payload shapes:

### Alert events
```typescript
"alert.fired" → {
  alertId: string;
  ruleId: string;
  metricKey: string;
  severity: string;
  value: number;
  threshold: number;
  occurrenceCount: number;
}

"alert.ack" | "alert.snoozed" | "alert.dismissed" → {
  alertId: string;
  metricKey: string;
  source: "dashboard" | "telegram" | "mcp";
  snoozedUntil?: string;      // Only for alert.snoozed
}

"alert.resolved" → {
  alertId: string;
  metricKey: string;
  resolvedValue: number;
}
```

### Connector events
```typescript
"connector.synced" → {
  connectorId: string;
  provider: string;
  syncJobId: string;
  durationMs: number;
  metricsCount: number;        // How many metrics were synced
}

"connector.errored" → {
  connectorId: string;
  provider: string;
  syncJobId: string;
  error: string;
}

"connector.created" | "connector.deleted" → {
  connectorId: string;
  provider: string;
}
```

### Insight events
```typescript
"insight.generated" → {
  insightId: string;
  conditionCode: string;
  severity: string;
}

"insight.viewed" → {
  insightId: string;
}
```

### Telegram events
```typescript
"telegram.digest" → {
  startupCount: number;
  alertCount: number;
  atRiskCount: number;
  delivered: boolean;
}

"telegram.alert" → {
  alertId: string;
  metricKey: string;
  severity: string;
  messageId?: number;          // Telegram message ID for reaction tracking
}

"telegram.reaction" → {
  alertId: string;
  reaction: "👍" | "😴" | "❌";
  action: "ack" | "snooze" | "dismiss";
}
```

### MCP events
```typescript
"mcp.query" → {
  tool: string;                // Tool name (e.g., "get_metrics")
  keyPrefix: string;           // First 8 chars of API key
  durationMs: number;
}

"mcp.action" → {
  tool: string;
  keyPrefix: string;
  targetId?: string;           // e.g., alertId, taskId
  durationMs: number;
}

"mcp.key_created" → {
  keyPrefix: string;
  scope: "read" | "write";
  name: string;
}

"mcp.key_revoked" → {
  keyPrefix: string;
  name: string;
}
```

### Task events
```typescript
"task.created" → {
  taskId: string;
  title: string;
  source: "dashboard" | "insight" | "mcp";
}

"task.completed" → {
  taskId: string;
  title: string;
}
```

### Webhook events
```typescript
"webhook.delivered" → {
  deliveryId: string;
  webhookConfigId: string;
  eventType: string;
  httpStatus: number;
  durationMs: number;
}

"webhook.failed" → {
  deliveryId: string;
  webhookConfigId: string;
  eventType: string;
  error: string;
  httpStatus?: number;
  attempt: number;
  willRetry: boolean;
}
```

## Retention & Purge

- **Default retention**: 90 days
- **Purge job**: Daily BullMQ repeatable job
- **Legal hold**: If `workspace.legal_hold_until` is set and in the future, PII fields in payload are redacted (replaced with `[REDACTED]`) but event structure preserved
- **Purge query**: `DELETE FROM event_log WHERE created_at < now() - interval '90 days' AND workspace_id NOT IN (SELECT id FROM workspace WHERE legal_hold_until > now())`

## DSAR Support

**Route**: `GET /api/internal/pii-search?q=<identifier>`

Returns all tables/events containing the identifier. For event log: searches `payload` JSONB for string matches.

**Deletion**: Redacts customer data from event payloads, replacing with `[REDACTED]`. Preserves event structure and non-PII fields.

## Dashboard Journal Mode Integration

- Default filter: `alert.*` + `insight.*` + `task.*` (high-signal)
- "Show all" toggle adds `connector.*`, `telegram.*`, `mcp.*`, `webhook.*`
- Events grouped by day with `DaySeparator` component
- Scroll-to-event via URL param: `?mode=journal&event={eventId}`
- If target event not found: retry 2x with 2s delay, then show "Event not found or expired"
- If event falls outside 90-day retention: show "This event has been archived"
