# Implementation Plan: Operating Layer (Dogfood-First + MCP Wedge)

**Branch**: `001-operating-layer` | **Date**: 2026-04-05 | **Spec**: [specs/001-operating-layer/spec.md](./spec.md)
**Input**: Feature specification from `specs/001-operating-layer/spec.md`

## Summary

Turn Porta from a passive dashboard into a startup operating system with three interaction modes: pull (MCP/REST API), push (Telegram bot), and glanceable (dashboard with Decide/Journal/Compare modes). Adds alert evaluation with Z-score anomaly detection, structured event log (decision journal), two new connectors (YooKassa + Sentry), webhook delivery, portfolio-level AI insights, and dynamic metrics (universal + custom). Extends existing monorepo across all 4 workspaces (api, web, worker, shared).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), targeting ES2022+
**Primary Dependencies**: Elysia (API framework), Drizzle ORM (DB), BullMQ + ioredis (job queues), React 19 + TanStack Router (frontend), shadcn/ui (components), Better Auth (authentication), Zod (validation), resvg-js (sparkline SVG-to-PNG)
**Storage**: PostgreSQL (Drizzle ORM, schema in `apps/api/src/db/schema/`), Redis (BullMQ queues)
**Testing**: Vitest (unit/integration via Bun), Playwright (E2E), @testing-library/react (components)
**Target Platform**: Self-hosted Linux server (Docker Compose), Railway cloud template
**Project Type**: pnpm monorepo (3 runtime services + 1 shared package)
**Performance Goals**: <200ms p95 API reads, <500ms p95 writes, <2s LCP, <500KB gzipped main chunk, 30s max connector sync, 5s max health snapshot computation
**Constraints**: AGPL-3.0 license, Bun runtime (API/Web dev), Node runtime (Worker prod — resvg-js WASM), no framework migrations
**Scale/Scope**: 1-5 startups, <10 connectors, <100k metric data points, single-founder deployment

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Spec-First Development | PASS | `specs/001-operating-layer/spec.md` exists with 9 prioritized user stories, acceptance criteria, RFC 2119 keywords, edge cases |
| II. Test-Driven Development | PASS (intent) | Plan will enforce Red-Green-Refactor. Test tasks precede implementation tasks in each wave. TDD evidence via commit ordering |
| III. End-to-End Type Safety | PASS (intent) | All new schemas (alert rules, event log, webhook config, MCP tools, Telegram config) will be defined as Zod types in `@porta/shared`. API handlers derive types from shared schemas. No `any` |
| IV. Code Quality & Consistency | PASS (intent) | Ultracite/Biome + Lefthook pre-commit. `pnpm check` + `pnpm typecheck` gates enforced |
| V. User Experience Consistency | PASS (intent) | All new UI uses shadcn/ui primitives. Loading/empty/error states defined in interaction state matrix (CEO plan). Toast via sonner. TanStack Router links only |
| VI. Performance Requirements | PASS (intent) | Compare mode uses single batch endpoint (no N+1). Event log has composite index (startup_id + created_at DESC). Alert evaluation timeout 30s. Code-split per route |

**Gate result: PASS** — no violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/001-operating-layer/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── mcp-tools.md     # 8 MCP tool contracts (5 read + 3 write)
│   ├── webhooks.md      # Webhook payload + delivery contracts
│   ├── telegram.md      # Telegram bot API contracts
│   ├── alert-rules.md   # Alert rule CRUD + evaluation contracts
│   └── event-log.md     # Event log query + write contracts
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── db/schema/
│   │   ├── auth.ts              # Existing (workspace, user, session, etc.)
│   │   ├── startup.ts           # Modify: add northStarKey, open up type/currency/timezone
│   │   ├── connector.ts         # Modify: add yookassa + sentry providers
│   │   ├── startup-health.ts    # Modify: universalMetrics JSONB shape, free-form funnel keys
│   │   ├── custom-metric.ts     # Modify: multi-metric (unique startupId+key), add category/delta
│   │   ├── alert-rule.ts        # NEW: alert rule definitions
│   │   ├── event-log.ts         # NEW: append-only event log
│   │   ├── telegram-config.ts   # NEW: Telegram bot linking
│   │   ├── webhook-config.ts    # NEW: webhook delivery config
│   │   └── api-key.ts           # NEW: MCP/API key management
│   ├── routes/
│   │   ├── startup.ts           # Existing
│   │   ├── connector.ts         # Existing (add yookassa/sentry handlers)
│   │   ├── internal-task.ts     # Existing
│   │   ├── alert-rule.ts        # NEW: CRUD for alert rules
│   │   ├── event-log.ts         # NEW: query event log
│   │   ├── mcp.ts               # NEW: 8 MCP tool endpoints (REST fallback)
│   │   ├── telegram.ts          # NEW: webhook handler, linking flow
│   │   ├── webhook-config.ts    # NEW: webhook config CRUD
│   │   └── api-key.ts           # NEW: API key management
│   ├── lib/
│   │   ├── connectors/
│   │   │   ├── postgres.ts      # Existing
│   │   │   ├── posthog.ts       # Existing
│   │   │   ├── stripe.ts        # Existing
│   │   │   ├── yookassa.ts      # NEW: YooKassa validator
│   │   │   └── sentry.ts        # NEW: Sentry validator
│   │   ├── alerts/
│   │   │   ├── evaluator.ts     # NEW: Z-score alert evaluation engine
│   │   │   └── seeder.ts        # NEW: default alert rule seeding
│   │   ├── events/
│   │   │   └── emitter.ts       # NEW: event log emission helper
│   │   ├── mcp/
│   │   │   └── auth.ts          # NEW: API key auth middleware
│   │   └── webhooks/
│   │       └── delivery.ts      # NEW: HMAC signing + SSRF guard
│   └── app.ts                   # Modify: add new validators + routes to ApiRuntime
├── drizzle/                     # NEW migration files
└── tests/
    ├── alert-rule.routes.test.ts     # NEW
    ├── alert-evaluator.test.ts       # NEW
    ├── event-log.routes.test.ts      # NEW
    ├── mcp.routes.test.ts            # NEW
    ├── yookassa.connector.test.ts    # NEW
    ├── sentry.connector.test.ts      # NEW
    ├── webhook.delivery.test.ts      # NEW
    └── api-key.routes.test.ts        # NEW

apps/web/src/
├── routes/_authenticated/
│   ├── dashboard.tsx            # Modify: add mode switcher (Decide/Journal/Compare)
│   ├── dashboard-startup.tsx    # Modify: integrate alert triage, streak badges
│   └── settings/
│       ├── telegram.tsx         # NEW: Telegram linking setup
│       ├── webhooks.tsx         # NEW: webhook config panel
│       └── api-keys.tsx         # NEW: API key management
├── components/
│   ├── decision-surface.tsx     # NEW: top alert + inline actions
│   ├── event-log-entry.tsx      # NEW: journal event row
│   ├── day-separator.tsx        # NEW: journal day headers
│   ├── event-filter.tsx         # NEW: journal filter bar
│   ├── comparison-matrix.tsx    # NEW: Compare mode table
│   ├── ai-synthesis-card.tsx    # NEW: portfolio AI insight
│   ├── alert-rule-row.tsx       # NEW: alert config row
│   ├── streak-badge.tsx         # NEW: 16px circular progress ring
│   ├── system-status-section.tsx # NEW: sidebar system status
│   └── mode-switcher.tsx        # NEW: Decide/Journal/Compare tabs
└── tests/                       # NEW test files for each component

apps/worker/src/
├── processors/
│   ├── sync.ts                  # Modify: add alert evaluation post-snapshot
│   ├── task-sync.ts             # Existing
│   ├── telegram.ts              # NEW: digest + alert notification delivery
│   ├── webhook.ts               # NEW: webhook payload delivery
│   ├── portfolio-digest.ts      # NEW: weekly portfolio AI digest
│   └── event-purge.ts           # NEW: 90-day retention purge job
├── providers.ts                 # Modify: add yookassa + sentry providers
├── alerts.ts                    # NEW: alert evaluation logic (shared with API)
├── sparklines.ts                # NEW: resvg-js SVG-to-PNG generation
└── queues.ts                    # Modify: add telegram, webhook, portfolio, purge queues

packages/shared/src/
├── index.ts                     # Modify: export new modules
├── connectors.ts                # Modify: add yookassa + sentry providers
├── alert-rule.ts                # NEW: AlertRule Zod schema + types
├── event-log.ts                 # NEW: EventLogEntry discriminated union schema
├── mcp.ts                       # NEW: MCP tool input/output Zod schemas
├── telegram.ts                  # NEW: Telegram config + digest schemas
├── webhook.ts                   # NEW: Webhook config + payload schemas
├── api-key.ts                   # NEW: API key schemas
└── universal-metrics.ts         # NEW: universal metric keys + types (replaces rigid supporting metrics)
```

**Structure Decision**: Extends the existing monorepo structure. No new workspaces — all new code fits within the existing 4 workspaces. New domain areas (alerts, events, MCP, Telegram, webhooks) get their own schema files, route files, and shared type modules following the established pattern.

## Complexity Tracking

> No Constitution violations identified. No complexity justifications needed.

| Area | Complexity | Justification |
|------|-----------|---------------|
| 5 new schema tables | Proportionate | Each represents a distinct domain entity (alert_rule, event_log, telegram_config, webhook_config, api_key) with its own lifecycle |
| 2 new connectors | Proportionate | YooKassa + Sentry are independent providers with distinct APIs, validators, and sync logic |
| 3 dashboard modes | Proportionate | Each mode serves a distinct job (triage, history, comparison) per spec US-6 |
| health_snapshot_history table | Proportionate | Required for Z-score rolling window calculation — existing snapshot table is one-row-per-startup (latest only) |
| streak table | Proportionate | Separate from alert system — tracks healthy day count independently |

## Constitution Check — Post-Design Re-Evaluation

*Re-checked after Phase 1 design completion.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Spec-First Development | PASS | spec.md covers 9 user stories with acceptance criteria. data-model.md maps every entity. contracts/ cover all external interfaces |
| II. Test-Driven Development | PASS (plan) | Test files planned for every new module (8 test files in API alone). Wave ship gates require tests passing before proceeding |
| III. End-to-End Type Safety | PASS | All new schemas defined in `packages/shared` as Zod types. `UniversalMetrics` replaces rigid `SupportingMetricsSnapshot`. `EventLogEntry` is a discriminated union. MCP tools have full input/output Zod schemas. No `any` in contracts |
| IV. Code Quality & Consistency | PASS | Follows existing patterns: validator interfaces, queue producers, route handlers. Biome + Lefthook gates unchanged |
| V. User Experience Consistency | PASS | All new UI components use shadcn/ui. Interaction state matrix covers loading/empty/error/success/partial for every feature. Mode switcher follows `role="tablist"` accessibility pattern |
| VI. Performance Requirements | PASS | Compare mode: single batch endpoint (no N+1). Event log: composite index `(workspace_id, created_at DESC)`. Alert evaluation: 30s timeout per startup. Sparkline render: 5s timeout. API reads: <200ms p95 via indexed queries |

**Post-design gate result: PASS** — no new violations introduced during design phase.

## Generated Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Implementation Plan | `specs/001-operating-layer/plan.md` | Complete |
| Research | `specs/001-operating-layer/research.md` | Complete |
| Data Model | `specs/001-operating-layer/data-model.md` | Complete |
| MCP Tool Contracts | `specs/001-operating-layer/contracts/mcp-tools.md` | Complete |
| Webhook Contracts | `specs/001-operating-layer/contracts/webhooks.md` | Complete |
| Telegram Contracts | `specs/001-operating-layer/contracts/telegram.md` | Complete |
| Alert Rule Contracts | `specs/001-operating-layer/contracts/alert-rules.md` | Complete |
| Event Log Contracts | `specs/001-operating-layer/contracts/event-log.md` | Complete |
| Quickstart | `specs/001-operating-layer/quickstart.md` | Complete |
| Tasks | `specs/001-operating-layer/tasks.md` | Pending (`/speckit.tasks`) |
