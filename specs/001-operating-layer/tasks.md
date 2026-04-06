# Tasks: Operating Layer (Dogfood-First + MCP Wedge)

**Input**: Design documents from `/specs/001-operating-layer/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included per user story. Constitution check enforces TDD — test tasks precede implementation tasks within each story phase.

**Organization**: Tasks grouped by user story in priority/wave order. Setup + Foundational phases are shared infrastructure blocking all user stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US4, US5)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Install new dependencies required by Operating Layer features

- [ ] T001 Install elysia-mcp and update elysia to >=1.4.21 in apps/api/package.json
- [ ] T002 [P] Install grammy in apps/api/package.json and apps/worker/package.json
- [ ] T003 [P] Install @resvg/resvg-js in apps/worker/package.json
- [ ] T004 Run pnpm install to resolve all new dependency versions

---

## Phase 2: Foundational (Shared Types + DB Schema + Infrastructure)

**Purpose**: Define all shared Zod schemas, database table schemas, migrations, and core infrastructure that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

### Shared Types (packages/shared/src/)

- [ ] T005 [P] Create universal metric keys, UniversalMetrics interface, and label/unit maps in packages/shared/src/universal-metrics.ts
- [ ] T006 [P] Create AlertRule Zod schema with AlertCondition and AlertSeverity enums in packages/shared/src/alert-rule.ts
- [ ] T007 [P] Create EventLogEntry discriminated union Zod schema with per-type payload shapes in packages/shared/src/event-log.ts
- [ ] T008 [P] Create MCP tool input/output Zod schemas, McpResponse wrapper, and McpErrorResponse in packages/shared/src/mcp.ts
- [ ] T009 [P] Create TelegramConfigSummary and digest payload Zod schemas in packages/shared/src/telegram.ts
- [ ] T010 [P] Create WebhookConfigSummary and WebhookPayload Zod schemas in packages/shared/src/webhook.ts
- [ ] T011 [P] Create ApiKeySummary and ApiKeyScope Zod schemas in packages/shared/src/api-key.ts
- [ ] T012 [P] Add yookassa and sentry to CONNECTOR_PROVIDERS and update ConnectorProvider type in packages/shared/src/connectors.ts
- [ ] T013 [P] Replace SupportingMetricsSnapshot with UniversalMetrics, remove NORTH_STAR_METRICS enum, update HealthSnapshotSummary in packages/shared/src/startup-health.ts
- [ ] T014 [P] Add CustomMetricCategory enum, update CustomMetricSummary shape, remove postgresSetupSchema in packages/shared/src/custom-metric.ts
- [ ] T015 Export all new modules from shared package index in packages/shared/src/index.ts

### Database Schema (apps/api/src/db/schema/)

- [ ] T016 [P] Modify startup schema: add northStarKey text column (default 'mrr'), open type/currency/timezone to free-form validated strings in apps/api/src/db/schema/startup.ts
- [ ] T017 [P] Modify connector schema: expand provider check to include yookassa/sentry, add stale to status enum in apps/api/src/db/schema/connector.ts
- [ ] T018 [P] Modify health_snapshot schema: change northStarValue to numeric nullable, replace supportingMetrics with UniversalMetrics JSONB in apps/api/src/db/schema/startup-health.ts
- [ ] T019 [P] Modify health_funnel_stage schema: rename stage column to key (free-form text) with updated unique constraint in apps/api/src/db/schema/startup-health.ts
- [ ] T020 [P] Modify custom_metric schema: add key/category/delta columns, drop schema/view/status columns, change unique to (startupId, key) in apps/api/src/db/schema/custom-metric.ts
- [ ] T021 [P] Create alert_rule table schema (startup_id FK, metric_key, condition enum, threshold, severity, enabled, min_data_points) with indexes in apps/api/src/db/schema/alert-rule.ts
- [ ] T022 [P] Create alert table schema (startup_id FK, rule_id FK, status enum with transitions, occurrence_count, snoozed_until) with indexes in apps/api/src/db/schema/alert-rule.ts
- [ ] T023 [P] Create streak table schema (startup_id unique, current_days, longest_days, started_at, broken_at) in apps/api/src/db/schema/alert-rule.ts
- [ ] T024 [P] Create event_log table schema (workspace_id FK, startup_id FK nullable, event_type, actor_type, payload JSONB) with composite indexes in apps/api/src/db/schema/event-log.ts
- [ ] T025 [P] Create telegram_config table schema (workspace_id unique FK, bot_token, chat_id, verification fields, digest_time/timezone, is_active) in apps/api/src/db/schema/telegram-config.ts
- [ ] T026 [P] Create webhook_config table schema (startup_id unique FK, url, secret, event_types JSONB, circuit breaker fields) in apps/api/src/db/schema/webhook-config.ts
- [ ] T027 [P] Create api_key table schema (workspace_id FK, name, key_hash unique, key_prefix, scope enum, last_used_at, revoked_at) in apps/api/src/db/schema/api-key.ts
- [ ] T028 [P] Create health_snapshot_history table schema (startup_id FK, metric_key, value, snapshot_id FK, captured_at) with composite index in apps/api/src/db/schema/startup-health.ts

### Migrations & Infrastructure

- [ ] T029 Generate Drizzle migrations for all schema changes (0007-0015) in apps/api/drizzle/
- [ ] T030 Run database migrations via bun run --cwd apps/api src/db/migrate.ts
- [ ] T031 Create event log emission helper (emit function with workspace scoping) in apps/api/src/lib/events/emitter.ts
- [ ] T032 Add telegram, webhook, portfolio, and purge queue definitions with retry/repeat configs in apps/worker/src/queues.ts

**Checkpoint**: Foundation ready — all shared types, DB schemas, migrations, and core infrastructure in place. User story implementation can now begin.

---

## Phase 3: US-4 — Decision Journal (Event Log) (Priority: Wave 1) MVP

**Goal**: Append-only event log with query API, cursor pagination, workspace tenant isolation, and 90-day retention purge

**Independent Test**: POST events via emitter, query GET /api/events with workspace filter, verify cursor pagination returns correct events grouped by type and time range

### Tests for US-4

- [ ] T033 [P] [US4] Write tests for event log query routes (pagination, tenant isolation, type/date filters) in apps/api/tests/event-log.routes.test.ts

### Implementation for US-4

- [ ] T034 [US4] Implement event log query route (GET /api/events) with cursor pagination, workspace_id enforcement, and type/date/startup filters in apps/api/src/routes/event-log.ts
- [ ] T035 [US4] Register event log routes in Elysia app in apps/api/src/app.ts
- [ ] T036 [US4] Implement event purge processor (90-day retention, legal hold PII redaction) as daily BullMQ repeatable job in apps/worker/src/processors/event-purge.ts

**Checkpoint**: Event log accepts writes via emitter and serves paginated queries. All subsequent user stories can now emit events.

---

## Phase 4: US-5 — New Connectors: YooKassa + Sentry + Postgres Multi-Metric (Priority: Wave 1) MVP

**Goal**: YooKassa and Sentry connectors sync data; Postgres connector upgraded to multi-metric porta_metrics view; all produce universal and custom metrics

**Independent Test**: Create YooKassa connector with test credentials, trigger sync, verify yookassa_revenue_30d metric stored. Create Sentry connector, sync, verify error_rate universal metric populated. Postgres connector syncs porta_metrics view rows into custom_metric table.

### Tests for US-5

- [ ] T037 [P] [US5] Write tests for YooKassa validator (HTTP Basic auth, /v3/me check, credential validation) in apps/api/tests/yookassa.connector.test.ts
- [ ] T038 [P] [US5] Write tests for Sentry validator (Bearer auth, org/project check, scope verification) in apps/api/tests/sentry.connector.test.ts

### Implementation for US-5

- [ ] T039 [P] [US5] Create YooKassa validator (HTTP Basic Auth, GET /v3/me, config shape validation) in apps/api/src/lib/connectors/yookassa.ts
- [ ] T040 [P] [US5] Create Sentry validator (Bearer token, GET /api/0/projects/{org}/{project}/, scope check) in apps/api/src/lib/connectors/sentry.ts
- [ ] T041 [US5] Add YooKassa sync provider (paginated payment/refund fetch, revenue_30d/failed_payments/refunds_30d metrics) in apps/worker/src/providers.ts
- [ ] T042 [US5] Add Sentry sync provider (error count 24h, P95 latency, crash-free sessions) in apps/worker/src/providers.ts
- [ ] T043 [US5] Refactor Postgres connector to multi-metric: connectionUri-only config, AI view generation prompt, porta_metrics SELECT, universal metric promotion in apps/api/src/lib/connectors/postgres.ts and apps/worker/src/providers.ts
- [ ] T044 [US5] Update connector routes to handle yookassa/sentry creation, validation, and config shapes in apps/api/src/routes/connector.ts
- [ ] T045 [US5] Register updated connector validators in Elysia app runtime in apps/api/src/app.ts

**Checkpoint**: All 5 connector types (PostHog, Stripe, Postgres, YooKassa, Sentry) can validate credentials and sync metrics.

---

## Phase 5: US-1 — Automated Alert Detection (Priority: Wave 1) MVP

**Goal**: Alert rules evaluated post-sync with Z-score anomaly detection (2.5 SD, 30-day rolling window), default seeding, CRUD + triage API, streak tracking

**Independent Test**: Seed default alerts after first sync, trigger sync with metric crossing threshold + sufficient history, verify alert fires with correct severity, event logged, and triage actions (ack/snooze/dismiss/bulk) update alert status.

### Tests for US-1

- [ ] T046 [P] [US1] Write tests for Z-score alert evaluator (all 4 conditions, edge cases: zero base, SD=0, insufficient data) in apps/api/tests/alert-evaluator.test.ts
- [ ] T047 [P] [US1] Write tests for alert rule CRUD and triage routes (create/list/update/delete, triage, bulk-triage) in apps/api/tests/alert-rule.routes.test.ts

### Implementation for US-1

- [ ] T048 [US1] Implement Z-score alert evaluation engine (4 conditions, rolling 30-day window, 2.5 SD guard, edge cases) in apps/api/src/lib/alerts/evaluator.ts
- [ ] T049 [US1] Implement default alert rule seeder (conditional seeding based on available metrics after first sync) in apps/api/src/lib/alerts/seeder.ts
- [ ] T050 [US1] Implement alert rule CRUD routes (POST/GET/PATCH/DELETE /api/startups/:startupId/alert-rules) in apps/api/src/routes/alert-rule.ts
- [ ] T051 [US1] Implement alert triage routes (GET alerts, POST triage, POST bulk-triage) in apps/api/src/routes/alert-rule.ts
- [ ] T052 [US1] Integrate alert evaluation + metric history storage + streak update + default seeding into post-sync pipeline in apps/worker/src/processors/sync.ts
- [ ] T053 [US1] Register alert rule and triage routes in Elysia app in apps/api/src/app.ts

**Checkpoint**: Wave 1 complete — alerts fire on real data, event log records all events, connectors sync. Ship gate met.

---

## Phase 6: US-9 — Webhook Delivery for External Automations (Priority: Wave 2)

**Goal**: Webhook config per startup with HTTPS-only URLs, HMAC-SHA256 signing, SSRF IP validation, DNS rebinding guard, BullMQ retry with circuit breaker

**Independent Test**: Configure webhook URL for a startup, fire an alert, verify POST received with correct X-Porta-Signature header and WebhookPayload shape. Verify private IP rejection and circuit breaker triggers after 10 failures.

### Tests for US-9

- [ ] T054 [P] [US9] Write tests for webhook delivery (HMAC signing, SSRF IP validation, DNS rebinding, circuit breaker at 10 failures) in apps/api/tests/webhook.delivery.test.ts

### Implementation for US-9

- [ ] T055 [US9] Implement HMAC-SHA256 signing and SSRF IP validation (RFC 1918, link-local, loopback, cloud metadata) with DNS re-resolution guard in apps/api/src/lib/webhooks/delivery.ts
- [ ] T056 [US9] Implement webhook config CRUD routes (POST/GET/PATCH/DELETE /api/startups/:startupId/webhook) with auto-generated secret in apps/api/src/routes/webhook-config.ts
- [ ] T057 [US9] Implement webhook delivery processor with BullMQ exponential backoff (1m/5m/15m/60m), 10s timeout, circuit breaker (10 failures disables), and dead-letter queue in apps/worker/src/processors/webhook.ts
- [ ] T058 [US9] Integrate webhook dispatch into alert firing pipeline (filter by event_types, enqueue delivery job) in apps/worker/src/processors/sync.ts
- [ ] T059 [US9] Create webhook config settings page (URL entry, event type selector, delivery log, circuit breaker status) in apps/web/src/routes/_authenticated/settings/webhooks.tsx
- [ ] T060 [US9] Register webhook config routes in Elysia app in apps/api/src/app.ts

**Checkpoint**: Webhooks fire on alert events with signed payloads. External automations (n8n, Make.com) can receive Porta events.

---

## Phase 7: US-3 — MCP Server for AI Agent Access (Priority: Wave 2)

**Goal**: 8 MCP tools (5 read, 3 write) via native MCP plugin and REST fallback, authenticated by scoped API keys with 60 req/min rate limiting

**Independent Test**: Create read API key, query GET /api/mcp/metrics with Bearer auth, receive McpResponse with data and dataAsOf. Create write key, POST /api/mcp/tasks, verify task created. Verify read key gets 403 on write endpoints. Verify revoked key gets 401.

### Tests for US-3

- [ ] T061 [P] [US3] Write tests for API key management routes (create, list, revoke, revoked key 401) in apps/api/tests/api-key.routes.test.ts
- [ ] T062 [P] [US3] Write tests for MCP tool routes (all 8 tools, scope enforcement, rate limiting, error responses) in apps/api/tests/mcp.routes.test.ts

### Implementation for US-3

- [ ] T063 [US3] Implement API key auth middleware (SHA-256 hash lookup, scope check, revocation check, last_used_at update) in apps/api/src/lib/mcp/auth.ts
- [ ] T064 [US3] Implement rate limiting (60 req/min per key via Redis sliding window counter) in apps/api/src/lib/mcp/auth.ts
- [ ] T065 [US3] Implement API key management routes (POST create, GET list, DELETE revoke) with key_prefix display in apps/api/src/routes/api-key.ts
- [ ] T066 [US3] Implement 8 MCP tool service handlers as pure functions (get_metrics, get_alerts, get_at_risk_customers, get_activity_log, get_portfolio_summary, create_task, snooze_alert, trigger_sync) in apps/api/src/services/mcp-tools.ts
- [ ] T067 [US3] Implement MCP REST fallback routes (/api/mcp/*) using API key auth and service handlers in apps/api/src/routes/mcp-rest.ts
- [ ] T068 [US3] Mount elysia-mcp plugin at /mcp with 8 tool registrations, Bearer token auth, and Zod input schemas in apps/api/src/routes/mcp.ts
- [ ] T069 [US3] Create API key management settings page (create with scope selector, list with prefix/last_used, revoke button) in apps/web/src/routes/_authenticated/settings/api-keys.tsx
- [ ] T070 [US3] Register API key and MCP routes in Elysia app in apps/api/src/app.ts

**Checkpoint**: MCP tools accessible via both native MCP protocol and REST endpoints. AI agents can query startup data and take actions.

---

## Phase 8: US-2 — Telegram Push Notifications (Priority: Wave 2)

**Goal**: Telegram bot sends daily digests with sparkline PNGs and immediate anomaly alerts with inline keyboard triage (Ack/Snooze/Dismiss buttons)

**Independent Test**: Enter bot token in settings, verify with /start code, receive daily digest with sparkline images per startup. Fire an alert, receive Telegram notification with triage buttons, tap Ack, verify alert status updated in DB.

### Implementation for US-2

- [ ] T071 [US2] Implement Telegram config routes (POST setup with bot token + verification code, DELETE unlink) in apps/api/src/routes/telegram.ts
- [ ] T072 [US2] Implement Telegram webhook handler using grammY webhookCallback for /start verification and callback_query triage in apps/api/src/routes/telegram.ts
- [ ] T073 [US2] Implement inline keyboard triage callback handler (parse triage:action:alertId, update alert, remove keyboard, log event) in apps/api/src/routes/telegram.ts
- [ ] T074 [US2] Implement sparkline SVG generation and resvg-js PNG rendering (200x50px, 5s AbortController timeout, text fallback) in apps/worker/src/sparklines.ts
- [ ] T075 [US2] Implement daily digest processor (per-workspace scheduling at digest_time in digest_timezone, per-startup summary with sparkline, alerts, at-risk customers) in apps/worker/src/processors/telegram.ts
- [ ] T076 [US2] Implement alert notification processor (immediate send on alert fire, inline keyboard buttons, deep-link to journal mode) in apps/worker/src/processors/telegram.ts
- [ ] T077 [US2] Create Telegram linking settings page (BotFather guide, token entry, verification code display, digest time/timezone config) in apps/web/src/routes/_authenticated/settings/telegram.tsx
- [ ] T078 [US2] Register Telegram routes in Elysia app in apps/api/src/app.ts

**Checkpoint**: Wave 2 complete — daily digests deliver, webhooks fire, MCP read tools return data. Ship gate met.

---

## Phase 9: US-6 — Dashboard Operating Modes (Priority: Wave 3)

**Goal**: Three dashboard modes (Decide/Journal/Compare) with keyboard shortcuts (Cmd+1/2/3), URL state persistence, responsive layout, stale data handling

**Independent Test**: Load dashboard, switch modes via Cmd+1/2/3 and mode switcher. Verify URL params (?mode=decide|journal|compare) persist on refresh. Decide mode shows top alert with actions. Journal mode shows events with day separators and filters. Compare mode shows startup matrix with AI card.

### Implementation for US-6

- [ ] T079 [P] [US6] Create mode switcher component (Decide/Journal/Compare tabs, role="tablist", Cmd+1/2/3 shortcuts) in apps/web/src/components/mode-switcher.tsx
- [ ] T080 [P] [US6] Create decision surface component (highest-priority alert card with inline ack/snooze/investigate actions) in apps/web/src/components/decision-surface.tsx
- [ ] T081 [P] [US6] Create event log entry component (per-event-type rendering from discriminated union) in apps/web/src/components/event-log-entry.tsx
- [ ] T082 [P] [US6] Create day separator component (date headers for journal grouping) in apps/web/src/components/day-separator.tsx
- [ ] T083 [P] [US6] Create event filter bar component (type checkboxes, "Show all" toggle, date range) in apps/web/src/components/event-filter.tsx
- [ ] T084 [P] [US6] Create comparison matrix component (startups as rows, universal metrics as columns, expandable detail) in apps/web/src/components/comparison-matrix.tsx
- [ ] T085 [P] [US6] Create AI synthesis card component (cross-startup pattern analysis display) in apps/web/src/components/ai-synthesis-card.tsx
- [ ] T086 [P] [US6] Create system status sidebar section (last digest time, MCP query count, active alert count) in apps/web/src/components/system-status-section.tsx
- [ ] T087 [US6] Integrate mode switcher with URL search param persistence and keyboard shortcut registration in apps/web/src/routes/_authenticated/dashboard.tsx
- [ ] T088 [US6] Implement Decide mode (alert triage priority queue, metrics grid, zero-alert "All clear" with streak) in apps/web/src/routes/_authenticated/dashboard.tsx
- [ ] T089 [US6] Implement Journal mode (chronological events, day separators, filter bar, cursor pagination "Load more", scroll-to-event via URL param with retry/expiry handling) in apps/web/src/routes/_authenticated/dashboard.tsx
- [ ] T090 [US6] Implement Compare mode (single batch endpoint, 60s cache, startup matrix, AI synthesis card, expandable per-source detail) in apps/web/src/routes/_authenticated/dashboard.tsx

**Checkpoint**: All three dashboard modes render correctly with state persistence and responsive layout.

---

## Phase 10: US-7 — Portfolio-Level AI Insights (Priority: Wave 3)

**Goal**: Weekly AI-generated cross-startup pattern analysis via portfolio digest processor, available in Compare mode and get_portfolio_summary MCP tool

**Independent Test**: Trigger portfolio digest with 2+ startups, verify AI synthesis text generated. Verify <2 startups falls back to per-startup summary. Verify AI API timeout falls back to metric-only response.

### Implementation for US-7

- [ ] T091 [US7] Implement portfolio digest processor (weekly BullMQ repeatable, Anthropic API call with 30s AbortController timeout) in apps/worker/src/processors/portfolio-digest.ts
- [ ] T092 [US7] Add graceful degradation: <2 startups per-startup summary, AI unavailable metric-only digest, cost tracking in event log in apps/worker/src/processors/portfolio-digest.ts
- [ ] T093 [US7] Wire stored AI synthesis into get_portfolio_summary MCP tool and Compare mode AI synthesis card in apps/api/src/services/mcp-tools.ts

**Checkpoint**: Portfolio digest generates weekly, AI synthesis available in dashboard and MCP.

---

## Phase 11: US-8 — Alert Polish: Dedup + Streaks (Priority: Wave 3)

**Goal**: Alert dedup showing occurrence count badges, healthy-streak badges (bronze/silver/gold) on portfolio cards and startup health

**Independent Test**: Fire same alert rule 3x, verify single alert row with occurrence_count=3 and "3x" badge. Maintain 7+ healthy days, verify bronze streak badge on startup card.

### Implementation for US-8

- [ ] T094 [P] [US8] Create streak badge component (16px circular progress ring, bronze=7d/silver=14d/gold=30d thresholds) in apps/web/src/components/streak-badge.tsx
- [ ] T095 [P] [US8] Create alert rule row component (metric, condition, threshold, severity, enabled toggle) in apps/web/src/components/alert-rule-row.tsx
- [ ] T096 [US8] Integrate streak badges into portfolio startup cards and startup health hero section in apps/web/src/routes/_authenticated/dashboard-startup.tsx
- [ ] T097 [US8] Display alert dedup occurrence count badges ("fired 3x this week") in decision surface and alert lists in apps/web/src/components/decision-surface.tsx

**Checkpoint**: Wave 3 complete — all modes render, portfolio digest generates, streaks display. Ship gate met.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Final quality pass affecting multiple user stories

- [ ] T098 [P] Add stale data handling (stale-while-revalidate, "Last updated X min ago" badge, offline banner) across dashboard modes in apps/web/src/routes/_authenticated/dashboard.tsx
- [ ] T099 [P] Implement responsive layout (mobile bottom bar for modes, collapsible sidebar, stacked compare cards) in apps/web/src/routes/_authenticated/dashboard.tsx
- [ ] T100 Run pnpm check and pnpm fix for Biome/Ultracite compliance across all workspaces
- [ ] T101 Run pnpm typecheck to verify end-to-end type safety across all workspaces
- [ ] T102 Run quickstart.md validation (services:up, migrate, dev, test suite, E2E smoke test)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US-4 (Phase 3)**: Depends on Foundational — provides event logging infrastructure
- **US-5 (Phase 4)**: Depends on Foundational — can run parallel with US-4
- **US-1 (Phase 5)**: Depends on US-4 + US-5 — needs event log + connector metrics
- **US-9 (Phase 6)**: Depends on US-1 — webhook delivery triggers on alert fire
- **US-3 (Phase 7)**: Depends on US-1 + US-4 — MCP tools query alerts and events
- **US-2 (Phase 8)**: Depends on US-1 — Telegram sends alert notifications
- **US-6 (Phase 9)**: Depends on US-1, US-4, US-5 — dashboard consumes all API data
- **US-7 (Phase 10)**: Depends on US-5 — needs connector data for portfolio analysis
- **US-8 (Phase 11)**: Depends on US-1 — dedup/streak built on alert system
- **Polish (Phase 12)**: Depends on all desired user stories being complete

### Wave Alignment

```
Wave 1 (Core Pipeline):  US-4 ──┐
                         US-5 ──┤──> US-1 ──> [Ship Gate 1]
                                │
Wave 2 (Push Channels):         ├──> US-9 ─┐
                                ├──> US-3 ──┤──> [Ship Gate 2]
                                └──> US-2 ─┘
                                │
Wave 3 (Dashboard+Polish):      ├──> US-6 ─┐
                                ├──> US-7 ──┤──> [Ship Gate 3]
                                └──> US-8 ─┘
```

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD per constitution)
- Schemas/models before services
- Services before routes/endpoints
- Core implementation before integration
- Register routes in app.ts after route implementation

### Parallel Opportunities

- **Phase 2**: All shared type files (T005-T014) can run in parallel. All DB schema files (T016-T028) can run in parallel.
- **Phase 3 + 4**: US-4 and US-5 can run in parallel after Foundational completes
- **Phase 6 + 7 + 8**: US-9, US-3, and US-2 can all start in parallel after Wave 1 completes
- **Phase 9 + 10 + 11**: US-6, US-7, and US-8 can start in parallel after Wave 2 completes
- **Within US-6**: All component files (T079-T086) can run in parallel before dashboard integration

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all shared type files together:
Task: "Create universal metrics types in packages/shared/src/universal-metrics.ts"
Task: "Create AlertRule Zod schema in packages/shared/src/alert-rule.ts"
Task: "Create EventLogEntry discriminated union in packages/shared/src/event-log.ts"
Task: "Create MCP tool schemas in packages/shared/src/mcp.ts"
Task: "Create Telegram config schemas in packages/shared/src/telegram.ts"
Task: "Create Webhook payload schemas in packages/shared/src/webhook.ts"
Task: "Create ApiKey schemas in packages/shared/src/api-key.ts"

# Then all DB schema files together:
Task: "Modify startup schema in apps/api/src/db/schema/startup.ts"
Task: "Modify connector schema in apps/api/src/db/schema/connector.ts"
Task: "Create alert_rule schema in apps/api/src/db/schema/alert-rule.ts"
Task: "Create event_log schema in apps/api/src/db/schema/event-log.ts"
# ... etc
```

## Parallel Example: Wave 2 (Phase 6 + 7 + 8)

```bash
# After Wave 1 ship gate passes, launch all three stories:
# Developer/Agent A: US-9 (webhooks)
# Developer/Agent B: US-3 (MCP server)
# Developer/Agent C: US-2 (Telegram)
```

---

## Implementation Strategy

### MVP First (Wave 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US-4 (Event Log) + Phase 4: US-5 (Connectors) in parallel
4. Complete Phase 5: US-1 (Alerts)
5. **STOP and VALIDATE**: Ship Gate 1 — alerts fire on real data, event log records, connectors sync
6. Deploy to dogfood environment

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Wave 1 (US-4 + US-5 + US-1) → Core pipeline operational → Ship Gate 1
3. Wave 2 (US-9 + US-3 + US-2) → Push channels active → Ship Gate 2
4. Wave 3 (US-6 + US-7 + US-8) → Dashboard + polish → Ship Gate 3
5. Each wave adds interaction modes without breaking previous waves

### Descope Rules (from spec)

- If behind schedule at any gate, Wave 3 items descope first
- US-7 (portfolio AI) and US-8 (alert polish) are first to defer
- US-9 (webhooks) can defer if Telegram covers push needs

---

## Notes

- [P] tasks = different files, no dependencies on other incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently testable after its phase completes
- TDD: write tests first, verify they fail, then implement
- Commit after each task or logical group
- Stop at any ship gate checkpoint to validate and deploy
- Spec deviation: US-2 uses inline keyboard buttons instead of emoji reactions (Telegram limitation — see research.md #4)
- Worker runs Node.js in production (not Bun) for resvg-js WASM compatibility
