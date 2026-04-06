# MCP Tool Contracts

**Spec ref**: US-3 | **Auth**: API key via `Authorization: Bearer porta_<scope>_<32chars>`

All schemas defined as Zod types in `packages/shared/src/mcp.ts`.

## Common Response Wrapper

```typescript
interface McpResponse<T> {
  data: T;
  dataAsOf: string;         // ISO 8601 timestamp of last sync
  dashboardUrl: string;      // Deep link to dashboard
  pagination?: {
    cursor: string | null;
    hasMore: boolean;
    limit: number;           // Default 50
  };
}

interface McpErrorResponse {
  error: string;
  code: "NOT_FOUND" | "FORBIDDEN" | "RATE_LIMITED" | "INTERNAL";
  retryAfter?: number;       // Seconds, only for RATE_LIMITED
}
```

## Auth & Rate Limiting

- Header: `Authorization: Bearer <key>`
- Key format: `porta_<read|write>_<32 random chars>`
- `read` scope: access to all 5 read tools
- `write` scope: access to all 8 tools (read + write)
- Rate limit: 60 req/min per key, 429 with `Retry-After` header
- Revoked key: 401 immediately (not 500)
- All requests log `key_prefix` (first 8 chars) in event log

## Read Tools (5) — Require `read` scope

### 1. `get_metrics`

**Route**: `GET /api/mcp/metrics`

**Input**:
```typescript
{
  startupId: string;                   // Required
  metricKeys?: string[];               // Filter to specific keys
  dateRange?: {
    from: string;  // ISO 8601
    to: string;    // ISO 8601
  };
  category?: "engagement" | "revenue" | "health" | "growth" | "custom";
}
```

**Output** (`data` field):
```typescript
MetricValue[] // Array of:
{
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  delta: number | null;
  unit: string;
  category: "engagement" | "revenue" | "health" | "growth" | "custom";
  source: string;            // Connector provider name
  isUniversal: boolean;      // True if key matches universal metric
}
```

**Behavior**: Returns both universal and custom metrics for the startup. Filter by `metricKeys` for specific keys or `category` for all metrics in a category. If no filters, returns all metrics.

---

### 2. `get_alerts`

**Route**: `GET /api/mcp/alerts`

**Input**:
```typescript
{
  startupId?: string;
  status?: "active" | "snoozed" | "dismissed" | "resolved";
}
```

**Output** (`data` field):
```typescript
Alert[] // Array of:
{
  id: string;
  startupId: string;
  ruleId: string;
  metricKey: string;
  severity: "critical" | "high" | "medium" | "low";
  value: number;
  threshold: number;
  firedAt: string;           // ISO 8601
  status: "active" | "acknowledged" | "snoozed" | "dismissed" | "resolved";
  occurrenceCount: number;
}
```

**Behavior**: Without `startupId`, returns alerts across all startups in the workspace. Sorted by severity (critical first), then `firedAt` descending.

---

### 3. `get_at_risk_customers`

**Route**: `GET /api/mcp/at-risk-customers`

**Input**:
```typescript
{
  startupId: string;          // Required
}
```

**Output** (`data` field):
```typescript
AtRiskCustomer[] // Array of:
{
  identifier: string;         // PII — customer name/email/payment ref
  riskReasons: string[];      // e.g., ["Failed payment in last 7 days", "Usage drop >50% WoW"]
  lastPaymentDate: string | null;
  lastActivityDate: string | null;
  evaluableCriteria: string[]; // Which criteria were evaluable for this startup
}
```

**PII note**: This tool returns customer PII. MCP tool description MUST note this. Read-permission API keys grant PII access.

---

### 4. `get_activity_log`

**Route**: `GET /api/mcp/activity-log`

**Input**:
```typescript
{
  startupId?: string;
  eventTypes?: EventType[];   // Filter by event type
  dateRange?: {
    from: string;
    to: string;
  };
  cursor?: string;
  limit?: number;             // Default 50, max 200
}
```

**Output** (`data` field):
```typescript
EventLogEntry[] // Discriminated union, sorted by created_at DESC
```

**Pagination**: Cursor-based. `cursor` is an opaque string (base64-encoded `created_at + id`).

---

### 5. `get_portfolio_summary`

**Route**: `GET /api/mcp/portfolio-summary`

**Input**:
```typescript
{} // No parameters — returns all startups in workspace
```

**Output** (`data` field):
```typescript
{
  startups: StartupSummary[];
  aiSynthesis?: string;       // Cross-startup analysis text
  synthesizedAt?: string;     // ISO 8601
}

// Where StartupSummary:
{
  id: string;
  name: string;
  type: string;
  currency: string;
  healthState: HealthState;
  northStarKey: string;
  northStarValue: number | null;
  northStarDelta: number | null;
  universalMetrics: UniversalMetrics;
  customMetricCount: number;
  activeAlerts: number;
  lastSyncAt: string | null;
}
```

**Graceful degradation**: < 2 startups → per-startup summary only (no cross-startup comparison). AI API unavailable → metric-only response (no `aiSynthesis`).

---

## Write Tools (3) — Require `write` scope

### 6. `create_task`

**Route**: `POST /api/mcp/tasks`

**Input**:
```typescript
{
  startupId: string;          // Required
  title: string;              // Required, max 200 chars
  description?: string;       // Max 2000 chars
  priority?: "urgent" | "high" | "medium" | "low"; // Default "medium"
}
```

**Output** (`data` field):
```typescript
{
  task: {
    id: string;
    startupId: string;
    title: string;
    description: string | null;
    priority: string;
    syncStatus: string;
    createdAt: string;
  }
}
```

**Side effects**: Logs `task.created` event. Enqueues Linear sync if `LINEAR_API_KEY` configured.

---

### 7. `snooze_alert`

**Route**: `POST /api/mcp/alerts/:alertId/snooze`

**Input**:
```typescript
{
  alertId: string;            // URL param
  duration?: number;          // Hours, default 24, max 168 (7 days)
}
```

**Output** (`data` field):
```typescript
{
  alert: Alert; // Updated alert with status: "snoozed", snoozedUntil set
}
```

**Side effects**: Logs `alert.snoozed` event.

---

### 8. `trigger_sync`

**Route**: `POST /api/mcp/sync`

**Input**:
```typescript
{
  startupId: string;          // Required
  connectorId?: string;       // Optional — specific connector. Without: all connectors for startup
}
```

**Output** (`data` field):
```typescript
{
  syncJobs: SyncJob[]; // Array of:
  {
    id: string;
    connectorId: string;
    provider: string;
    status: "queued";
    trigger: "manual";
    createdAt: string;
  }
}
```

**Side effects**: Enqueues sync jobs to BullMQ. Logs `connector.synced` event on completion.

---

## REST Fallback Strategy

If MCP SDK (e.g., `elysia-mcp`) is immature at implementation time, all tools ship as REST endpoints under `/api/mcp/*` with the same schemas. REST endpoints use API key auth only (no session cookie auth) to prevent CSRF. MCP wrapper added later when SDK matures.
