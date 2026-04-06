# Dogfood-Ready Metrics & Connectors

Amendments to `specs/001-operating-layer/spec.md` enabling Porta to dogfood with real startup data from Triggo, amocrm-kernel, and HeyMily — while keeping the design universal for OSS adoption.

## Problem

Porta's current metric system is hardcoded for a Stripe + PostHog B2B SaaS stack: 5 fixed supporting metrics, MRR-only north star, USD/EUR/GBP currencies, no YooKassa connector, and one custom metric per startup. None of the founder's three startups use Stripe or PostHog yet. All revenue flows through YooKassa in RUB. Each startup has a PostgreSQL database full of business data that Porta can't reach.

## Decisions

1. **Universal base + custom extensions** — 6 universal metrics (nullable) power Compare mode and portfolio AI. Unlimited custom metrics per startup for domain-specific KPIs.
2. **Smart Postgres connector** — introspects remote DB schema, AI generates a single `porta_metrics` view, user reviews and runs it. One view returns all custom metrics as rows.
3. **YooKassa for payment signals, Postgres for MRR** — YooKassa connector syncs raw payment data (revenue, refunds, failed payments). MRR calculation lives in the startup's Postgres view because the startup knows its own billing model.
4. **Porta stores metric history, computes deltas** — views return current values only. Porta compares to previous snapshots for WoW/MoM trends. Simplifies view SQL.
5. **Per-startup configurable north star + funnel** — north star can be any metric key. Funnel stages are data-driven, not hardcoded.
6. **Alerts on any metric key** — alert rules reference a string `metricKey`, not an enum. Default alert seeding adapts to which metrics are available after first sync.

## Schema Changes

### Startup model expansion

**Enums to expand or open up:**

| Field | Current | New |
|-------|---------|-----|
| `StartupCurrency` | `USD \| EUR \| GBP` | Free-form ISO 4217 string (e.g., `RUB`, `USD`, `BRL`). Validate against 3-letter ISO 4217 pattern. Displayed as-is in dashboard. |
| `StartupTimezone` | 5 hardcoded zones (UTC, US, EU) | Free-form IANA timezone string (e.g., `Europe/Moscow`, `Asia/Tokyo`). Validate against `Intl.supportedValuesOf('timeZone')`. |
| `StartupType` | `b2b_saas` | Free-form string with suggested defaults in UI dropdown (`b2b_saas`, `b2c`, `marketplace`, `saas_tool`, `dev_tool`). No enum constraint — stored as text. |
| `ConnectorProvider` | `posthog \| stripe \| postgres` | Add `yookassa \| sentry` |

**New column on `startup` table:**

```
northStarKey: text, default "mrr"
```

References any universal or custom metric key. HeyMily → `"active_families"`, amocrm-kernel → `"active_installs"`, Triggo → `"mrr"`.

### Universal metrics

Replace the current rigid `SupportingMetricsSnapshot` (5 required keys) with a nullable typed map on `healthSnapshot`:

```
universalMetrics: JSONB {
  mrr?:           number  // monthly recurring revenue (startup's currency)
  active_users?:  number  // active users in configured window
  churn_rate?:    number  // % lost in rolling window
  error_rate?:    number  // errors per time unit (from Sentry)
  growth_rate?:   number  // % WoW change in north star (computed by Porta from snapshot history, not connector-provided)
  arpu?:          number  // average revenue per user
}
```

All fields nullable. Only populated when a connector provides the data. These are the Compare mode columns.

### Custom metrics (multi-row per startup)

Remove `unique(startupId)` constraint. New schema:

```
customMetric:
  id:           uuid PK
  startupId:    FK → startup (cascade)
  connectorId:  FK → connector (cascade)
  key:          text (e.g., "pipeline_runs")
  label:        text (e.g., "Pipeline Runs")
  unit:         text (e.g., "runs/week")
  category:     enum (engagement | revenue | health | growth | custom)
  value:        numeric
  previousValue: numeric (nullable, computed by Porta from last sync)
  delta:        numeric (nullable, computed by Porta)
  capturedAt:   timestamptz
  createdAt:    timestamptz
  updatedAt:    timestamptz

  UNIQUE(startupId, key)  -- one value per metric key per startup
```

### Funnel stages become data-driven

Replace the `FunnelStage` enum (`visitor | signup | activation | paying_customer`) with free-form keys:

```
healthFunnelStage:
  id, startupId, key (text), label, value, position, snapshotId, createdAt
  UNIQUE(startupId, key)
```

Default seed for `b2b_saas`: visitor/signup/activation/paying_customer. Other startup types define their own funnel during onboarding or via first sync.

Examples:
- HeyMily: `bot_start → family_created → first_action → recurring_user`
- amocrm-kernel: `marketplace_view → install → trial → paid`

### Alert rules

`metricKey` becomes a free-form string instead of referencing the `SupportingMetric` enum:

```
alert_rule:
  id:            uuid PK
  startupId:     FK → startup (cascade)
  metricKey:     text (matches any universal or custom metric key)
  condition:     enum (drop_wow_pct | spike_vs_avg | below_threshold | above_threshold)
  threshold:     numeric (min 0.01, max 10000)
  severity:      enum (critical | high | medium | low)
  enabled:       boolean
  minDataPoints: integer (default 7)
  createdAt:     timestamptz
  updatedAt:     timestamptz
```

## Connector Changes

### Postgres connector: multi-metric via `porta_metrics` view

**Config schema:**

```
PostgresConnectorConfig:
  connectionUri: string (postgres:// or postgresql://)
```

No view/schema/label/unit fields in config. The connector discovers metrics from the view automatically.

**Connection flow:**

1. **First connect** — Porta connects, validates access, introspects schema:
   ```sql
   SELECT table_name, column_name, data_type
   FROM information_schema.columns
   WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
   ORDER BY table_name, ordinal_position
   ```
   Stores schema snapshot for AI view generation.

2. **AI view generation** — Porta feeds the schema to an LLM with a system prompt:
   > "Given this PostgreSQL schema, generate a CREATE VIEW porta_metrics statement that extracts the most valuable business metrics. The view must return rows with columns: metric_key (text), label (text), unit (text), category (text: engagement/revenue/health/growth/custom), value (numeric), captured_at (timestamptz)."

   The AI produces startup-appropriate metrics based on what tables exist. Dashboard presents the generated SQL for user review and editing.

3. **User runs the SQL** in their database (copy-paste from dashboard or MCP tool output).

4. **Sync** — Porta runs:
   ```sql
   SELECT metric_key, label, unit, category, value, captured_at
   FROM porta_metrics
   ```
   Each row becomes a `customMetric` record. Porta computes `previousValue` and `delta` by comparing to the last sync's stored values.

**View contract (6 columns):**

| Column | Type | Description |
|--------|------|-------------|
| `metric_key` | text | Unique identifier (e.g., `active_families`, `pipeline_runs`) |
| `label` | text | Human-readable name |
| `unit` | text | Display unit (e.g., `families`, `RUB`, `runs/week`) |
| `category` | text | One of: `engagement`, `revenue`, `health`, `growth`, `custom` |
| `value` | numeric | Current metric value |
| `captured_at` | timestamptz | When the value was computed |

**Metric-to-universal mapping:** If a `porta_metrics` row has a `metric_key` matching a universal metric name (`mrr`, `active_users`, `churn_rate`, `error_rate`, `arpu`), Porta promotes it to the universal slot on the health snapshot. This means a Postgres view alone can populate the entire universal metrics set — no native connector required.

**View validation:** On sync, if `porta_metrics` doesn't exist, connector status → error with message "View porta_metrics not found. Generate it from the dashboard or run the provided SQL." If it exists but returns no rows, status → connected with empty metrics (not an error — startup may have no data yet).

### YooKassa connector (new)

**Config:** `shop_id` (string) + `secret_key` (string, encrypted at rest)

**Auth:** HTTP Basic Auth (shop_id:secret_key) over HTTPS to `https://api.yookassa.ru/v3/`.

**Validation:** `GET /v3/me` — confirms credentials and returns shop info.

**Syncs:**

| Data | API endpoint | Metric produced |
|------|-------------|-----------------|
| Successful payments (30d) | `GET /v3/payments?status=succeeded&created_at.gte=...` | `yookassa_revenue_30d` (custom metric, sum of amounts) |
| Failed payments (30d) | `GET /v3/payments?status=canceled&created_at.gte=...` | `yookassa_failed_payments` (custom metric, count) |
| Refunds (30d) | `GET /v3/refunds?created_at.gte=...` | `yookassa_refunds_30d` (custom metric, count + sum) |

**YooKassa does NOT provide:**
- Subscription state (managed by the startup's app)
- Customer-level aggregation (payments are per-transaction, customer_id optional)
- MRR calculation (no concept of recurring billing)

**Therefore:** MRR comes from the startup's Postgres `porta_metrics` view, which queries the startup's own `subscriptions` table. YooKassa adds payment health signals (failed payments, refunds) that the subscription table doesn't track.

**Scoping note:** The `secret_key` should be scoped to read-only access. YooKassa API keys are shop-level and cannot be scoped — document the risk and recommend a dedicated read-only shop if the founder operates multiple shops. Same recommendation as spec US-5.

**Pagination:** YooKassa returns max 100 payments per request with cursor-based pagination. Connector must paginate through all results within the 30d window.

### Sentry connector (new)

**Config:** `auth_token` (string, encrypted) + `organization` (slug) + `project` (slug)

**Auth:** Bearer token. Required scope: `project:read`.

**Validation:** `GET /api/0/projects/{org}/{project}/` — confirms access.

**Syncs:**

| Data | API endpoint | Metric produced |
|------|-------------|-----------------|
| Error count (24h) | `GET /api/0/projects/{org}/{project}/stats/` | Universal: `error_rate` |
| P95 latency | `GET /api/0/projects/{org}/{project}/stats/` (transaction events) | Custom: `p95_latency` |
| Crash-free sessions | `GET /api/0/projects/{org}/{project}/sessions/` | Custom: `crash_free_rate` |

**Mapping:** `error_rate` maps directly to the universal metric slot. P95 and crash-free are custom metrics.

## Sync Pipeline Changes

### Current flow
```
sync → snapshot → insight → task
```

### New flow
```
connector sync
  → collect raw metrics (provider-specific)
  → normalize to metric map (universal + custom)
  → merge with other connectors' metrics for this startup
  → recompute healthSnapshot (universal metrics + north star)
  → upsert customMetric rows (with Porta-computed previousValue, delta)
  → evaluate alert rules (all enabled rules for this startup's metrics)
  → generate insight (if conditions detected)
  → notify (event log, Telegram, webhooks)
```

### Multi-source merge

When a connector syncs, Porta loads the latest values from ALL connectors for that startup, then merges:

- YooKassa provides: `yookassa_revenue_30d`, `yookassa_failed_payments`, `yookassa_refunds_30d`
- Sentry provides: `error_rate`, `p95_latency`, `crash_free_rate`
- Postgres provides: whatever `porta_metrics` returns (can include `mrr`, `active_users`, `churn_rate`, plus custom keys)
- PostHog provides: `active_users`, `trial_conversion_rate` (when available)

**Conflict resolution:** If two connectors provide the same `metric_key`, the most recently synced value wins. This allows Postgres views to override native connector values if the founder prefers their own calculation (e.g., a startup's Postgres MRR view is more accurate than YooKassa's payment sum).

### Alert evaluation

Post-snapshot, iterate all `alert_rule` rows for this startup where `enabled = true`:

1. Look up `metricKey` in universal metrics and custom metrics
2. Skip if metric not found (connector not yet providing this data)
3. Skip if fewer than `minDataPoints` historical snapshots exist
4. Evaluate condition against current value + history (Z-score guard with 2.5 SD threshold for spike/drop conditions)
5. Fire alert → event log entry (`alert.fired`) with severity, metric key, value, threshold

### Default alert seeding

After a startup's first successful sync, seed default alerts based on which metrics arrived:

| Metric key | Default alert | Severity |
|------------|--------------|----------|
| `mrr` | drop >20% WoW | critical |
| `active_users` | drop >25% WoW | high |
| `churn_rate` | above_threshold 10% | high |
| `error_rate` | spike >3x rolling avg | critical |
| `yookassa_failed_payments` | spike >2x rolling avg | high |
| `active_installs` | drop >25% WoW | high |
| `active_families` | drop >25% WoW | high |

Only seed for metrics that exist. Don't seed for custom metrics with no known semantics — founder adds those manually.

## Dogfood Deployment Plan

### What each startup needs

**Triggo** (`../triggo`, PostgreSQL 17):
- Connectors: YooKassa + Sentry + Postgres
- Postgres `porta_metrics` view: mrr, active_users, registered_users, churn_rate, pipeline_runs_weekly, ai_generations_weekly, llm_cost_daily, paid_subscribers, trial_conversion_rate, open_incidents
- North star: `mrr`
- Funnel: visitor → signup → first_pipeline → paying_customer

**amocrm-kernel** (`../amocrm-kernel`, PostgreSQL 16):
- Connectors: YooKassa + Sentry + Postgres
- Postgres `porta_metrics` view: mrr (active installs x plan price), active_installs, new_installs_weekly, uninstalls_weekly, trial_conversion_rate, failed_payments, total_accounts
- North star: `active_installs`
- Funnel: marketplace_view → install → trial → paid
- Note: amounts in kopeks (1 RUB = 100 kopeks) — view should convert to RUB

**HeyMily** (`../heymily`, PostgreSQL):
- Connectors: Postgres (no payments yet)
- Postgres `porta_metrics` view: active_families, total_families, messages_daily, classification_accuracy, llm_cost_daily, tasks_completed_weekly, feature_adoption, expense_tracking_active
- North star: `active_families`
- Funnel: bot_start → family_created → first_action → recurring_user
- Note: no revenue metrics until payment integration ships

### Porta schema/code changes required

1. Change `StartupCurrency` to free-form ISO 4217 string
2. Change `StartupTimezone` to free-form IANA string (validate with `Intl.supportedValuesOf`)
3. Change `StartupType` to free-form string with UI suggestions
4. Add `northStarKey` column to `startup` table
5. Remove `unique(startupId)` from `customMetric`, add `unique(startupId, key)`. Add `key`, `category`, `delta` columns. Remove `schema`, `view` columns.
6. Change `healthSnapshot.supportingMetrics` JSONB to nullable universal metrics shape
7. Make `healthFunnelStage.stage` a free-form text `key` instead of enum
8. Add `alert_rule` table with `metricKey` as text
9. Add `yookassa` and `sentry` to `ConnectorProvider` enum
10. Implement Postgres schema introspection + AI view generation
11. Implement YooKassa connector (validate, sync payments/refunds)
12. Implement Sentry connector (validate, sync error rate/latency)
13. Update sync pipeline to merge multi-source metrics
14. Update health snapshot computation for universal + custom metrics
15. Update alert evaluation to work with dynamic metric keys
16. Update insight condition detection for expanded metric set

## Spec Amendments to 001-operating-layer

These changes amend the original spec. Sections not listed here remain unchanged.

**US-1 (Alerts):** `metric` field in alert rule schema becomes `metricKey: string` instead of `enum matching SupportingMetric union`. Default alert rules seeded conditionally based on available metrics after first sync, not 5 fixed rules per startup.

**US-5 (Connectors):** Postgres connector supports multi-metric via single `porta_metrics` view (6-column contract). Add schema introspection and AI-assisted view generation flow. YooKassa connector syncs raw payment data; MRR from Postgres view. Both connectors coexist with all others.

**Shared types:** `NorthStarMetric` becomes `northStarKey: string` per startup (not a global enum). `SupportingMetricsSnapshot` replaced by nullable `universalMetrics` JSONB + multi-row `customMetric` table. `FunnelStage` enum replaced by free-form `key` string.

**Enums:** `StartupCurrency` adds `RUB`. `StartupTimezone` becomes IANA string. `ConnectorProvider` adds `yookassa`, `sentry`.

**Health snapshot:** `supportingMetrics` JSONB changes shape to nullable universal metrics. North star value read from `northStarKey` on startup record, resolved against universal or custom metrics.

## Out of Scope

- PostHog connector changes (works as-is, used when startups instrument PostHog)
- Stripe connector changes (works as-is, used when EU branch launches)
- Autonomous view generation without user review (AI suggests, user approves)
- Real-time streaming from startup DBs (sync is poll-based on interval)
- Cross-startup metric normalization (MRR in RUB vs USD compared as-is, no FX conversion)
