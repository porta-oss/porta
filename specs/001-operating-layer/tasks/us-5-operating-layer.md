# Plan: US-5 — New Connectors: YooKassa + Sentry + Postgres Multi-Metric

## Overview

YooKassa and Sentry connectors validate credentials and sync data. Postgres connector upgraded to multi-metric porta_metrics view. Each connector follows the existing factory-function validator pattern with production, stub, and founderProof variants.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: Foundational phase complete (connector schema expanded, shared connector types updated).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- DB schema: `pgTable()` with camelCase TS -> snake_case DB columns
- Shared types: const arrays + union types, Summary interfaces, Zod schemas
- Queue names: UPPERCASE_SNAKE_CASE constants
- Validator pattern: Factory functions returning interface with `validate(config) -> Promise<ProviderValidationResult>`. Three variants: production, stub, founderProof. Timeout via AbortController.
- TDD: Write failing tests first, then implement

**Connector configs** (encrypted in DB):
- YooKassa: `{ shopId: string, secretKey: string }` -- HTTP Basic Auth to `https://api.yookassa.ru/v3/me`
- Sentry: `{ authToken: string, organization: string, project: string }` -- Bearer to `https://sentry.io/api/0/projects/{org}/{project}/`
- Postgres (modified): `{ connectionUri: string }` -- connect + query porta_metrics view

**Sync metrics**:
- YooKassa: `yookassa_revenue_30d`, `yookassa_failed_payments`, `yookassa_refunds_30d` (from paginated `/v3/payments` and `/v3/refunds`)
- Sentry: `error_rate` (error count 24h), `sentry_p95_latency`, `sentry_crash_free_sessions` (from `/api/0/projects/{org}/{project}/stats/`)
- Postgres: `SELECT * FROM porta_metrics` -> rows become `custom_metric` entries, promote matching universal metric keys

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Write YooKassa validator tests (TDD)
File: `apps/api/tests/yookassa.connector.test.ts`
- [x] Test valid credentials (shopId + secretKey) return `{ valid: true }`
- [x] Test HTTP Basic auth header format (base64 of `shopId:secretKey`)
- [x] Test invalid credentials return `{ valid: false, error: '...' }`
- [x] Test network timeout returns `{ valid: false, retryable: true }`
- [x] Test founder-proof mode returns deterministic success

### Task 2: Write Sentry validator tests (TDD)
File: `apps/api/tests/sentry.connector.test.ts`
- [x] Test valid token + org + project return `{ valid: true }`
- [x] Test Bearer auth header format
- [x] Test invalid token returns `{ valid: false }`
- [x] Test non-existent org/project returns `{ valid: false }`
- [x] Test founder-proof mode returns deterministic success

### Task 3: Create YooKassa validator
File: `apps/api/src/lib/connectors/yookassa.ts`
- [x] Define `YooKassaConfig` interface: `{ shopId: string, secretKey: string }`
- [x] Implement `createYooKassaValidator()`: GET `https://api.yookassa.ru/v3/me` with HTTP Basic (`shopId:secretKey`)
- [x] 10s timeout via AbortController
- [x] Return `ProviderValidationResult`
- [x] Implement `createFounderProofYooKassaValidator()` -- deterministic success

### Task 4: Create Sentry validator
File: `apps/api/src/lib/connectors/sentry.ts`
- [x] Define `SentryConfig` interface: `{ authToken: string, organization: string, project: string }`
- [x] Implement `createSentryValidator()`: GET `https://sentry.io/api/0/projects/{org}/{project}/` with Bearer token
- [x] 10s timeout via AbortController
- [x] Return `ProviderValidationResult`
- [x] Implement `createFounderProofSentryValidator()` -- deterministic success

### Task 5: Add YooKassa sync provider
File: `apps/worker/src/providers.ts`
- [ ] Create `syncYooKassa` adapter function
- [ ] Paginated GET `/v3/payments` (filter: last 30 days) -> sum amounts for `revenue_30d`
- [ ] Paginated GET `/v3/refunds` -> count for `refunds_30d`
- [ ] Filter payments with status `'canceled'` for `failed_payments` count
- [ ] Return `ProviderSyncResult` with universal metric promotion (`mrr` from `revenue_30d` if applicable)
- [ ] Add `yookassa` case to `createProviderSyncRouter()` switch

### Task 6: Add Sentry sync provider
File: `apps/worker/src/providers.ts`
- [ ] Create `syncSentry` adapter function
- [ ] GET `/api/0/projects/{org}/{project}/stats/` with `stat=received`, `interval=1h`, last 24h -> `error_rate`
- [ ] GET transaction stats for p95 latency
- [ ] GET session stats for crash-free rate
- [ ] Return `ProviderSyncResult` with universal metric promotion (`error_rate`)
- [ ] Add `sentry` case to `createProviderSyncRouter()` switch

### Task 7: Refactor Postgres connector to multi-metric
Files: `apps/api/src/lib/connectors/postgres.ts`, `apps/worker/src/providers.ts`
- [ ] Simplify Postgres config to `connectionUri`-only (remove schema/view fields)
- [ ] Update validator to test connection with `connectionUri` only
- [ ] Update sync provider: `SELECT key, label, value, unit, category FROM porta_metrics`
- [ ] Each row -> `custom_metric` entry with `(startupId, key)` unique constraint
- [ ] Promote rows whose key matches `UNIVERSAL_METRIC_KEYS` into universal metrics
- [ ] Compute delta from previous `custom_metric` value

### Task 8: Update connector routes for new providers
File: `apps/api/src/routes/connector.ts`
- [ ] Add `yookassa` and `sentry` to provider validation dispatch
- [ ] Handle yookassa config shape (`shopId`, `secretKey`) in create/update
- [ ] Handle sentry config shape (`authToken`, `organization`, `project`) in create/update
- [ ] Update serialization if needed

### Task 9: Register updated validators in app
File: `apps/api/src/app.ts`
- [ ] Import yookassa and sentry validator factories
- [ ] Add them to the `ConnectorRuntime` validators map
- [ ] Wire founder-proof variants when `FOUNDER_PROOF_MODE=true`
