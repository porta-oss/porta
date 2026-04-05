# Plan: Setup — Operating Layer

## Overview

This plan covers Phase 1 (Setup) and Phase 2 (Foundational) — all shared infrastructure that blocks user stories.

**Tech stack**: TypeScript 5.x strict, Elysia API, Drizzle ORM, BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod, resvg-js. pnpm monorepo: `apps/api`, `apps/web`, `apps/worker`, `packages/shared`.

**DB**: PostgreSQL via Drizzle. Schema files in `apps/api/src/db/schema/`. Migrations in `apps/api/drizzle/`. Config at root `drizzle.config.ts`.

**Existing patterns**:
- DB tables use `pgTable()` with camelCase TS field names mapped to snake_case DB columns: `startupId: text("startup_id")`
- Relations use `relations()` with `one()`/`many()`
- Shared types use `const X = ["a","b"] as const; type X = (typeof X)[number]` pattern
- Validators are factory functions returning interfaces
- Queue names are UPPERCASE_SNAKE_CASE constants
- Export pattern: `export const tableName = pgTable(...); export const tableRelations = relations(...);`
- Timestamps: `createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()`
- updatedAt pattern: `.$onUpdate(() => new Date())`
- PKs: `id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Install new dependencies
- [x] Install elysia-mcp and update elysia to >=1.4.21 in apps/api/package.json
- [x] Install grammy in apps/api/package.json and apps/worker/package.json
- [x] Install @resvg/resvg-js in apps/worker/package.json
- [x] Run pnpm install to resolve all new dependency versions

### Task 2: Create universal metric keys and types
File: `packages/shared/src/universal-metrics.ts`
- [x] Define UNIVERSAL_METRIC_KEYS as const array: `['mrr', 'active_users', 'churn_rate', 'error_rate', 'growth_rate', 'arpu']`
- [x] Create UniversalMetrics interface with all 6 keys as optional nullable numbers
- [x] Create METRIC_LABELS map: `{ mrr: 'MRR', active_users: 'Active Users', churn_rate: 'Churn Rate', error_rate: 'Error Rate', growth_rate: 'Growth Rate', arpu: 'ARPU' }`
- [x] Create METRIC_UNITS map: `{ mrr: 'currency', active_users: 'count', churn_rate: 'percent', error_rate: 'percent', growth_rate: 'percent', arpu: 'currency' }`
- [x] Export all types and constants

### Task 3: Create AlertRule Zod schema
File: `packages/shared/src/alert-rule.ts`
- [x] Define ALERT_CONDITIONS as const: `['drop_wow_pct', 'spike_vs_avg', 'below_threshold', 'above_threshold']`
- [x] Define ALERT_SEVERITIES as const: `['critical', 'high', 'medium', 'low']`
- [x] Create AlertCondition and AlertSeverity union types
- [x] Create AlertRuleSchema Zod object: metricKey (string, non-empty, max 100), condition (enum), threshold (number, >0, max 10000), severity (enum, default 'medium'), enabled (boolean, default true), minDataPoints (number, default 7, min 1, max 365)
- [x] Create AlertRuleSummary interface (id, startupId, metricKey, condition, threshold, severity, enabled, minDataPoints, createdAt, updatedAt)
- [x] Create AlertSummary interface (id, startupId, ruleId, metricKey, severity, value, threshold, status, occurrenceCount, snoozedUntil?, firedAt, lastFiredAt, resolvedAt?)
- [x] Define ALERT_STATUSES as const: `['active', 'acknowledged', 'snoozed', 'dismissed', 'resolved']`
- [x] Export all

### Task 4: Create EventLogEntry discriminated union schema
File: `packages/shared/src/event-log.ts`
- [x] Define EVENT_TYPES as const array with all 20 event types: `alert.fired`, `alert.ack`, `alert.snoozed`, `alert.dismissed`, `alert.resolved`, `connector.synced`, `connector.errored`, `connector.created`, `connector.deleted`, `insight.generated`, `insight.viewed`, `telegram.digest`, `telegram.alert`, `telegram.reaction`, `mcp.query`, `mcp.action`, `mcp.key_created`, `mcp.key_revoked`, `task.created`, `task.completed`, `webhook.delivered`, `webhook.failed`
- [x] Define ACTOR_TYPES as const: `['system', 'user', 'ai', 'mcp']`
- [x] Create per-type payload Zod schemas (z.object for each event type's payload shape)
- [x] Create EventLogEntry Zod discriminated union on eventType
- [x] Create EventLogEntrySummary interface (id, workspaceId, startupId?, eventType, actorType, actorId?, payload, createdAt)
- [x] Export all

### Task 5: Create MCP tool schemas
File: `packages/shared/src/mcp.ts`
- [x] Create McpResponse\<T\> generic Zod schema wrapper (data, dataAsOf, dashboardUrl, pagination?)
- [x] Create McpErrorResponse schema (error string, code enum NOT_FOUND|FORBIDDEN|RATE_LIMITED|INTERNAL, retryAfter?)
- [x] Create input schemas for all 8 tools: getMetricsInput, getAlertsInput, getAtRiskCustomersInput, getActivityLogInput, getPortfolioSummaryInput, createTaskInput, snoozeAlertInput, triggerSyncInput
- [x] Create output schemas for all 8 tools
- [x] Export all schemas

### Task 6: Create Telegram config schemas
File: `packages/shared/src/telegram.ts`
- [x] Create TelegramConfigSummary interface (id, workspaceId, botUsername?, chatId?, digestTime, digestTimezone, isActive, lastDigestAt?)
- [x] Create TelegramSetupInput Zod schema (botToken: string matching `/^\d+:[A-Za-z0-9_-]{35}$/`, digestTime: HH:MM, digestTimezone: IANA string)
- [x] Create digest payload schemas (per-startup summary shape)
- [x] Export all

### Task 7: Create Webhook schemas
File: `packages/shared/src/webhook.ts`
- [x] Create WebhookConfigSummary interface (id, startupId, url, eventTypes, enabled, consecutiveFailures, circuitBrokenAt?)
- [x] Create WebhookPayload Zod schema (event: EventType, timestamp: ISO string, startupId, payload: object, deliveryId: UUID)
- [x] Create WebhookConfigInput schema (url: HTTPS only, eventTypes: EventType[], enabled?)
- [x] Export all

### Task 8: Create ApiKey schemas
File: `packages/shared/src/api-key.ts`
- [x] Define API_KEY_SCOPES as const: `['read', 'write']`
- [x] Create ApiKeyScope type
- [x] Create ApiKeySummary interface (id, workspaceId, name, keyPrefix, scope, lastUsedAt?, revokedAt?, createdAt) — never includes key_hash
- [x] Create ApiKeyCreateInput Zod schema (name: non-empty max 100, scope: enum)
- [x] Export all

### Task 9: Update connector types
File: `packages/shared/src/connectors.ts`
- [x] Add 'yookassa' and 'sentry' to CONNECTOR_PROVIDERS const array
- [x] ConnectorProvider type auto-updates from const array
- [x] Update isConnectorProvider guard if it exists
- [x] Verify no downstream type errors

### Task 10: Update startup-health types
File: `packages/shared/src/startup-health.ts`
- [x] Replace SupportingMetricsSnapshot with import of UniversalMetrics from universal-metrics.ts
- [x] Remove NORTH_STAR_METRICS enum if present (northStarKey is now free-form string)
- [x] Update HealthSnapshotSummary: northStarValue becomes number|null (nullable), supportingMetrics becomes UniversalMetrics|null
- [x] Remove emptySupportingMetrics() and emptyFunnelStages() factory helpers
- [x] Update FunnelStageRow: rename stage to key (free-form string)
- [x] Remove FUNNEL_STAGES enum if present

### Task 11: Update custom-metric types
File: `packages/shared/src/custom-metric.ts`
- [x] Add CustomMetricCategory enum: `['engagement', 'revenue', 'health', 'growth', 'custom']`
- [x] Update CustomMetricSummary: add key, category, delta fields. Remove schema, view, status fields
- [x] Remove postgresSetupSchema if present (Postgres config is now connectionUri only)

### Task 12: Export all new modules from shared index
File: `packages/shared/src/index.ts`
- [x] Add exports for: universal-metrics, alert-rule, event-log, mcp, telegram, webhook, api-key
- [x] Verify all re-exports work (no circular deps)

### Task 13: Modify startup schema
File: `apps/api/src/db/schema/startup.ts`
- [x] Add northStarKey column: `text("north_star_key").notNull().default('mrr')`
- [x] Open type column: remove any enum constraint, keep as text validated at API layer
- [x] Open timezone column: remove hardcoded enum, keep as text validated at API layer
- [x] Open currency column: remove hardcoded enum, keep as text validated at API layer

### Task 14: Modify connector schema
File: `apps/api/src/db/schema/connector.ts`
- [x] Expand provider check constraint to include 'yookassa' and 'sentry'
- [x] Add 'stale' to status enum check constraint
- [x] Update the `sql\`CHECK(...)\`` to include new values

### Task 15: Modify health_snapshot schema
File: `apps/api/src/db/schema/startup-health.ts`
- [x] Change northStarValue from integer to numeric, make nullable
- [x] Change northStarPreviousValue to numeric
- [x] Replace supportingMetrics JSONB type annotation from SupportingMetricsSnapshot to UniversalMetrics

### Task 16: Modify health_funnel_stage schema
File: `apps/api/src/db/schema/startup-health.ts`
- [x] Rename stage column to key (text, free-form)
- [x] Update unique constraint to (startupId, key)

### Task 17: Modify custom_metric schema
File: `apps/api/src/db/schema/custom-metric.ts`
- [x] Add key column: `text("key").notNull().default('')`
- [x] Add category column: `text("category").notNull().default('custom')`
- [x] Add delta column: `numeric("delta")`
- [x] Drop schema column
- [x] Drop view column
- [x] Drop status column
- [x] Change unique constraint from (startupId) to (startupId, key)

### Task 18: Create alert_rule table schema
File: `apps/api/src/db/schema/alert-rule.ts` (NEW)
- [x] Create alertRule pgTable with: id (PK), startupId (FK to startup), metricKey, condition (CHECK IN alert conditions), threshold (numeric), severity (CHECK IN, default 'medium'), enabled (default true), minDataPoints (integer, default 7), createdAt, updatedAt
- [x] Add indexes: startup_idx on (startup_id), unique on (startup_id, metric_key, condition)
- [x] Create alertRuleRelations: many-to-one with startup, one-to-many with alert

### Task 19: Create alert table schema
File: `apps/api/src/db/schema/alert-rule.ts` (same file)
- [x] Create alert pgTable with: id (PK), startupId (FK), ruleId (FK to alertRule), metricKey, severity, value (numeric), threshold (numeric), status (CHECK IN alert statuses, default 'active'), occurrenceCount (integer, default 1), snoozedUntil (nullable), firedAt, lastFiredAt, resolvedAt (nullable), createdAt
- [x] Add indexes: startup_idx, status_idx, startup_status_idx, rule_idx
- [x] Create alertRelations: many-to-one with startup, many-to-one with alertRule

### Task 20: Create streak table schema
File: `apps/api/src/db/schema/alert-rule.ts` (same file)
- [x] Create streak pgTable with: id (PK), startupId (FK, unique), currentDays (integer, default 0), longestDays (integer, default 0), startedAt (nullable), brokenAt (nullable), updatedAt
- [x] Create streakRelations: one-to-one with startup

### Task 21: Create event_log table schema
File: `apps/api/src/db/schema/event-log.ts` (NEW)
- [x] Create eventLog pgTable with: id (PK), workspaceId (FK to workspace), startupId (FK to startup, nullable), eventType (text, NOT NULL), actorType (text, NOT NULL, CHECK IN actor types), actorId (text, nullable), payload (jsonb, NOT NULL), createdAt
- [x] Add indexes: workspace_created_idx on (workspace_id, created_at DESC), startup_created_idx on (startup_id, created_at DESC), type_idx on (event_type), created_idx on (created_at)
- [x] Create eventLogRelations: many-to-one with workspace (SET NULL on startup delete to preserve audit trail)

### Task 22: Create telegram_config table schema
File: `apps/api/src/db/schema/telegram-config.ts` (NEW)
- [x] Create telegramConfig pgTable with: id (PK), workspaceId (FK, UNIQUE), botToken, chatId (nullable), verificationCode (nullable), verificationExpiresAt (nullable), digestTime (default '09:00'), digestTimezone (default 'UTC'), isActive (default false), lastDigestAt (nullable), createdAt, updatedAt
- [x] Add indexes: workspace_uidx unique on (workspace_id), chat_idx on (chat_id)

### Task 23: Create webhook_config table schema
File: `apps/api/src/db/schema/webhook-config.ts` (NEW)
- [x] Create webhookConfig pgTable with: id (PK), startupId (FK, UNIQUE), url, secret, eventTypes (jsonb, default '[]'), enabled (default true), consecutiveFailures (integer, default 0), circuitBrokenAt (nullable), createdAt, updatedAt
- [x] Add indexes: startup_uidx unique on (startup_id), enabled_idx on (enabled)

### Task 24: Create api_key table schema
File: `apps/api/src/db/schema/api-key.ts` (NEW)
- [x] Create apiKey pgTable with: id (PK), workspaceId (FK), name, keyHash (unique), keyPrefix, scope (CHECK IN 'read','write'), lastUsedAt (nullable), revokedAt (nullable), createdAt
- [x] Add indexes: hash_uidx unique on (key_hash), workspace_idx on (workspace_id), prefix_idx on (key_prefix)

### Task 25: Create health_snapshot_history table schema
File: `apps/api/src/db/schema/startup-health.ts` (append to existing)
- [x] Create healthSnapshotHistory pgTable with: id (PK), startupId (FK), metricKey (text), value (numeric), snapshotId (FK to healthSnapshot), capturedAt (timestamptz)
- [x] Add indexes: startup_metric_idx on (startup_id, metric_key, captured_at DESC), captured_idx on (captured_at)

### Task 26: Generate Drizzle migrations
- [ ] Run drizzle-kit generate to produce migration SQL files in apps/api/drizzle/
- [ ] Verify migration files cover: schema opens (startup, connector), health changes, custom metric changes, all new tables
- [ ] Review generated SQL for correctness

### Task 27: Run database migrations
- [ ] Ensure Docker services are up (pnpm services:up)
- [ ] Run `bun run --cwd apps/api src/db/migrate.ts`
- [ ] Verify all migrations applied successfully

### Task 28: Create event log emitter
File: `apps/api/src/lib/events/emitter.ts` (NEW)
- [ ] Create emit() async function that inserts into event_log table
- [ ] Parameters: { workspaceId, startupId?, eventType, actorType, actorId?, payload }
- [ ] Use Drizzle insert with the eventLog table schema
- [ ] Export the emit function
- [ ] Keep it simple — no batching, no queuing, direct insert

### Task 29: Add new queue definitions
File: `apps/worker/src/queues.ts`
- [ ] Add TELEGRAM_QUEUE = "telegram" as const
- [ ] Add WEBHOOK_QUEUE = "webhook" as const
- [ ] Add PORTFOLIO_DIGEST_QUEUE = "portfolio-digest" as const
- [ ] Add EVENT_PURGE_QUEUE = "event-purge" as const
- [ ] Create queue factory functions and worker factory functions for each
- [ ] Telegram: concurrency 1, repeatable (cron-based per workspace)
- [ ] Webhook: concurrency 5, 4 retries with exponential backoff (60s, 300s, 900s, 3600s)
- [ ] Portfolio digest: concurrency 1, weekly repeatable
- [ ] Event purge: concurrency 1, daily repeatable
- [ ] Follow existing pattern from createSyncQueue/createSyncWorker
