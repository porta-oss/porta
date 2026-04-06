# Operating Layer: Dogfood-First + MCP Wedge

## Problem Statement

Pre-PMF founders running multiple startups manually scrape data from 5+ tools (PostHog, Sentry, YooKassa, DBeaver/Postgres), paste findings into a co-founder Telegram chat, and hope nothing falls through the cracks. There are no automated insights, no alerts, and no single place to ask "what needs attention today?" This manual process causes missed churn spikes, stalled decisions, and failure to call at-risk customers. The founder hates filling spreadsheets by hand.

Porta already has a functional MVP (connectors, health scores, AI insights, task management). This milestone turns it from a dashboard into a startup operating system with three interaction modes: pull (MCP), push (Telegram), glanceable (dashboard).

## User Roles

- **Founding operator** — runs 1-3 pre-PMF startups, technical enough to self-host, needs daily awareness of what requires attention across all products without manual data scraping
- **Co-founder** — receives forwarded data, makes decisions based on shared alerts and digests; needs data pushed to them without asking
- **AI agent (Claude Code / MCP client)** — queries startup metrics programmatically, creates tasks, triggers syncs, and answers questions about business data via MCP tools

## User Stories

### US-1: Automated alert detection
**As a** founding operator, **I want** Porta to evaluate alert rules after every data sync and notify me when metrics cross thresholds, **so that** I catch churn spikes and error surges within an hour instead of days or never.

**Acceptance Criteria:**
- [ ] Default alert rules seeded per startup **conditionally based on which metrics arrive after first sync** (e.g., `mrr` drop >20% WoW only if MRR data exists; `error_rate` spike >3x only if Sentry connected). See default seeding table in `docs/superpowers/specs/2026-04-05-dogfood-metrics-design.md#default-alert-seeding`
- [ ] Alert rules are configurable per startup (metricKey, condition, threshold, severity, enabled toggle)
- [ ] Alert rule schema defined in `packages/shared` as a Zod type: `metricKey` (string — matches any universal or custom metric key, not an enum), `condition` (enum: `drop_wow_pct`, `spike_vs_avg`, `below_threshold`, `above_threshold`), `threshold` (number, min 0.01, max 10000), `severity` (enum: `critical`, `high`, `medium`, `low`), `enabled` (boolean)
- [ ] Threshold validation: must be > 0; percentage thresholds capped at 100%; multiplier thresholds capped at 100x. Invalid values rejected at API with 422 and descriptive error
- [ ] Alerts fire only when startup has >= min_data_points (default 7) to prevent false positives on small data (Z-score guard with 2.5 SD threshold over rolling 30-day window)
- [ ] Alert evaluation runs post-sync (not on cron), reusing existing pipeline: sync -> snapshot -> evaluate -> notify. Evaluation timeout: 30 seconds per startup; on timeout, log error event and continue pipeline
- [ ] Each alert firing is logged in the event log with severity, metric, and value
- [ ] Bulk triage: dashboard Decide mode supports "Ack all" / "Snooze all" for alerts grouped by startup, in addition to per-alert actions

### US-2: Telegram push notifications
**As a** founding operator, **I want** a Telegram bot that sends me a daily digest with sparklines and anomaly alerts as they happen, **so that** I get startup awareness without opening any dashboard.

**Acceptance Criteria:**
- [ ] Telegram linking requires a one-time verification code generated in the dashboard, sent to the bot via `/start <code>`, binding the Telegram chat_id to the authenticated workspace
- [ ] Only bound chat_ids receive digests and can triage alerts via reactions
- [ ] Unlinking available via dashboard; removes chat_id and stops all delivery
- [ ] Setup flow in dashboard: guided steps explaining BotFather token creation, bot token entry, and verification code exchange with inline help text
- [ ] Daily digest message sent at a configurable time (default 09:00 local, timezone-aware with explicit timezone selector during Telegram setup) with per-startup summary, sparklines (200x50px PNG via resvg-js), and action items
- [ ] Anomaly alerts sent immediately when an alert fires, with deep-link to dashboard journal mode
- [ ] Emoji reactions on Telegram messages triage alerts: 👍 = ack, 😴 = snooze (24h default), ❌ = dismiss. Only one active reaction per alert; last reaction wins.
- [ ] "Customers to call today" section in digest when at-risk customers exist (customer identifiers are PII — see Data Classification section)
- [ ] Graceful failure handling: API down (exponential backoff, 4 retries), rate limited (respect Retry-After), bot removed (mark config inactive), sparkline failure (text-only fallback with Unicode arrows)

### US-3: MCP server for AI agent access
**As a** founding operator using Claude Code, **I want** to query my startup data via MCP tools, **so that** my AI agent can answer questions like "what happened with ProductA last week?" without manual credential setup.

**Acceptance Criteria:**
- [ ] 5 read tools: get_metrics, get_alerts, get_at_risk_customers, get_activity_log, get_portfolio_summary
- [ ] 3 write tools: create_task, snooze_alert, trigger_sync
- [ ] Each MCP tool has a Zod input schema and output schema defined in `packages/shared` (see MCP Tool Contracts appendix)
- [ ] All responses include: `data`, `dataAsOf` (ISO timestamp of last sync), `dashboardUrl`, `pagination` (cursor-based: `cursor`, `hasMore`, `limit` defaulting to 50)
- [ ] Error responses: `{ error: string, code: "NOT_FOUND" | "FORBIDDEN" | "RATE_LIMITED" | "INTERNAL", retryAfter?: number }`
- [ ] API key authentication scoped to workspace, with separate read/write permissions
- [ ] API keys are hashed (SHA-256) at rest; plaintext shown only once at creation time
- [ ] Rate limiting: 60 requests/minute per key, 429 response with Retry-After header
- [ ] Key lifecycle: create, list, revoke via dashboard; revocation is immediate and logged in event log (type: `mcp.key_revoked`)
- [ ] All MCP requests log the key prefix (first 8 chars) in the event log for audit trail
- [ ] API key header: `Authorization: Bearer <key>`. Key format: `porta_<read|write>_<32 random chars>`
- [ ] Fallback: if MCP SDK is immature, ship as REST endpoints (`/api/mcp/*`) wrappable in MCP later. REST fallback endpoints must use API key auth only (no session cookie auth) to prevent CSRF

### US-4: Decision journal (event log)
**As a** founding operator, **I want** every alert, action, AI insight, and system event timestamped in a structured log, **so that** I can review my decision history and understand what happened across startups over time.

**Acceptance Criteria:**
- [ ] Append-only event log with Zod discriminated union schema defined in `packages/shared` (`EventLogEntry` type) with per-type payload shapes
- [ ] Event types enum: `alert.fired`, `alert.ack`, `alert.snoozed`, `alert.dismissed`, `alert.resolved`, `connector.synced`, `connector.errored`, `connector.created`, `connector.deleted`, `insight.generated`, `insight.viewed`, `telegram.digest`, `telegram.alert`, `telegram.reaction`, `mcp.query`, `mcp.action`, `mcp.key_created`, `mcp.key_revoked`, `task.created`, `task.completed`, `webhook.delivered`, `webhook.failed`
- [ ] Every event scoped to workspace_id; all queries enforce workspace_id filter (tenant isolation). Direct event log queries must join through workspace, never expose cross-tenant data
- [ ] Events queryable by startup, type, and time range with cursor-based pagination (limit default 50, max 200)
- [ ] 90-day retention with configurable purge. Purge implementation: daily BullMQ job deletes events older than retention period. PII fields in purged events are redacted (not hard-deleted) if within legal hold window
- [ ] Legal hold: `workspace.legal_hold_until` timestamp; when set, purge redacts PII but preserves event structure
- [ ] Journal mode in dashboard shows events grouped by day, default filter: alerts + insights + tasks (high-signal), with "Show all" toggle for system events

### US-5: New connectors (YooKassa + Sentry)
**As a** founding operator, **I want** to connect YooKassa (Russian payment provider) and Sentry (error tracking) alongside existing connectors, **so that** Porta covers revenue and reliability data for my startups.

**Acceptance Criteria:**
- [ ] **YooKassa connector**: validates `shop_id` + `secret_key` via `GET /v3/me` (HTTP Basic Auth over HTTPS). Syncs raw payment data: successful payments (30d sum → `yookassa_revenue_30d`), failed payments (30d count → `yookassa_failed_payments`), refunds (30d count+sum → `yookassa_refunds_30d`). YooKassa does NOT provide subscription state or MRR — those come from the startup's Postgres `porta_metrics` view. Pagination: max 100 per request, cursor-based. Documentation must note that YooKassa API keys are shop-level and cannot be scoped — recommend a dedicated read-only shop for Porta
- [ ] **Sentry connector**: validates `auth_token` + org/project slug via `GET /api/0/projects/{org}/{project}/`. Auth token scope: `project:read` only. Syncs: error count 24h → universal `error_rate`, P95 latency → custom `p95_latency`, crash-free sessions → custom `crash_free_rate`
- [ ] **Postgres connector (multi-metric)**: config is `connectionUri` only (no view/schema/label fields). On first connect, introspects remote DB schema via `information_schema.columns`. AI generates a single `CREATE VIEW porta_metrics` statement tailored to the startup's tables. User reviews and runs the SQL. On sync, executes `SELECT metric_key, label, unit, category, value, captured_at FROM porta_metrics`. Each row becomes a `customMetric` record. If a row's `metric_key` matches a universal metric name, Porta promotes it to the universal slot on the health snapshot. See full view contract and AI generation flow in `docs/superpowers/specs/2026-04-05-dogfood-metrics-design.md#postgres-connector-multi-metric-via-porta_metrics-view`
- [ ] All connectors coexist (a startup can have YooKassa + Sentry + Postgres + Stripe + PostHog simultaneously)
- [ ] Connector health states: healthy (sync within interval), stale (>2x interval, yellow), error (failed sync, red)
- [ ] Retry policy: exponential backoff (1m, 5m, 15m, 60m), error state after 4 failures

### US-6: Dashboard operating modes
**As a** founding operator, **I want** three dashboard modes — Decide, Journal, Compare — **so that** I can triage alerts, review history, and compare startups from a single screen.

**Acceptance Criteria:**
- [ ] Mode switcher with keyboard shortcuts (Cmd+1/2/3)
- [ ] Dashboard mode and active filters persisted in URL search params (`?mode=decide`, `?mode=journal&filter=alerts,insights`, `?mode=compare&expanded=startup-id`); browser refresh restores full state
- [ ] **Decide mode** (default): shows highest-priority alert with inline ack/snooze/investigate actions, then metrics grid, funnel, tasks. Zero-alert state: "All clear" celebration with streak count
- [ ] **Journal mode**: chronological event log with day separators, filter bar, pagination (last 50, "Load more"), scroll-to-event via URL parameter for Telegram deep-links. If target event fetch fails: retry 2x with 2s delay, then show "Event not found or expired" inline message (not blank screen). If event falls outside 90-day retention: show "This event has been archived" message
- [ ] **Compare mode**: dense matrix with startups as rows, universal metrics as columns (Health, North star, MRR, Growth, Alerts, Last sync), expandable per-source detail, AI synthesis card at top. Data fetched via single batch endpoint (not N+1 per-startup queries); response cached for 60s
- [ ] Sidebar system status: last digest time, MCP query count today, active alert count
- [ ] Stale data handling: display cached data immediately (stale-while-revalidate), refresh in background. Show "Last updated X min ago" staleness badge when data is >5 minutes old. Network error: show "Offline — showing cached data" banner, keep cached data visible
- [ ] Responsive: mobile bottom bar for modes, collapsible sidebar, stacked cards for compare

### US-7: Portfolio-level AI insights
**As a** founding operator running multiple startups, **I want** AI-generated cross-startup pattern analysis, **so that** I can spot portfolio-wide trends that individual startup dashboards miss.

**Acceptance Criteria:**
- [ ] Weekly portfolio digest job comparing health across all startups
- [ ] AI synthesis identifying cross-startup patterns (e.g., "Both ProductA and ProductB saw activation drops — shared onboarding change?")
- [ ] Available via get_portfolio_summary MCP tool and Compare mode AI synthesis card
- [ ] Graceful degradation: < 2 startups shows per-startup summary instead of cross-startup comparison; AI API unavailable (quota/timeout) falls back to metric-only digest without synthesis
- [ ] AI synthesis timeout: 30 seconds for Anthropic API call; on timeout, fall back to metric-only digest immediately. Sparkline rendering timeout: 5 seconds per image via resvg-js; on timeout, use text fallback. Timeouts must not block the BullMQ worker slot — use AbortController or equivalent
- [ ] Portfolio digest logged in event log (type: insight) with generation cost tracked

### US-8: Alert polish (dedup + streaks)
**As a** founding operator, **I want** repeated alerts deduplicated with occurrence counts and healthy-streak badges, **so that** alerts are informative, not a firehose, and I'm rewarded for healthy startups.

**Acceptance Criteria:**
- [ ] Alert dedup: same alert type for same metric shows "fired 3x this week" count badge instead of 3 separate alerts
- [ ] Streak badges: 7+ days healthy = bronze, 14+ = silver, 30+ = gold (circular progress ring, 16px, configurable per workspace)
- [ ] Streaks visible on portfolio startup cards and startup health hero

### US-9: Webhook delivery for external automations
**As a** founding operator using n8n or Make.com, **I want** Porta to POST alert payloads to a configured webhook URL when alerts fire, **so that** I can trigger external automations (Slack messages, CRM updates, custom workflows) without building native integrations.

**Acceptance Criteria:**
- [ ] webhook_config per startup: URL (must be HTTPS; HTTP rejected at configuration time), shared secret (for HMAC signature verification), event_types filter (using event type enum from US-4), enabled flag
- [ ] URL validation: reject private/internal IP ranges (RFC 1918, link-local, loopback, cloud metadata `169.254.x.x`) at both configuration and delivery time (DNS re-resolution guard against DNS rebinding)
- [ ] Webhook payload shape defined as Zod schema in `packages/shared`: `{ event: EventType, timestamp: ISO8601, startupId: string, payload: <per-event-type shape>, deliveryId: string (UUIDv4, for consumer-side dedup) }`
- [ ] HTTP headers: `Content-Type: application/json`, `X-Porta-Signature: sha256=<HMAC hex digest>`, `X-Porta-Delivery: <deliveryId>`
- [ ] Alert payloads POSTed to configured URL with HMAC-SHA256 signature header
- [ ] Delivery via BullMQ with retry (same exponential backoff as Telegram). Delivery timeout: 10 seconds per attempt. Circuit breaker: after 10 consecutive failures to the same endpoint, disable webhook and log `webhook.circuit_broken` event; notify operator via Telegram (if linked) or dashboard banner
- [ ] Dead-letter queue: failed deliveries after 4 retries stored for 7 days, viewable in dashboard webhook config panel
- [ ] Webhook delivery logged in event log with delivery status, HTTP response code, and deliveryId (payload content NOT logged to avoid PII duplication)

## Definitions

- **Churn proxy**: Refund count + failed recurring payments with no successful retry within 72 hours, over a rolling 7-day window from YooKassa/Stripe. A proxy because pre-PMF startups often lack formal subscription billing — the signal is "customer tried to pay and it didn't work, or they asked for money back."
- **At-risk customer**: A customer matching any of: (a) failed payment in last 7 days with no successful retry, (b) refund requested in last 14 days, (c) usage drop >50% week-over-week (if usage data available via PostHog or Postgres). Returned with customer identifier, risk reason, last payment date, and last activity date.
- **North-star metric**: Per-startup configurable. `northStarKey` stored on the startup record as a free-form string referencing any universal or custom metric key (e.g., `"mrr"` for Triggo, `"active_installs"` for a marketplace widget, `"active_families"` for a B2C bot). Default: `"mrr"`. Previous-period delta computed by Porta from snapshot history.
- **Universal metrics**: 6 nullable metrics present on every health snapshot, powering Compare mode and portfolio AI: `mrr`, `active_users`, `churn_rate`, `error_rate`, `growth_rate` (Porta-computed from north star WoW delta), `arpu`. Populated when a connector (native or Postgres `porta_metrics` view) provides matching `metric_key`. Null means no data source connected for that metric.
- **Custom metrics**: Unlimited per startup, stored in `customMetric` table with `unique(startupId, key)`. Sourced from Postgres `porta_metrics` view rows or native connector outputs. Each has: `key`, `label`, `unit`, `category` (engagement/revenue/health/growth/custom), `value`, `previousValue` (Porta-computed), `delta` (Porta-computed).
- **At-risk customer connector dependency**: Criterion (c) "usage drop >50% WoW" only evaluates when PostHog or Postgres usage data is available for that startup. Startups with only payment connectors (YooKassa/Stripe) evaluate criteria (a) and (b) only. The at-risk customer list in Telegram and MCP must indicate which criteria were evaluable per startup.

## Data Classification

- **Customer identifiers** (customer name, email, payment reference from YooKassa/Stripe sync) are PII. Stored in connector sync results, referenced in at-risk customer lists and alert events.
- **Telegram digests**: "Customers to call today" shows customer identifier and risk reason. Operators acknowledge during Telegram setup that PII will transit Telegram infrastructure (not under operator control).
- **MCP responses**: `get_at_risk_customers` returns PII. Read-permission API keys grant PII access. MCP tool descriptions must note this.
- **Webhook payloads**: Alert payloads referencing at-risk customers include PII. Operators are responsible for securing their webhook endpoints.
- **DSAR support**: Customer identifiers are searchable by the operator via `GET /api/internal/pii-search?q=<identifier>` returning all tables/events containing that identifier. Deletion redacts customer data from sync results and replaces event log references with `[REDACTED]`, preserving event structure.
- **Connector credentials**: Encrypted with AES-256-GCM (`CONNECTOR_ENCRYPTION_KEY`). Key rotation procedure: generate new key, re-encrypt all credentials via `POST /api/internal/rotate-encryption-key`, verify, retire old key. Document in self-hosting guide.

## Metrics Framework

Porta tracks the AARRR (pirate metrics) framework, biased toward **retention and activation** — the two stages that most reliably indicate product-market fit:

| Stage | Metric | Source |
|-------|--------|--------|
| Acquisition | Unique visitors, signup rate | PostHog |
| Activation | Time-to-value, activation rate (D1) | PostHog |
| Retention | D7/D30 cohort retention, WAU/MAU ratio | PostHog |
| Revenue | MRR, churn proxy, failed payment rate | YooKassa / Stripe |
| Health | Error rate, P95 latency, uptime | Sentry |
| Custom | Business-specific KPIs (unlimited per startup) | Postgres `porta_metrics` view |

**Two-tier metric model:** Universal metrics (6, nullable) provide a consistent comparison surface across all startups. Custom metrics (unlimited) capture domain-specific KPIs via the Postgres connector's `porta_metrics` view. A Postgres view row with a `metric_key` matching a universal metric name is automatically promoted to the universal slot. See `docs/superpowers/specs/2026-04-05-dogfood-metrics-design.md` for full schema.

**Funnel stages are per-startup configurable.** Default for B2B SaaS: visitor → signup → activation → paying_customer. Other startup types define their own funnel (e.g., bot_start → family_created → first_action → recurring_user). Stored as free-form `key` strings with `label` and `position`.

## Rollout Prioritization

User stories are grouped into waves with ship gates between them:

**Wave 1 — Core Pipeline (Week 1-2)**: US-1 (alerts), US-4 (event log), US-5 (connectors)
Ship gate: alerts fire correctly on real data, event log records all events, at least one new connector syncs successfully.

**Wave 2 — Push Channels (Week 2-3)**: US-2 (Telegram), US-9 (webhooks), US-3 (MCP)
Ship gate: daily digest delivers, webhooks fire, MCP read tools return data. Depends on Wave 1 event log and alert infrastructure.

**Wave 3 — Dashboard + Polish (Week 3-4)**: US-6 (dashboard modes), US-7 (portfolio AI), US-8 (alert polish)
Ship gate: all three modes render correctly, portfolio digest generates, streaks display.

**Descope rules**: If behind schedule at any gate, Wave 3 items are descoped first. US-7 (portfolio AI) and US-8 (alert polish) are the first to defer. US-9 (webhooks) can defer to post-milestone if Telegram covers push needs.

## Success Criteria (measured after 4 weeks of deployment)

1. **Daily use**: Founder opens dashboard OR receives+reads Telegram digest on ≥10 of 14 working days. _Instrumentation_: event log `telegram.digest` delivery events + dashboard session start events (new `session.started` event type).
2. **Reaction time**: Median time from `alert.fired` to first triage action (`alert.ack`/`alert.snoozed`/`alert.dismissed`) ≤ 60 minutes during working hours (09:00-21:00 local). _Instrumentation_: event timestamp delta query.
3. **Decision velocity**: Co-founder receives data without the founder manually scraping — decisions happen without data requests stalling in Telegram (qualitative, founder self-report).
4. **MCP adoption**: ≥3 `mcp.query` events in week 1, ≥1/week sustained thereafter. _Instrumentation_: event log `mcp.query`/`mcp.action` count.
5. **Zero manual scraping**: Founder self-reports stopping DBeaver for routine metric checks (qualitative).

### Kill Criteria

- If daily use < 5/14 days after 4 weeks → diagnose which interaction mode failed (dashboard vs Telegram vs MCP); consider descoping the unused mode
- If MCP queries = 0 after 2 weeks → defer MCP maintenance, ship REST-only, revisit when MCP ecosystem matures
- If Telegram digest is muted/unlinked within 2 weeks → digest content or timing is wrong; pause and user-research before iterating
- If no alerts fire in 4 weeks (all green) → either thresholds are too loose or data quality is insufficient; review default rules

## Out of Scope

- Custom dashboard builder or drag-and-drop widgets
- Full CRM or social publishing features
- Connector marketplace or plugin system for third-party connectors
- RBAC, team permissions, or admin panel beyond workspace-level API keys
- Startup-type-specific logic (all types use the same universal + custom metrics framework; no type-specific features or workflows)
- Plausible or Yandex Metrika connectors (PostHog replaces both)
- Autonomous agents that take actions without human approval
- Cloud/managed offering (deferred until OSS validates demand)
- Full brand identity redesign or DESIGN.md creation (tracked separately in TODOS.md)

## Constraints

- **License**: AGPL-3.0 open-source core; cloud monetization path preserved
- **Existing stack**: Must extend the current monorepo (Bun, TypeScript, React 19, Elysia, Drizzle, BullMQ, shadcn/ui, TanStack Router) — no framework migrations
- **Currency**: Free-form ISO 4217 string (e.g., `RUB`, `USD`, `BRL`). No FX conversion — values displayed as-is in the startup's configured currency
- **Timezone**: Free-form IANA timezone string (e.g., `Europe/Moscow`). Validated via `Intl.supportedValuesOf('timeZone')`
- **Startup type**: Free-form string with suggested defaults in UI (`b2b_saas`, `b2c`, `marketplace`, `saas_tool`, `dev_tool`). No enum constraint
- **Deployment**: Railway template already configured; Docker Compose for self-hosting
- **YooKassa API hard gate**: YooKassa provides payment-level data only (no subscription state, no scoped API keys). MRR and subscription metrics come from the startup's Postgres `porta_metrics` view. YooKassa connector syncs: revenue totals, failed payment counts, refund counts — payment health signals the app DB doesn't track
- **PostHog prerequisite**: Founder's startups don't have PostHog yet. At least one startup needs PostHog tracking before the connector is useful
- **Telegram Bot API**: Requires BotFather setup, webhook or polling configuration
- **MCP SDK maturity**: If elysia-mcp or TypeScript MCP SDK is immature, ship as REST endpoints first
- **Worker runtime**: Node in production (not Bun) for worker — resvg-js (WASM) used for sparkline rendering to avoid native addon issues

## Edge Cases

- **First sync on new startup**: Alert evaluation skipped (no previous snapshot to compare against)
- **Z-score on small data**: Startups with fewer than min_data_points (default 7) skip alert evaluation for that metric entirely
- **Zero-revenue startup**: MRR = 0, churn alerts don't fire on zero base
- **YooKassa payments without customer_id**: Graceful degradation to payment-level data (no customer attribution)
- **Telegram bot removed by user (403)**: Mark telegram_config inactive, stop delivery, log event — don't crash
- **Telegram API down (5xx)**: BullMQ retry with exponential backoff (1m, 5m, 15m, 60m). After 4 failures, log + skip
- **Telegram rate limit (429)**: Respect Retry-After header via BullMQ delayed retry
- **Sparkline render failure**: Fall back to text-only with Unicode trend arrows
- **Connector deleted while sync in-flight**: Job completes, no new jobs registered
- **API key revoked mid-request**: 401 response, not 500
- **Multiple connectors per startup**: mergeMetrics() correctly merges from all providers without stale carry-forward (emit raw, not merged). If two connectors provide the same `metric_key`, the most recently synced value wins (allows Postgres views to override native connector values)
- **porta_metrics view missing**: Postgres connector status → error with descriptive message "View porta_metrics not found". Not a crash — other connectors continue syncing
- **porta_metrics view returns zero rows**: Connector status → connected, empty metrics (startup may have no data yet). Not an error
- **porta_metrics row promotes to universal**: If a Postgres view row has `metric_key` matching a universal name (e.g., `mrr`), it populates the universal slot. This means Postgres alone can be the only connector for a startup
- **Alert rule references missing metric**: Skip evaluation silently (connector not yet providing this data). Don't fire, don't error
- **North star key references nonexistent metric**: Dashboard shows "No data" for north star, not a crash. Resolves automatically when the metric appears after first sync
- **YooKassa pagination**: Must paginate through all results in 30d window (max 100/request). Connector must not stop at first page
- **Amounts in kopeks vs rubles**: YooKassa API returns amounts in rubles (with kopeks as decimals). Startup's Postgres view is responsible for unit consistency — Porta stores values as-is
- **MCP read-only key attempts write**: 403 Forbidden
- **Alert evaluation failure**: Must not crash the sync job pipeline
- **Compare mode with 1 startup**: Meaningful display, not broken table
- **Empty startup (no data)**: All 3 dashboard modes show correct empty states per interaction state matrix
- **Sync idempotency**: Dedup by syncJobId to prevent duplicate processing
- **Webhook delivery failure**: Endpoint unreachable or returns 5xx — retry with backoff, don't block alert pipeline

## References

Detailed technical specs, schemas, UI specs, and review findings live in the gstack project docs:

| Document | Location | Contains |
|----------|----------|----------|
| CEO Plan (scope decisions, technical schemas, timeline) | `~/.gstack/projects/porta-oss-porta/ceo-plans/2026-04-05-dogfood-mcp-wedge.md` | Event log schema, alert_rule schema, MCP tool inventory, Telegram failure modes, connector migration steps, dashboard UI spec (3 modes, interaction state matrix, component inventory, responsive behavior, accessibility), 4-week implementation timeline |
| Design Doc (problem statement, demand evidence, approaches) | `~/.gstack/projects/porta-oss-porta/belyaev-dev-main-design-20260405-024931.md` | Status quo analysis, AARRR metrics framework, recommended analytics stack, connector priority, churn proxy / at-risk customer definitions, success criteria, MCP fallback strategy, Codex cross-model perspective |
| Eng Review Test Plan #1 (core pipeline) | `~/.gstack/projects/porta-oss-porta/belyaev-dev-main-eng-review-test-plan-20260405-033640.md` | Affected routes, key interactions, edge cases for connectors + alerts + MCP + Telegram |
| Eng Review Test Plan #2 (dashboard + polish) | `~/.gstack/projects/porta-oss-porta/belyaev-dev-main-eng-review-test-plan-20260405-173858.md` | Dashboard modes, alert config, keyboard shortcuts, deep links, empty states |
| Dogfood Metrics & Connectors Design | `docs/superpowers/specs/2026-04-05-dogfood-metrics-design.md` | Universal vs custom metrics schema, smart Postgres connector with AI view generation, YooKassa/Sentry connector details, sync pipeline changes, per-startup dogfood deployment plan |

## Appendix: MCP Tool Contracts

All schemas defined as Zod types in `packages/shared/src/mcp.ts`. Common response wrapper:

```
{ data: T, dataAsOf: ISO8601, dashboardUrl: string, pagination?: { cursor: string | null, hasMore: boolean, limit: number } }
```

| Tool | Input | Output (`data` field) |
|------|-------|-----------------------|
| `get_metrics` | `{ startupId: string, metricKeys?: string[], dateRange?: { from: ISO8601, to: ISO8601 }, category?: "engagement" \| "revenue" \| "health" \| "growth" \| "custom" }` | `MetricValue[]` — each: `{ key, label, value, previousValue, delta, unit, category, source, isUniversal }`. Returns both universal and custom metrics. Filter by `metricKeys` for specific keys or `category` for all metrics in a category. |
| `get_alerts` | `{ startupId?: string, status?: "active" \| "snoozed" \| "dismissed" \| "resolved" }` | `Alert[]` — each: `{ id, startupId, ruleId, metricKey, severity, value, threshold, firedAt, status, occurrenceCount }` |
| `get_at_risk_customers` | `{ startupId: string }` | `AtRiskCustomer[]` — each: `{ identifier, riskReasons: string[], lastPaymentDate, lastActivityDate, evaluableCriteria: string[] }` (PII — see Data Classification) |
| `get_activity_log` | `{ startupId?: string, eventTypes?: EventType[], dateRange?: { from, to }, cursor?: string, limit?: number }` | `EventLogEntry[]` |
| `get_portfolio_summary` | `{}` | `{ startups: StartupSummary[], aiSynthesis?: string, synthesizedAt?: ISO8601 }` — each StartupSummary includes: `{ id, name, type, currency, healthState, northStarKey, northStarValue, northStarDelta, universalMetrics, customMetricCount, activeAlerts, lastSyncAt }` |
| `create_task` | `{ startupId: string, title: string, description?: string, priority?: "urgent" \| "high" \| "medium" \| "low" }` | `{ task: Task }` |
| `snooze_alert` | `{ alertId: string, duration?: number }` (duration in hours, default 24) | `{ alert: Alert }` |
| `trigger_sync` | `{ startupId: string, connectorId?: string }` | `{ syncJob: SyncJob }` |
