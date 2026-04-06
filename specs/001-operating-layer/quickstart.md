# Quickstart: Operating Layer Development

**Branch**: `001-operating-layer`

## Prerequisites

- Node.js 20+ (worker production runtime)
- Bun 1.1+ (API/Web dev runtime)
- Docker (Postgres + Redis)
- pnpm 9+

## Setup

```bash
# Clone and checkout branch
git checkout 001-operating-layer

# Install dependencies
pnpm install

# Start infrastructure
pnpm services:up
# Starts: postgres://postgres:postgres@127.0.0.1:5432/porta + redis://127.0.0.1:6379

# Run migrations (includes new tables: alert_rule, event_log, telegram_config, etc.)
bun run --cwd apps/api src/db/migrate.ts

# Copy environment
cp .env.example .env
```

## Required Environment Variables

```bash
# Core (required)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/porta
REDIS_URL=redis://127.0.0.1:6379
BETTER_AUTH_SECRET=dev-secret-change-in-prod
CONNECTOR_ENCRYPTION_KEY=<64-char hex string>  # Generate: openssl rand -hex 32

# Optional (for full feature set)
ANTHROPIC_API_KEY=sk-ant-...       # AI insights + portfolio synthesis
LINEAR_API_KEY=lin_api_...         # Task sync to Linear
TELEGRAM_BOT_TOKEN=123:ABC...     # Telegram bot (or configure per-workspace in dashboard)

# Testing
FOUNDER_PROOF_MODE=true            # Deterministic mocked validators
```

## Development

```bash
# Run all services concurrently
pnpm dev                # API (3000) + Web (5173)
pnpm dev:worker         # Worker (separate terminal)

# Run specific services
pnpm dev:api            # Elysia on :3000
pnpm dev:web            # Vite on :5173
```

## Testing

```bash
# Full test suite
pnpm test

# Specific test files
bun test apps/api/tests/alert-evaluator.test.ts
bun test apps/api/tests/mcp.routes.test.ts
bun test apps/api/tests/yookassa.connector.test.ts

# E2E tests
pnpm playwright:install  # First time only
pnpm test:e2e:onboarding
pnpm test:e2e:connectors

# Lint + typecheck
pnpm check              # Biome check
pnpm fix                # Biome auto-fix
pnpm typecheck          # TypeScript across all workspaces
```

## Wave-by-Wave Development

### Wave 1: Core Pipeline (US-1, US-4, US-5)

New files to create:
- `apps/api/src/db/schema/alert-rule.ts` — Alert rule + alert tables
- `apps/api/src/db/schema/event-log.ts` — Event log table
- `apps/api/src/lib/connectors/yookassa.ts` — YooKassa validator
- `apps/api/src/lib/connectors/sentry.ts` — Sentry validator
- `apps/api/src/lib/alerts/evaluator.ts` — Z-score evaluation engine
- `apps/api/src/lib/events/emitter.ts` — Event log emission helper
- `apps/worker/src/providers.ts` — Add yookassa + sentry providers

Ship gate: alerts fire on real data, event log records all events, connectors sync.

### Wave 2: Push Channels (US-2, US-9, US-3)

New files to create:
- `apps/api/src/db/schema/telegram-config.ts` — Telegram linking
- `apps/api/src/db/schema/webhook-config.ts` — Webhook config
- `apps/api/src/db/schema/api-key.ts` — API key management
- `apps/api/src/routes/mcp.ts` — 8 MCP/REST endpoints
- `apps/api/src/routes/telegram.ts` — Bot webhook handler
- `apps/worker/src/processors/telegram.ts` — Digest + alert delivery
- `apps/worker/src/processors/webhook.ts` — Webhook delivery
- `apps/worker/src/sparklines.ts` — resvg-js SVG-to-PNG

Ship gate: digests deliver, webhooks fire, MCP read tools return data.

### Wave 3: Dashboard + Polish (US-6, US-7, US-8)

New files to create:
- `apps/web/src/components/mode-switcher.tsx`
- `apps/web/src/components/decision-surface.tsx`
- `apps/web/src/components/event-log-entry.tsx`
- `apps/web/src/components/comparison-matrix.tsx`
- `apps/web/src/components/ai-synthesis-card.tsx`
- `apps/web/src/components/streak-badge.tsx`
- `apps/worker/src/processors/portfolio-digest.ts`

Ship gate: all 3 modes render, portfolio digest generates, streaks display.

## Key Patterns for Contributors

### Adding a new connector

1. Add provider to `CONNECTOR_PROVIDERS` in `packages/shared/src/connectors.ts`
2. Create validator in `apps/api/src/lib/connectors/<provider>.ts`
3. Add provider sync logic in `apps/worker/src/providers.ts`
4. Update DB check constraint in migration
5. Add stub validator for tests

### Adding an event type

1. Add type to `EventType` enum in `packages/shared/src/event-log.ts`
2. Define payload shape in the discriminated union
3. Emit via `EventEmitter.emit()` at the appropriate code path
4. Update webhook `event_types` filter if the event should be deliverable

### Adding an MCP tool

1. Define input/output Zod schemas in `packages/shared/src/mcp.ts`
2. Add route handler in `apps/api/src/routes/mcp.ts`
3. Add test in `apps/api/tests/mcp.routes.test.ts`
4. Add to `packages/shared/src/mcp.ts` tool registry
