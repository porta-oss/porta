# Plan: US-3 — MCP Server for AI Agent Access

## Overview

8 MCP tools (5 read, 3 write) via REST endpoints + native MCP plugin, authenticated by scoped API keys with 60 req/min rate limiting. API keys use SHA-256 hash storage with prefix-based identification, supporting read-only and read-write scopes.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 2 stories depend on Wave 1 (US-1 alerts + US-4 events + US-5 connectors being complete).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- DB schema: `pgTable()` with camelCase TS -> snake_case DB columns
- Shared types: const arrays + union types, Summary interfaces, Zod schemas
- Queue names: UPPERCASE_SNAKE_CASE constants
- TDD: Write failing tests first, then implement

**API Key Auth**:
- Header: `Authorization: Bearer porta_<read|write>_<32chars>`
- SHA-256 hash lookup in `api_key` table
- Scope check: read keys -> 5 read tools only, write keys -> all 8
- Revoked key -> 401 immediately
- Update `last_used_at` on each request
- Rate limit: 60 req/min per key via Redis sliding window

**API Key Management**:
- `POST /api/settings/api-keys` -- create (returns full key once, stores hash)
- `GET /api/settings/api-keys` -- list (prefix + metadata only)
- `DELETE /api/settings/api-keys/:keyId` -- revoke (set `revoked_at`)

**8 MCP Tools**:

Read (require `read` scope):
1. `get_metrics` -- `GET /api/mcp/metrics?startupId&metricKeys?&category?` -> `MetricValue[]`
2. `get_alerts` -- `GET /api/mcp/alerts?startupId?&status?` -> `Alert[]`
3. `get_at_risk_customers` -- `GET /api/mcp/at-risk-customers?startupId` -> `AtRiskCustomer[]`
4. `get_activity_log` -- `GET /api/mcp/activity-log?startupId?&eventTypes?&cursor?&limit?` -> `EventLogEntry[]`
5. `get_portfolio_summary` -- `GET /api/mcp/portfolio-summary` -> `{ startups, aiSynthesis? }`

Write (require `write` scope):
6. `create_task` -- `POST /api/mcp/tasks` -> `{ task }`
7. `snooze_alert` -- `POST /api/mcp/alerts/:alertId/snooze` -> `{ alert }`
8. `trigger_sync` -- `POST /api/mcp/sync` -> `{ syncJobs }`

**Response wrapper**: `McpResponse<T> { data, dataAsOf, dashboardUrl, pagination? }`

**Error wrapper**: `McpErrorResponse { error, code, retryAfter? }`

**Frontend**: Settings page at `/settings/api-keys` with create (scope selector), list (prefix + last_used), revoke button.

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Write API key management tests (TDD)
File: `apps/api/tests/api-key.routes.test.ts`
- [x] Test POST create returns full key (`porta_read_...`) and stores hash
- [x] Test GET list returns keys with prefix only, no hash
- [x] Test DELETE revoke sets `revoked_at`
- [x] Test revoked key returns 401 on MCP endpoints
- [x] Test non-existent key returns 401

### Task 2: Write MCP tool route tests (TDD)
File: `apps/api/tests/mcp.routes.test.ts`
- [x] Test each of 8 tools returns correct data shape
- [x] Test read key can access read tools (200)
- [x] Test read key cannot access write tools (403)
- [x] Test write key can access all tools (200)
- [x] Test rate limiting returns 429 after 60 requests
- [x] Test `McpResponse` wrapper has `data`, `dataAsOf`, `dashboardUrl`
- [x] Test `McpErrorResponse` shape for NOT_FOUND, FORBIDDEN

### Task 3: Implement API key auth middleware
File: `apps/api/src/lib/mcp/auth.ts`
- [ ] Extract Bearer token from Authorization header
- [ ] SHA-256 hash the token
- [ ] Look up `api_key` by `key_hash`
- [ ] Check `revoked_at` is null (else 401)
- [ ] Check scope (read vs write) against required scope for endpoint
- [ ] Update `last_used_at`
- [ ] Return workspace context from `api_key.workspace_id`

### Task 4: Implement rate limiting
File: `apps/api/src/lib/mcp/auth.ts` (same file)
- [ ] Redis sliding window counter: key = `rate:mcp:{keyPrefix}`, window = 60s
- [ ] INCR + EXPIRE pattern or ZRANGEBYSCORE for sliding window
- [ ] If count > 60: return 429 with `Retry-After` header (seconds until window resets)

### Task 5: Implement API key management routes
File: `apps/api/src/routes/api-key.ts`
- [ ] `POST /api/settings/api-keys` -- validate name + scope, generate key (`porta_{scope}_{32 random}`), hash with SHA-256, store hash + prefix (first 8 chars), return full key in response
- [ ] `GET /api/settings/api-keys` -- list non-revoked keys for workspace (id, name, prefix, scope, lastUsedAt, createdAt)
- [ ] `DELETE /api/settings/api-keys/:keyId` -- set `revoked_at = now()`

### Task 6: Implement 8 MCP tool handlers
File: `apps/api/src/services/mcp-tools.ts`
- [ ] Implement `getMetrics(startupId, filters, db)`: query `health_snapshot` universal metrics + `custom_metric` table, merge, filter by keys/category
- [ ] Implement `getAlerts(startupId?, status?, db)`: query `alert` table sorted by severity then `firedAt` DESC
- [ ] Implement `getAtRiskCustomers(startupId, db)`: query at-risk data (from existing insight/customer data)
- [ ] Implement `getActivityLog(startupId?, eventTypes?, cursor?, limit?, db)`: delegate to event log query logic
- [ ] Implement `getPortfolioSummary(workspaceId, db)`: query all startups with metrics, load latest AI synthesis if available
- [ ] Implement `createTask(startupId, title, description?, priority?, db)`: insert `internal_task`, enqueue Linear sync
- [ ] Implement `snoozeAlert(alertId, duration?, db)`: update alert status, emit event
- [ ] Implement `triggerSync(startupId, connectorId?, db)`: enqueue sync jobs

### Task 7: Implement MCP REST routes
File: `apps/api/src/routes/mcp-rest.ts`
- [ ] Wire all 8 tools as REST endpoints under `/api/mcp/*`
- [ ] Apply API key auth middleware to all routes
- [ ] Wrap responses in `McpResponse<T>` with `dataAsOf` from latest sync timestamp
- [ ] Include `dashboardUrl` pointing to web app

### Task 8: Mount elysia-mcp plugin
File: `apps/api/src/routes/mcp.ts`
- [ ] Import `elysia-mcp` plugin
- [ ] Register all 8 tools with Zod input schemas from `@porta/shared`
- [ ] Configure Bearer token auth
- [ ] Mount at `/mcp` path
- [ ] If `elysia-mcp` is not mature enough, skip this task (REST fallback covers it)

### Task 9: Create API key settings page
File: `apps/web/src/routes/_authenticated/settings/api-keys.tsx`
- [ ] Create key button with name input and scope selector (read/write)
- [ ] Display full key once on creation (copy button, "won't be shown again" warning)
- [ ] List existing keys: name, prefix (`porta_read_a1b2...`), scope, last used, created
- [ ] Revoke button with confirmation dialog
- [ ] Show revoked keys grayed out (or filter them out)

### Task 10: Register API key and MCP routes in app
File: `apps/api/src/app.ts`
- [ ] Import API key route handlers
- [ ] Import MCP REST route handlers
- [ ] Import MCP plugin mount (if available)
- [ ] Add all routes with appropriate auth (API key auth for MCP, session auth for key management)
