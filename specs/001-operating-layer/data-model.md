# Data Model: Operating Layer

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document defines all entities, schema changes, relationships, validation rules, and state transitions for the Operating Layer milestone.

---

## Legend

- **MODIFY** — existing table with column changes
- **NEW** — table that does not exist yet
- **FK** — foreign key with cascade delete unless noted
- All PKs are `text` (UUIDv4 generated at insert)
- All timestamps are `timestamptz`

---

## 1. Modified Entities

### 1.1 `startup` (MODIFY)

**Current columns**: id, workspaceId, name, type, stage, timezone, currency, createdAt, updatedAt

**Changes:**

| Change | Before | After | Migration |
|--------|--------|-------|-----------|
| Add `northStarKey` | — | `text NOT NULL DEFAULT 'mrr'` | `ALTER TABLE startup ADD COLUMN north_star_key text NOT NULL DEFAULT 'mrr'` |
| Open `type` | Validated against `STARTUP_TYPES` enum (`b2b_saas`) | Free-form text. UI suggests defaults (`b2b_saas`, `b2c`, `marketplace`, `saas_tool`, `dev_tool`). No DB constraint | Remove shared `isStartupType()` enum guard; validate non-empty string only |
| Open `timezone` | Validated against 5 hardcoded zones | Free-form IANA string. Validate via `Intl.supportedValuesOf('timeZone')` | Remove shared `isStartupTimezone()` enum guard |
| Open `currency` | Validated against `USD \| EUR \| GBP` | Free-form ISO 4217 string (`/^[A-Z]{3}$/`). Display as-is | Remove shared `isStartupCurrency()` enum guard |

**Validation rules:**
- `name`: non-empty, trimmed, max 100 chars
- `type`: non-empty string, max 50 chars
- `stage`: one of `idea`, `mvp`, `growth` (kept as enum)
- `timezone`: must pass `Intl.supportedValuesOf('timeZone').includes(value)`
- `currency`: must match `/^[A-Z]{3}$/`
- `northStarKey`: non-empty string, max 100 chars (references any metric key)

**Indexes** (unchanged): `startup_workspaceId_idx`, `startup_workspace_name_uidx`

---

### 1.2 `connector` (MODIFY)

**Changes:**

| Change | Before | After | Migration |
|--------|--------|-------|-----------|
| Expand provider check | `IN ('posthog', 'stripe', 'postgres')` | `IN ('posthog', 'stripe', 'postgres', 'yookassa', 'sentry')` | `ALTER TABLE connector DROP CONSTRAINT connector_provider_check; ALTER TABLE connector ADD CONSTRAINT connector_provider_check CHECK (provider IN ('posthog', 'stripe', 'postgres', 'yookassa', 'sentry'))` |
| Add `stale` status | `IN ('pending', 'connected', 'error', 'disconnected')` | Add `'stale'` | Update status check constraint |

**Connector config shapes** (encrypted in `encryptedConfig`):

| Provider | Config Shape | Validation Endpoint |
|----------|-------------|-------------------|
| `posthog` | `{ apiKey, projectId, host }` | `GET {host}/api/projects/{projectId}/` |
| `stripe` | `{ secretKey }` | `GET /v1/balance` |
| `postgres` | `{ connectionUri }` | Connect + introspect `information_schema.columns` |
| `yookassa` (NEW) | `{ shopId, secretKey }` | `GET https://api.yookassa.ru/v3/me` (HTTP Basic) |
| `sentry` (NEW) | `{ authToken, organization, project }` | `GET https://sentry.io/api/0/projects/{org}/{project}/` (Bearer) |

**Shared type change**: `CONNECTOR_PROVIDERS` in `packages/shared/src/connectors.ts` adds `'yookassa'` and `'sentry'`.

---

### 1.3 `health_snapshot` (MODIFY)

**Changes:**

| Change | Before | After | Migration |
|--------|--------|-------|-----------|
| `northStarKey` type | `text NOT NULL` (only `'mrr'` used) | `text NOT NULL` (any metric key) | No DB change needed — column is already text |
| `northStarValue` type | `integer NOT NULL` | `numeric` (nullable — no data if metric not connected) | `ALTER TABLE health_snapshot ALTER COLUMN north_star_value TYPE numeric USING north_star_value::numeric, ALTER COLUMN north_star_value DROP NOT NULL` |
| `northStarPreviousValue` type | `integer` | `numeric` | `ALTER TABLE health_snapshot ALTER COLUMN north_star_previous_value TYPE numeric USING north_star_previous_value::numeric` |
| `supportingMetrics` shape | Required 5-key `SupportingMetricsSnapshot` | Nullable `UniversalMetrics` JSONB (6 nullable keys) | Rewrite JSONB column in migration |

**New `UniversalMetrics` JSONB shape** (replaces `SupportingMetricsSnapshot`):

```typescript
interface UniversalMetrics {
  mrr?: number | null;
  active_users?: number | null;
  churn_rate?: number | null;
  error_rate?: number | null;
  growth_rate?: number | null;   // Porta-computed from north star WoW delta
  arpu?: number | null;
}
```

All fields nullable. Only populated when a connector provides matching `metric_key`. These power Compare mode columns.

**Shared type change**: Replace `SupportingMetricsSnapshot` with `UniversalMetrics` in `packages/shared/src/startup-health.ts`. Update `HealthSnapshotSummary` interface.

---

### 1.4 `health_funnel_stage` (MODIFY)

**Changes:**

| Change | Before | After |
|--------|--------|-------|
| `stage` column | Validated against `FUNNEL_STAGES` enum (`visitor \| signup \| activation \| paying_customer`) | Free-form text `key` (e.g., `bot_start`, `family_created`) |
| Unique constraint | `(startupId, stage)` | `(startupId, key)` — rename column to `key` |

**Migration**: Rename column `stage` → `key`. Update unique index. Drop shared `isFunnelStage()` guard.

**Shared type change**: `FunnelStageRow.stage` becomes `FunnelStageRow.key: string`. Remove `FUNNEL_STAGES` enum.

---

### 1.5 `custom_metric` (MODIFY)

**Changes:**

| Change | Before | After | Migration |
|--------|--------|-------|-----------|
| Unique constraint | `unique(startupId)` (one metric per startup) | `unique(startupId, key)` (unlimited per startup) | Drop old unique, add new |
| Add `key` column | — | `text NOT NULL` | `ALTER TABLE custom_metric ADD COLUMN key text NOT NULL DEFAULT ''` |
| Add `category` column | — | `text NOT NULL DEFAULT 'custom'` | `ALTER TABLE custom_metric ADD COLUMN category text NOT NULL DEFAULT 'custom'` |
| Add `delta` column | — | `numeric` (nullable, Porta-computed) | `ALTER TABLE custom_metric ADD COLUMN delta numeric` |
| Remove `schema` column | `text NOT NULL` | dropped | `ALTER TABLE custom_metric DROP COLUMN schema` |
| Remove `view` column | `text NOT NULL` | dropped | `ALTER TABLE custom_metric DROP COLUMN view` |
| Remove `status` column | `text NOT NULL DEFAULT 'pending'` | dropped (status lives on connector) | `ALTER TABLE custom_metric DROP COLUMN status` |

**Final columns**: id, startupId, connectorId, key, label, unit, category, metricValue (renamed from `metric_value` in code), previousValue, delta, capturedAt, createdAt, updatedAt

**Category enum**: `engagement | revenue | health | growth | custom`

**Validation rules:**
- `key`: non-empty, max 100 chars, alphanumeric + underscores (`/^[a-z][a-z0-9_]{0,99}$/`)
- `label`: non-empty, max 200 chars
- `unit`: non-empty, max 50 chars
- `category`: one of the enum values
- `metricValue`: finite number
- `previousValue`, `delta`: finite number or null

---

## 2. New Entities

### 2.1 `alert_rule` (NEW)

Alert rule definitions. One rule per metric-condition combination per startup.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `startup_id` | text | FK → startup, NOT NULL | Owning startup |
| `metric_key` | text | NOT NULL | Any universal or custom metric key (free-form) |
| `condition` | text | NOT NULL, CHECK IN enum | `drop_wow_pct`, `spike_vs_avg`, `below_threshold`, `above_threshold` |
| `threshold` | numeric | NOT NULL, CHECK > 0 | Percentage (0.01-100) or multiplier (0.01-100) depending on condition |
| `severity` | text | NOT NULL DEFAULT 'medium', CHECK IN enum | `critical`, `high`, `medium`, `low` |
| `enabled` | boolean | NOT NULL DEFAULT true | Toggle |
| `min_data_points` | integer | NOT NULL DEFAULT 7 | Z-score guard |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `alert_rule_startup_idx` on `(startup_id)`
- `alert_rule_startup_metric_condition_uidx` UNIQUE on `(startup_id, metric_key, condition)`

**Relationships:**
- `startup` → many `alert_rule` (cascade delete)

**Validation rules:**
- `threshold`: > 0, max 10000. Percentage conditions (`drop_wow_pct`): capped at 100. Multiplier conditions (`spike_vs_avg`): capped at 100.
- `min_data_points`: >= 1, max 365
- `metric_key`: non-empty string, max 100 chars

**State transitions:** N/A — rules are static config, not stateful.

---

### 2.2 `alert` (NEW)

Fired alert instances. Created when an alert rule triggers.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `startup_id` | text | FK → startup, NOT NULL | |
| `rule_id` | text | FK → alert_rule, NOT NULL | Which rule fired |
| `metric_key` | text | NOT NULL | Denormalized from rule for query efficiency |
| `severity` | text | NOT NULL | Denormalized from rule |
| `value` | numeric | NOT NULL | Metric value that triggered the alert |
| `threshold` | numeric | NOT NULL | Rule threshold at fire time |
| `status` | text | NOT NULL DEFAULT 'active', CHECK IN enum | `active`, `acknowledged`, `snoozed`, `dismissed`, `resolved` |
| `occurrence_count` | integer | NOT NULL DEFAULT 1 | Dedup counter (US-8) |
| `snoozed_until` | timestamptz | | When snooze expires |
| `fired_at` | timestamptz | NOT NULL | First occurrence |
| `last_fired_at` | timestamptz | NOT NULL | Most recent occurrence |
| `resolved_at` | timestamptz | | When metric returned to normal |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `alert_startup_idx` on `(startup_id)`
- `alert_status_idx` on `(status)`
- `alert_startup_status_idx` on `(startup_id, status)` — for Decide mode queries
- `alert_rule_idx` on `(rule_id)`

**Relationships:**
- `startup` → many `alert` (cascade delete)
- `alert_rule` → many `alert` (cascade delete)

**State transitions:**
```
active → acknowledged (user acks via dashboard/Telegram)
active → snoozed (user snoozes — sets snoozed_until)
active → dismissed (user dismisses)
active → resolved (metric returns to normal)
snoozed → active (snooze expires)
snoozed → resolved (metric returns to normal while snoozed)
```

**Dedup logic (US-8):** When an alert rule fires again for the same startup while an active/snoozed alert exists for that rule, increment `occurrence_count` and update `last_fired_at` instead of creating a new row.

---

### 2.3 `event_log` (NEW)

Append-only decision journal. Never updated after insert (except PII redaction for DSAR).

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `workspace_id` | text | FK → workspace, NOT NULL | Tenant isolation |
| `startup_id` | text | FK → startup (nullable) | Some events are workspace-level |
| `event_type` | text | NOT NULL | Discriminated union key (see enum below) |
| `actor_type` | text | NOT NULL, CHECK IN enum | `system`, `user`, `ai`, `mcp` |
| `actor_id` | text | | user.id, `system`, `claude`, or API key prefix |
| `payload` | jsonb | NOT NULL | Per-event-type structured data |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `event_log_workspace_created_idx` on `(workspace_id, created_at DESC)` — primary query path
- `event_log_startup_created_idx` on `(startup_id, created_at DESC)` — journal mode queries
- `event_log_type_idx` on `(event_type)` — filter by type
- `event_log_created_idx` on `(created_at)` — purge job

**Event type enum:**
```
alert.fired, alert.ack, alert.snoozed, alert.dismissed, alert.resolved
connector.synced, connector.errored, connector.created, connector.deleted
insight.generated, insight.viewed
telegram.digest, telegram.alert, telegram.reaction
mcp.query, mcp.action, mcp.key_created, mcp.key_revoked
task.created, task.completed
webhook.delivered, webhook.failed
```

**Relationships:**
- `workspace` → many `event_log` (cascade delete)
- `startup` → many `event_log` (SET NULL on delete — preserve workspace-level audit trail)

**Retention:** 90-day default. Daily BullMQ purge job deletes events older than retention period. If `workspace.legal_hold_until` is set and in the future, PII fields in payload are redacted but event structure preserved.

**Tenant isolation:** ALL queries MUST filter by `workspace_id`. Direct queries MUST join through workspace to prevent cross-tenant leakage.

---

### 2.4 `telegram_config` (NEW)

One row per workspace. Links a Telegram chat to a Porta workspace.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `workspace_id` | text | FK → workspace, UNIQUE, NOT NULL | One config per workspace |
| `bot_token` | text | NOT NULL | BotFather token (encrypted? TBD in research) |
| `chat_id` | text | | Telegram chat ID (set after /start verification) |
| `verification_code` | text | | One-time code for linking |
| `verification_expires_at` | timestamptz | | Code expiry (15 minutes) |
| `digest_time` | text | NOT NULL DEFAULT '09:00' | HH:MM format |
| `digest_timezone` | text | NOT NULL DEFAULT 'UTC' | IANA timezone |
| `is_active` | boolean | NOT NULL DEFAULT false | Set true after verification, false on bot removal |
| `last_digest_at` | timestamptz | | Track last digest delivery |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `telegram_config_workspace_uidx` UNIQUE on `(workspace_id)`
- `telegram_config_chat_idx` on `(chat_id)` — lookup on incoming Telegram updates

**Validation rules:**
- `bot_token`: non-empty, matches Telegram bot token format (`/^\d+:[A-Za-z0-9_-]{35}$/`)
- `digest_time`: matches `HH:MM` format, valid hour/minute
- `digest_timezone`: valid IANA timezone
- `chat_id`: set only after `/start <code>` verification

**State transitions:**
```
created (no chat_id) → verified (chat_id set, is_active=true)
verified → inactive (bot removed/403, is_active=false)
inactive → verified (re-link via new verification code)
verified → unlinked (user removes in dashboard — delete row or clear chat_id)
```

---

### 2.5 `webhook_config` (NEW)

Webhook delivery config per startup.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `startup_id` | text | FK → startup, NOT NULL | One webhook per startup |
| `url` | text | NOT NULL | HTTPS only. No private IPs |
| `secret` | text | NOT NULL | Shared secret for HMAC-SHA256 signing |
| `event_types` | jsonb | NOT NULL DEFAULT '[]' | Filter: which event types trigger delivery |
| `enabled` | boolean | NOT NULL DEFAULT true | |
| `consecutive_failures` | integer | NOT NULL DEFAULT 0 | Circuit breaker counter |
| `circuit_broken_at` | timestamptz | | Set when failures >= 10 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `webhook_config_startup_uidx` UNIQUE on `(startup_id)` — one webhook per startup
- `webhook_config_enabled_idx` on `(enabled)`

**Validation rules:**
- `url`: must be HTTPS (`/^https:\/\//`). Must not resolve to private IP (RFC 1918, link-local, loopback, `169.254.x.x`). Validated at config time AND delivery time (DNS rebinding guard)
- `secret`: auto-generated, min 32 chars
- `event_types`: array of valid event type strings (from event log enum)

**Circuit breaker:** After 10 consecutive failures → set `circuit_broken_at`, set `enabled = false`, log `webhook.circuit_broken` event, notify operator.

---

### 2.6 `api_key` (NEW)

API keys for MCP/REST access. Scoped to workspace with read/write permissions.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `workspace_id` | text | FK → workspace, NOT NULL | |
| `name` | text | NOT NULL | Human label (e.g., "Claude Code key") |
| `key_hash` | text | NOT NULL, UNIQUE | SHA-256 hash of the full key |
| `key_prefix` | text | NOT NULL | First 8 chars of key (for display + audit log) |
| `scope` | text | NOT NULL, CHECK IN enum | `read`, `write` (write implies read) |
| `last_used_at` | timestamptz | | Updated on each request |
| `revoked_at` | timestamptz | | Set on revocation (soft delete) |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:**
- `api_key_hash_uidx` UNIQUE on `(key_hash)` — lookup path
- `api_key_workspace_idx` on `(workspace_id)`
- `api_key_prefix_idx` on `(key_prefix)` — audit log correlation

**Key format:** `porta_<read|write>_<32 random chars>` (e.g., `porta_read_a1b2c3d4...`)

**Validation rules:**
- `name`: non-empty, max 100 chars
- `scope`: `read` or `write`
- Key is shown plaintext ONLY at creation time. Never stored or returned after.

**State transitions:**
```
active (revoked_at IS NULL) → revoked (revoked_at set)
```
Revocation is immediate. Revoked keys return 401. No un-revoke — create a new key.

---

### 2.7 `streak` (NEW)

Healthy streak tracking per startup for badge display (US-8).

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `startup_id` | text | FK → startup, UNIQUE, NOT NULL | One streak per startup |
| `current_days` | integer | NOT NULL DEFAULT 0 | Consecutive healthy days |
| `longest_days` | integer | NOT NULL DEFAULT 0 | Historical best |
| `started_at` | timestamptz | | When current streak began |
| `broken_at` | timestamptz | | When last streak broke |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Badge thresholds:** 7+ = bronze, 14+ = silver, 30+ = gold. Configurable per workspace (stored in workspace settings, not this table).

---

### 2.8 `health_snapshot_history` (NEW)

Historical snapshot values for Z-score alert evaluation. Rolling 30-day window.

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| `id` | text | PK | UUIDv4 |
| `startup_id` | text | FK → startup, NOT NULL | |
| `metric_key` | text | NOT NULL | Universal or custom metric key |
| `value` | numeric | NOT NULL | Metric value at snapshot time |
| `snapshot_id` | text | FK → health_snapshot | Reference to the snapshot |
| `captured_at` | timestamptz | NOT NULL | When value was recorded |

**Indexes:**
- `snapshot_history_startup_metric_idx` on `(startup_id, metric_key, captured_at DESC)` — Z-score query path
- `snapshot_history_captured_idx` on `(captured_at)` — purge old data

**Retention:** 90 days (aligned with event log). Purged by same daily job.

---

## 3. Entity Relationship Diagram

```
workspace (auth.ts)
  ├── 1:N startup
  │     ├── 1:N connector (+ sync_job)
  │     ├── 1:1 health_snapshot
  │     │     └── 1:N health_funnel_stage
  │     ├── 1:N custom_metric
  │     ├── 1:N alert_rule
  │     │     └── 1:N alert
  │     ├── 1:N event_log (also workspace-scoped)
  │     ├── 0:1 webhook_config
  │     ├── 1:1 streak
  │     └── 1:N health_snapshot_history
  ├── 0:1 telegram_config
  ├── 1:N api_key
  └── 1:N event_log
```

---

## 4. Migration Plan

Migrations numbered sequentially from `0007`:

| # | File | Tables Affected | Type |
|---|------|----------------|------|
| 0007 | `s08_open_enums.sql` | startup, connector | ALTER — open up type/currency/timezone, expand provider check, add northStarKey |
| 0008 | `s09_health_universal.sql` | health_snapshot, health_funnel_stage | ALTER — universal metrics JSONB, numeric north star, free-form funnel key |
| 0009 | `s10_custom_metric_multi.sql` | custom_metric | ALTER — add key/category/delta, remove schema/view/status, change unique constraint |
| 0010 | `s11_alert_system.sql` | alert_rule, alert, streak | CREATE — alert rules, fired alerts, streaks |
| 0011 | `s12_event_log.sql` | event_log | CREATE — append-only event log |
| 0012 | `s13_telegram_config.sql` | telegram_config | CREATE — Telegram bot linking |
| 0013 | `s14_webhook_config.sql` | webhook_config | CREATE — webhook delivery config |
| 0014 | `s15_api_key.sql` | api_key | CREATE — MCP/API key management |
| 0015 | `s16_snapshot_history.sql` | health_snapshot_history | CREATE — metric history for Z-score |

**Migration order rationale:** Schema opens (0007) before feature tables, because connectors depend on expanded provider check. Alert system (0010) before event log (0011) because alert events reference alert IDs. API key (0014) is independent.

---

## 5. Shared Type Changes Summary

| Module | Key Changes |
|--------|------------|
| `types.ts` | Remove `STARTUP_TYPES`, `STARTUP_TIMEZONES`, `STARTUP_CURRENCIES` enums. `StartupDraft.type/timezone/currency` become `string` with runtime validation |
| `connectors.ts` | `CONNECTOR_PROVIDERS` adds `'yookassa'`, `'sentry'`. Update `ConnectorProvider` type |
| `startup-health.ts` | Replace `NORTH_STAR_METRICS` with `northStarKey: string`. Replace `SupportingMetricsSnapshot` with `UniversalMetrics` (6 nullable keys). `FunnelStageRow.stage` → `.key: string`. Remove `FUNNEL_STAGES` enum. Remove `emptySupportingMetrics()`, `emptyFunnelStages()`. Add `UNIVERSAL_METRIC_KEYS` const |
| `custom-metric.ts` | Remove `postgresSetupSchema` (no longer needed — Postgres connector config is connectionUri only). Add `CustomMetricCategory` enum. Update `CustomMetricSummary` shape |
| `alert-rule.ts` (NEW) | `AlertRuleSchema` Zod type, `AlertCondition` enum, `AlertSeverity` enum |
| `event-log.ts` (NEW) | `EventLogEntry` Zod discriminated union, `EventType` enum, per-type payload shapes |
| `mcp.ts` (NEW) | 8 MCP tool input/output Zod schemas, `McpResponse<T>` wrapper, `McpErrorResponse` |
| `telegram.ts` (NEW) | `TelegramConfigSummary`, digest payload shapes |
| `webhook.ts` (NEW) | `WebhookConfigSummary`, `WebhookPayload` Zod schema, `WebhookDeliveryResult` |
| `api-key.ts` (NEW) | `ApiKeySummary` (never includes hash), `ApiKeyScope` enum |
| `universal-metrics.ts` (NEW) | `UNIVERSAL_METRIC_KEYS` const (`mrr`, `active_users`, `churn_rate`, `error_rate`, `growth_rate`, `arpu`), `UniversalMetrics` interface, labels/units maps |
