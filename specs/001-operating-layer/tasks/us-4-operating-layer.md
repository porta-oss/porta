# Plan: US-4 — Decision Journal (Event Log)

## Overview

Append-only event log with query API, cursor pagination, workspace tenant isolation, and 90-day retention purge. The event log captures all meaningful system events (connector syncs, health snapshots, alert firings, triage actions) as an immutable audit trail per workspace.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: Foundational phase complete (event_log table, event emitter, EventLogEntry shared types exist).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- DB schema: `pgTable()` with camelCase TS -> snake_case DB columns
- Shared types: const arrays + union types, Summary interfaces, Zod schemas
- Queue names: UPPERCASE_SNAKE_CASE constants
- TDD: Write failing tests first, then implement

**Contract** (GET /api/events):
- Query params: `startupId?`, `eventTypes?` (comma-separated), `from?` (ISO 8601), `to?` (ISO 8601), `cursor?` (opaque base64), `limit?` (default 50, max 200)
- Response: `{ events: EventLogEntry[], pagination: { cursor: string|null, hasMore: boolean, limit: number } }`
- Tenant isolation: ALL queries filtered by `workspace_id` from auth context
- Sort: `created_at DESC`
- Cursor: base64-encoded `(created_at, id)` for stable keyset pagination

**Purge**: Daily BullMQ job deletes events older than 90 days. Legal hold: if `workspace.legal_hold_until > now()`, redact PII in payload instead of deleting.

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Write tests for event log routes (TDD -- tests first)
File: `apps/api/tests/event-log.routes.test.ts`
- [x] Test GET /api/events returns paginated events for workspace
- [x] Test cursor pagination returns next page correctly
- [x] Test workspace tenant isolation (can't see other workspace's events)
- [x] Test eventTypes filter returns only matching types
- [x] Test date range filter (from/to)
- [x] Test startupId filter
- [x] Test limit parameter (default 50, max 200, clamped)
- [x] Test empty result returns `{ events: [], pagination: { cursor: null, hasMore: false } }`

### Task 2: Implement event log query route
File: `apps/api/src/routes/event-log.ts`
- [ ] Create `EventLogRuntime` interface (db instance)
- [ ] Implement GET /api/events handler with cursor pagination
- [ ] Build query: `SELECT` from `event_log` WHERE `workspace_id = wsCtx.workspaceId`
- [ ] Add optional filters: `startupId`, `eventTypes` (IN array), `from`/`to` date range
- [ ] Implement cursor decode: base64 -> `{ createdAt, id }` and WHERE `created_at < cursor.createdAt OR (created_at = cursor.createdAt AND id < cursor.id)`
- [ ] ORDER BY `created_at DESC, id DESC`, LIMIT `limit + 1` (fetch one extra to determine hasMore)
- [ ] Encode next cursor as base64(`{ createdAt, id }`) from last row if hasMore
- [ ] Return `{ events, pagination: { cursor, hasMore, limit } }`

### Task 3: Register event log routes in app
File: `apps/api/src/app.ts`
- [ ] Import event log route handler
- [ ] Add GET /api/events route with auth middleware and workspace context
- [ ] Wire `EventLogRuntime` with db instance

### Task 4: Implement event purge processor
File: `apps/worker/src/processors/event-purge.ts`
- [ ] Create processor for `EVENT_PURGE_QUEUE`
- [ ] DELETE FROM `event_log` WHERE `created_at < now() - interval '90 days'`
- [ ] Exclude workspaces with `legal_hold_until > now()` -- for those, UPDATE payload to redact PII fields (replace string values with `'[REDACTED]'`)
- [ ] Log purge count
- [ ] Register as daily repeatable job (cron: `'0 3 * * *'` -- 3am UTC)
