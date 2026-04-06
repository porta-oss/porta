# Plan: US-7 — Portfolio-Level AI Insights

## Overview

Weekly AI-generated cross-startup pattern analysis via portfolio digest processor, available in Compare mode and `get_portfolio_summary` MCP tool. The processor loads all startups for a workspace, builds a metric context, calls the Anthropic API, and stores the synthesis for dashboard and MCP consumption.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 3 stories depend on Wave 1+2 being complete. US-7 specifically needs US-5 (connector data for startups) and US-3 (MCP tool infrastructure for `get_portfolio_summary`).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- Queue names: UPPERCASE_SNAKE_CASE constants (e.g., `PORTFOLIO_DIGEST_QUEUE`)
- Worker processors: BullMQ processor functions in `apps/worker/src/processors/`
- MCP tools: service handlers as pure functions in `apps/api/src/services/mcp-tools.ts`

**Portfolio Digest Processor**:
- Weekly BullMQ repeatable job (cron: `'0 8 * * 1'` — Monday 8am UTC)
- Load all startups for workspace with latest health snapshots + universal/custom metrics
- If >=2 startups: call Anthropic API (`messages.create`) with metric context -> generate cross-startup analysis text
- 30s AbortController timeout on AI call
- Store result (`ai_synthesis` text + `synthesized_at` timestamp) for dashboard and MCP access

**Graceful degradation**:
- <2 startups -> per-startup summary only (no cross comparison text)
- AI API unavailable/timeout -> metric-only digest (structured data, no `aiSynthesis` prose)
- Cost tracking: log AI API usage (token count, latency, cost estimate) in `event_log` as `insight.generated` event

**System prompt** for Anthropic API:
- Role: portfolio analyst for a multi-startup founder
- Input: per-startup name, type, health state, key metrics with deltas, active alert count
- Output: 3-5 bullet points identifying cross-startup patterns, correlations, and actionable recommendations
- Constraint: concise, data-driven, no speculation without evidence

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Implement portfolio digest processor
File: `apps/worker/src/processors/portfolio-digest.ts`
- [x] Create processor for `PORTFOLIO_DIGEST_QUEUE`
- [x] Load all startups for workspace with latest health snapshots
- [x] For each startup: collect name, type, health state, universal metrics (with deltas), active alert count
- [x] Build context string: structured per-startup summary with key metrics and trends
- [x] Call Anthropic API (`messages.create`) with system prompt for cross-startup pattern analysis
- [x] 30s timeout via AbortController
- [x] Parse AI response text
- [x] Store result in workspace-level storage (e.g., JSONB column on workspace or dedicated `portfolio_digest` table): `ai_synthesis` text + `synthesized_at` timestamp
- [x] Register as weekly repeatable job (cron: `'0 8 * * 1'` — Monday 8am UTC)

### Task 2: Add graceful degradation
File: `apps/worker/src/processors/portfolio-digest.ts` (same file)
- [x] Check startup count: if <2, generate per-startup summary text (structured bullet points per startup, no cross-comparison)
- [x] Wrap AI call in try/catch: on timeout or API error, return metric-only digest (structured data without prose `aiSynthesis`)
- [x] Log AI API usage in `event_log`: token count (input + output), latency ms, cost estimate, as `insight.generated` event type
- [x] On degraded mode: log `insight.degraded` event with reason (insufficient_startups | ai_unavailable | ai_timeout)

### Task 3: Wire AI synthesis into MCP + Compare mode
File: `apps/api/src/services/mcp-tools.ts`
- [ ] Update `getPortfolioSummary` MCP tool handler to include `aiSynthesis` and `synthesizedAt` from stored result
- [ ] If no stored result or stale (>7 days since `synthesized_at`): return response without `aiSynthesis` field
- [ ] Include `stale: true` flag in response when synthesis exists but is >7 days old
- [ ] Compare mode's `AiSynthesisCard` component (from US-6) reads from this same data source
