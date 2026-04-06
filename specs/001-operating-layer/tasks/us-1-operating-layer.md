# Plan: US-1 — Automated Alert Detection

## Overview

Alert rules evaluated post-sync with Z-score anomaly detection (2.5 SD, 30-day rolling window), default seeding, CRUD + triage API, and streak tracking. Alerts fire when metric conditions are met AND the deviation is statistically significant, reducing noise from normal fluctuations.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: US-4 (event log emitter) + US-5 (connector metrics) must be complete.

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- DB schema: `pgTable()` with camelCase TS -> snake_case DB columns
- Shared types: const arrays + union types, Summary interfaces, Zod schemas
- Queue names: UPPERCASE_SNAKE_CASE constants
- TDD: Write failing tests first, then implement

**Alert Evaluation Algorithm** (per enabled rule):
1. Look up metric value (universal first, then custom)
2. Skip if metric not found
3. Load history from `health_snapshot_history` (30-day window)
4. Skip if `history.length < rule.minDataPoints`
5. Evaluate condition:
   - `drop_wow_pct`: `drop_pct = ((prev - current) / prev) * 100`, FIRE if `>= threshold` AND `z_score >= 2.5`
   - `spike_vs_avg`: `ratio = current / mean`, FIRE if `>= threshold` AND `z_score >= 2.5`
   - `below_threshold`: FIRE if `current < threshold`
   - `above_threshold`: FIRE if `current > threshold`
6. Z-score guard: `z = |current - mean| / stddev`, FIRE only if `>= 2.5`
7. Edge cases: zero base -> skip `drop_wow_pct`, SD=0 -> skip z-score guard, negative values -> absolute for z-score

**Dedup**: Check existing active/snoozed alert for same `(rule_id, startup_id)`. Exists -> increment `occurrence_count`. Doesn't -> create new.

**Default seeding**: After first sync, seed rules based on which metrics arrived (mrr `drop_wow_pct` 20% critical, active_users `drop_wow_pct` 25% high, etc.).

**CRUD Routes**:
- `POST /api/startups/:startupId/alert-rules` -- create rule (409 on unique violation)
- `GET /api/startups/:startupId/alert-rules` -- list rules
- `PATCH /api/startups/:startupId/alert-rules/:ruleId` -- update
- `DELETE /api/startups/:startupId/alert-rules/:ruleId` -- delete (cascade alerts)

**Triage Routes**:
- `GET /api/startups/:startupId/alerts` -- list alerts (optional status filter)
- `POST /api/alerts/:alertId/triage` -- `{ action: ack|snooze|dismiss, snoozeDurationHours? }`
- `POST /api/startups/:startupId/alerts/bulk-triage` -- `{ action, alertIds?, snoozeDurationHours? }`

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Write Z-score evaluator tests (TDD)
File: `apps/api/tests/alert-evaluator.test.ts`
- [x] Test `drop_wow_pct` fires when drop >= threshold and z_score >= 2.5
- [x] Test `drop_wow_pct` does NOT fire when z_score < 2.5 (noise)
- [x] Test `spike_vs_avg` fires when ratio >= threshold and z_score >= 2.5
- [x] Test `below_threshold` fires when current < threshold (no z-score)
- [x] Test `above_threshold` fires when current > threshold (no z-score)
- [x] Test zero base value skips `drop_wow_pct` (no division by zero)
- [x] Test SD=0 (constant values) skips z-score guard
- [x] Test insufficient data points skips evaluation
- [x] Test dedup: existing active alert increments `occurrence_count`

### Task 2: Write alert rule CRUD and triage route tests (TDD)
File: `apps/api/tests/alert-rule.routes.test.ts`
- [x] Test POST create returns 201 with rule
- [x] Test POST duplicate (same startup+metric+condition) returns 409
- [x] Test GET list returns all rules for startup
- [x] Test PATCH update changes threshold/severity
- [x] Test DELETE removes rule and cascaded alerts
- [x] Test GET alerts returns alerts with optional status filter
- [x] Test POST triage ack sets status to `acknowledged`
- [x] Test POST triage snooze sets `snoozedUntil`
- [x] Test POST bulk-triage updates multiple alerts

### Task 3: Implement Z-score alert evaluator
File: `apps/api/src/lib/alerts/evaluator.ts`
- [x] Create `evaluateAlerts(startupId, db)` async function
- [x] Load all enabled `alert_rules` for startup
- [x] For each rule: look up current metric value, load 30-day history, evaluate condition
- [x] Implement z_score calculation: `|current - mean| / stddev`
- [x] Handle edge cases (zero base, SD=0, insufficient data)
- [x] Implement dedup logic: check existing active/snoozed alert for `(rule_id, startup_id)`
- [x] If exists: UPDATE `occurrence_count += 1`, `last_fired_at = now()`
- [x] If new: INSERT alert row
- [x] Emit `alert.fired` event via event emitter
- [x] Return array of `{ alert, isNew }` for downstream notification

### Task 4: Implement default alert rule seeder
File: `apps/api/src/lib/alerts/seeder.ts`
- [x] Create `seedDefaultAlerts(startupId, availableMetricKeys, db)` async function
- [x] Check if startup already has alert rules (skip if any exist)
- [x] For each default rule config (mrr `drop_wow_pct` 20% critical, active_users `drop_wow_pct` 25% high, etc.)
- [x] Only seed if `metricKey` is in `availableMetricKeys`
- [x] Insert `alert_rule` rows via Drizzle

### Task 5: Implement alert rule CRUD routes
File: `apps/api/src/routes/alert-rule.ts`
- [x] Create `AlertRuleRuntime` interface (db)
- [x] `POST /api/startups/:startupId/alert-rules` -- validate input with `AlertRuleSchema`, insert, return 201
- [x] Handle unique constraint violation -> 409
- [x] `GET /api/startups/:startupId/alert-rules` -- select all rules for startup
- [x] `PATCH /api/startups/:startupId/alert-rules/:ruleId` -- partial update
- [x] `DELETE /api/startups/:startupId/alert-rules/:ruleId` -- delete (cascades)

### Task 6: Implement alert triage routes
File: `apps/api/src/routes/alert-rule.ts` (same file)
- [x] `GET /api/startups/:startupId/alerts` -- list with optional status filter
- [x] `POST /api/alerts/:alertId/triage` -- validate action (`ack`/`snooze`/`dismiss`)
- [x] For ack: set `status='acknowledged'`
- [x] For snooze: set `status='snoozed'`, `snoozedUntil = now + hours` (default 24, max 168)
- [x] For dismiss: set `status='dismissed'`
- [x] Emit `alert.ack`/`alert.snoozed`/`alert.dismissed` event
- [x] `POST /api/startups/:startupId/alerts/bulk-triage` -- apply action to multiple alerts (`alertIds` or all active)

### Task 7: Integrate alert evaluation into post-sync pipeline
File: `apps/worker/src/processors/sync.ts`
- [ ] After health snapshot recompute, call `evaluateAlerts(startupId, db)`
- [ ] Store metric values in `health_snapshot_history` table
- [ ] Call `seedDefaultAlerts` on first sync (check if startup has zero alert rules)
- [ ] Update streak: if zero active alerts -> increment `current_days`, else reset to 0
- [ ] 30s timeout for alert evaluation per startup

### Task 8: Register alert routes in app
File: `apps/api/src/app.ts`
- [ ] Import alert rule route handlers
- [ ] Add all alert rule CRUD routes with auth middleware
- [ ] Add alert triage routes with auth middleware
- [ ] Wire `AlertRuleRuntime` with db instance
