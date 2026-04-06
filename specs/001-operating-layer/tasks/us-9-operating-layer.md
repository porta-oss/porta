# Plan: US-9 — Webhook Delivery for External Automations

## Overview

Webhook config per startup with HTTPS-only URLs, HMAC-SHA256 signing, SSRF IP validation, DNS rebinding guard, BullMQ retry with circuit breaker. Webhooks fire when alerts trigger, delivering typed event payloads to external automation endpoints.

**Tech stack**: TypeScript 5.x strict, Elysia API framework, Drizzle ORM (PostgreSQL), BullMQ + ioredis, React 19, TanStack Router, shadcn/ui, Better Auth, Zod. pnpm monorepo: `apps/api` (port 3000, Bun), `apps/web` (port 5173, Vite), `apps/worker` (BullMQ), `packages/shared` (Zod schemas).

**Dependencies**: All Wave 2 stories depend on Wave 1 (US-1 alerts + US-4 events + US-5 connectors being complete).

**Existing patterns**:
- Route handlers: `export async function handleXxx(runtime: XxxRuntime, wsCtx: WorkspaceContext, ...args, set: { status?: number|string })`
- Error responses: `{ error: { code: string, message: string, retryable?: boolean } }`
- DB schema: `pgTable()` with camelCase TS -> snake_case DB columns
- Shared types: const arrays + union types, Summary interfaces, Zod schemas
- Queue names: UPPERCASE_SNAKE_CASE constants
- TDD: Write failing tests first, then implement

**Webhook Config CRUD**:
- `POST /api/startups/:startupId/webhook` -- create (auto-gen secret, shown once)
- `GET /api/startups/:startupId/webhook` -- read config
- `PATCH /api/startups/:startupId/webhook` -- update URL/events
- `DELETE /api/startups/:startupId/webhook` -- remove

**Payload shape** (WebhookPayload from shared):
```
{ event: EventType, timestamp: ISO, startupId: string, payload: object, deliveryId: UUID }
```

**HTTP Delivery**:
- POST to configured URL
- Headers: `Content-Type: application/json`, `X-Porta-Signature: sha256=<HMAC-SHA256 hex of body>`, `X-Porta-Delivery: <deliveryId>`
- HMAC: `createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')`
- Timeout: 10s per attempt

**SSRF Protection**:
- URL must be HTTPS
- DNS resolve -> reject RFC 1918 (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x), loopback (127.x), cloud metadata (169.254.169.254)
- Re-resolve DNS at delivery time (DNS rebinding guard)

**Retry**: BullMQ exponential backoff -- 1m, 5m, 15m, 60m (4 retries). Dead-letter after 4 failures.

**Circuit breaker**: 10 consecutive failures -> disable webhook, set `circuit_broken_at`, log event.

**Frontend**: Settings page at `/settings/webhooks` with URL entry, event type selector, delivery log, circuit breaker status.

## Validation Commands
- `pnpm test`
- `pnpm check`
- `pnpm typecheck`

---

### Task 1: Write webhook delivery tests (TDD)
File: `apps/api/tests/webhook.delivery.test.ts`
- [x] Test HMAC-SHA256 signature computation matches expected format
- [x] Test SSRF: reject private IP 10.0.0.1 -> error
- [x] Test SSRF: reject loopback 127.0.0.1 -> error
- [x] Test SSRF: reject link-local 169.254.x -> error
- [x] Test SSRF: reject cloud metadata 169.254.169.254 -> error
- [x] Test SSRF: allow valid public HTTPS URL
- [x] Test DNS rebinding: re-resolve at delivery time
- [x] Test circuit breaker: 10 failures disables webhook

### Task 2: Implement HMAC signing and SSRF validation
File: `apps/api/src/lib/webhooks/delivery.ts`
- [ ] Create `signPayload(body: string, secret: string): string` -- HMAC-SHA256 hex
- [ ] Create `validateUrl(url: string): Promise<{valid: boolean, error?: string}>`
- [ ] Check HTTPS scheme
- [ ] DNS resolve URL hostname
- [ ] Check resolved IP against blocklist (RFC 1918, link-local, loopback, cloud metadata)
- [ ] Create `deliverWebhook(config, payload): Promise<{success, httpStatus?, error?}>`
- [ ] Re-resolve DNS at delivery time (fresh lookup, not cached)
- [ ] POST with 10s timeout via AbortController
- [ ] Set headers: Content-Type, X-Porta-Signature, X-Porta-Delivery

### Task 3: Implement webhook config CRUD routes
File: `apps/api/src/routes/webhook-config.ts`
- [ ] `POST /api/startups/:startupId/webhook` -- validate URL (HTTPS + SSRF check), auto-gen 32-char secret, insert, return config WITH secret (shown once)
- [ ] `GET /api/startups/:startupId/webhook` -- return config WITHOUT secret
- [ ] `PATCH /api/startups/:startupId/webhook` -- update URL and/or eventTypes, re-validate URL
- [ ] `DELETE /api/startups/:startupId/webhook` -- remove config

### Task 4: Implement webhook delivery processor
File: `apps/worker/src/processors/webhook.ts`
- [ ] Create processor for `WEBHOOK_QUEUE`
- [ ] Job payload: `{ webhookConfigId, eventType, eventPayload, startupId, deliveryId }`
- [ ] Load `webhook_config`, call `deliverWebhook`
- [ ] On success: reset `consecutive_failures` to 0, log `webhook.delivered` event
- [ ] On failure: increment `consecutive_failures`, log `webhook.failed` event
- [ ] Circuit breaker: if `consecutive_failures >= 10`, set `enabled=false`, set `circuit_broken_at`
- [ ] BullMQ retry config: attempts 4, backoff exponential (60000, 300000, 900000, 3600000)
- [ ] Dead-letter queue for final failures

### Task 5: Integrate webhook dispatch into alert pipeline
File: `apps/worker/src/processors/sync.ts`
- [ ] After alert fires, check if startup has enabled `webhook_config`
- [ ] Filter by `webhook_config.event_types` (only dispatch matching event types)
- [ ] Enqueue webhook delivery job to `WEBHOOK_QUEUE`
- [ ] Build WebhookPayload: `{ event, timestamp, startupId, payload, deliveryId }`

### Task 6: Create webhook settings page
File: `apps/web/src/routes/_authenticated/settings/webhooks.tsx`
- [ ] URL input field with HTTPS validation
- [ ] Event type multi-select checkboxes (from `EVENT_TYPES`)
- [ ] Display circuit breaker status (if `circuit_broken_at` set, show warning)
- [ ] Show secret on initial creation only (copy button)
- [ ] Delivery log section (recent `webhook.delivered`/`webhook.failed` events)
- [ ] Delete webhook button with confirmation

### Task 7: Register webhook routes in app
File: `apps/api/src/app.ts`
- [ ] Import webhook config route handlers
- [ ] Add POST/GET/PATCH/DELETE `/api/startups/:startupId/webhook` routes
- [ ] Wire `WebhookRuntime` with db instance
