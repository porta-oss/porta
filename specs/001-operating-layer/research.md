# Research: Operating Layer

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document resolves all technical unknowns identified during planning.

---

## 1. MCP SDK Maturity

### Decision: Ship native MCP via `elysia-mcp` plugin + REST endpoints as dual interface

### Rationale
Research found that `elysia-mcp` v0.1.1 **exists** (published 2026-01-26, MIT license, 77 commits). It wraps `@modelcontextprotocol/sdk` v1.25.3+ with Streamable HTTP transport, handles JSON-RPC 2.0, SSE streaming, and session management. It has an `authentication` option for Bearer token validation — exactly what we need.

The official `@modelcontextprotocol/sdk` is at v1.29.0 (maintained by Anthropic). No official `@modelcontextprotocol/elysia` adapter exists, but the community `elysia-mcp` fills this gap.

**Elysia version requirement**: `elysia-mcp` requires `elysia >=1.4.21`. Porta is on `^1.4.8` — needs a minor bump via `pnpm update elysia`.

### Implementation
- Install `elysia-mcp` (pulls `@modelcontextprotocol/sdk` as dependency)
- Mount MCP plugin at `/mcp` on existing Elysia app
- Register 8 tools in `setupServer` callback with Zod input schemas
- Implement Bearer token auth in the `authentication` handler
- **Also** expose the same 8 tools as REST endpoints under `/api/mcp/*` for non-MCP clients
- Tool handlers are pure service functions called by both MCP and REST routes — no duplication
- REST endpoints use API key auth only (no session cookies) to prevent CSRF

### Architecture
```
apps/api/src/
  routes/mcp.ts          -- elysia-mcp plugin mount at /mcp
  routes/mcp-rest.ts     -- REST fallback at /api/mcp/*
  services/mcp-tools.ts  -- 8 tool handlers (pure functions, shared)
  lib/mcp/auth.ts        -- Bearer token validation (shared)
```

### Alternatives Considered
- **REST-only first**: Lower risk but misses the MCP ecosystem opportunity. Since `elysia-mcp` exists, worth trying native MCP
- **Custom MCP implementation**: Over-engineering. `elysia-mcp` already does the integration work
- **Fallback plan**: If `elysia-mcp` proves unreliable at implementation time, drop back to REST-only (the service layer is identical)

---

## 2. YooKassa API Integration

### Decision: HTTP Basic Auth + REST API, no official SDK

### Rationale
YooKassa (ЮKassa) provides a REST API at `https://api.yookassa.ru/v3/` with HTTP Basic Auth (`shop_id:secret_key`). There is no well-maintained official TypeScript/Node.js SDK — use plain `fetch` with Basic auth header.

### Key Findings

**Authentication**: HTTP Basic Auth
```
Authorization: Basic base64(shop_id:secret_key)
```

**Credential validation**: `GET /v3/me`
- Returns shop info on success (200)
- Returns 401 on invalid credentials

**Payment list**: `GET /v3/payments`
- Query params: `status` (succeeded/canceled/waiting_for_capture), `created_at.gte` (ISO 8601), `limit` (max 100), `cursor` (pagination)
- Response: `{ items: Payment[], next_cursor?: string }`
- Amounts in `amount.value` (string, rubles with kopek decimals, e.g., `"1234.56"`) and `amount.currency` (ISO 4217)

**Refund list**: `GET /v3/refunds`
- Same pagination pattern (cursor-based, max 100)
- Similar amount structure

**Rate limits**: Undocumented but generally ~60 req/min. Implement conservative 1-second delay between paginated requests.

**Customer data**: Payment objects have optional `metadata` field that may contain customer identifiers. The `customer_id` field is not guaranteed — YooKassa is payment-level, not customer-level. Graceful degradation: use payment reference as identifier when customer_id absent.

### Implementation
```typescript
// YooKassa validator
async function validate(config: { shopId: string; secretKey: string }) {
  const res = await fetch("https://api.yookassa.ru/v3/me", {
    headers: {
      Authorization: `Basic ${btoa(`${config.shopId}:${config.secretKey}`)}`,
    },
  });
  return { valid: res.ok };
}
```

### Sync metrics produced
| Metric Key | Source | Computation |
|-----------|--------|-------------|
| `yookassa_revenue_30d` | `GET /v3/payments?status=succeeded&created_at.gte=...` | Sum of `amount.value` across all pages |
| `yookassa_failed_payments` | `GET /v3/payments?status=canceled&created_at.gte=...` | Count |
| `yookassa_refunds_30d` | `GET /v3/refunds?created_at.gte=...` | Count + sum |

### Scoping note
YooKassa API keys are shop-level and cannot be scoped to read-only. Documentation must recommend a dedicated shop for Porta if the founder operates multiple shops.

---

## 3. Sentry API Integration

### Decision: Bearer token + REST API, standard endpoints

### Rationale
Sentry provides a well-documented REST API. No need for an SDK — the 3 metrics we need come from 2-3 endpoints.

### Key Findings

**Authentication**: Bearer token with `project:read` scope
```
Authorization: Bearer <auth_token>
```

**Credential validation**: `GET /api/0/projects/{org}/{project}/`
- 200 on valid credentials + access
- 403 on insufficient scope
- 404 on invalid org/project

**Error count (24h)**: `GET /api/0/projects/{org}/{project}/stats/`
- Query params: `stat=received`, `resolution=1h`, `since=<24h_ago_unix>`
- Returns array of `[timestamp, count]` pairs. Sum for 24h total → `error_rate`

**P95 latency**: `GET /api/0/organizations/{org}/events/`
- Query: `field=p95(transaction.duration)&project={project_id}&statsPeriod=24h`
- Alternative: `GET /api/0/organizations/{org}/events-stats/` with `yAxis=p95(transaction.duration)`
- Returns P95 in milliseconds → `p95_latency` custom metric

**Crash-free sessions**: `GET /api/0/organizations/{org}/sessions/`
- Query: `project={project_id}&field=crash_free_rate(session)&statsPeriod=24h&interval=24h`
- Returns percentage → `crash_free_rate` custom metric

**Rate limits**: 40 req/min for auth tokens, documented in response headers (`X-Sentry-Rate-Limit-*`).

**Pagination**: Link header-based (`rel="next"`), not cursor-based.

### Implementation
```typescript
// Sentry validator
async function validate(config: { authToken: string; organization: string; project: string }) {
  const res = await fetch(
    `https://sentry.io/api/0/projects/${config.organization}/${config.project}/`,
    { headers: { Authorization: `Bearer ${config.authToken}` } }
  );
  return { valid: res.ok };
}
```

---

## 4. Telegram Bot API

### Decision: Use `grammy` (grammY) package with webhook mode for receiving, direct API calls for sending

### Rationale
grammY is the most modern, TypeScript-first Telegram Bot framework (2024-2026). It supports webhook mode, has excellent TypeScript types, and handles the Telegram Bot API 7.0+ reaction API natively.

### Key Findings

**Package**: `grammy` (npm) — zero-config TypeScript, supports Bun and Node
- Alternative: `telegraf` — older, less TypeScript-native
- Alternative: `node-telegram-bot-api` — too low-level

**Sending messages**: Worker sends via direct Bot API calls (no webhook needed for sending). BullMQ job calls `bot.api.sendMessage()` / `bot.api.sendPhoto()`.

**Receiving updates (webhook mode)**:
- Register webhook: `bot.api.setWebhook("https://portal.example.com/api/telegram/webhook")`
- Elysia route handles POST `/api/telegram/webhook` → passes to grammY's `webhookCallback()`
- Alternative: Long polling via `bot.start()` — simpler but requires persistent process

**Recommendation**: Use **webhook mode** in production (Elysia handles the POST). Use **long polling** in development only.

**Emoji reactions — CRITICAL FINDING**: Reactions do **NOT work in private (1:1) bot chats**. The `message_reaction` update requires the bot to be an admin, which is only possible in groups/supergroups. Since Porta's bot communicates via private DM, emoji reactions (spec US-2: 👍/😴/❌) are **not feasible**.

**Alternative: Inline keyboard buttons** (recommended replacement):
- grammY `InlineKeyboard` provides tap-to-triage buttons: `[Ack] [Snooze] [Dismiss]`
- Returns `callback_query` update (works in ALL chat types including DMs)
- Same UX — one tap to triage — but via buttons instead of reactions
- `callback_data` encodes action: `"triage:ack:alert123"`, `"triage:snooze:alert123"`
- This is a **spec deviation** from US-2 acceptance criteria (reactions → buttons) that must be documented

**Rate limits**: 30 messages/second globally, 1 message/second per chat. For daily digest (1 message per workspace), no concern.

**Deep links**: Use `https://t.me/<bot_username>?start=<code>` for verification. In messages, use regular URLs for dashboard links.

**sendPhoto**: Accepts `InputFile` (Buffer) for PNG sparkline images. Max file size: 10MB (sparklines are ~5KB).

### Implementation Pattern
```typescript
import { Bot } from "grammy";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Verification handler
bot.command("start", async (ctx) => {
  const code = ctx.match; // text after /start
  // Look up telegram_config by verification_code...
});

// Reaction handler
bot.on("message_reaction", async (ctx) => {
  const { message_id, new_reaction } = ctx.messageReaction;
  // Map message_id → alert_id, apply triage action...
});
```

---

## 5. Sparkline Generation (resvg-js)

### Decision: Use `@resvg/resvg-js` WASM build in Node.js worker

### Rationale
resvg-js is a pure Rust SVG renderer compiled to WASM. No native addons — works in both Bun and Node.js. The worker runs Node.js in production specifically for WASM compatibility.

### Key Findings

**Package**: `@resvg/resvg-js` (npm)
- Pure WASM build: `@resvg/resvg-js` auto-detects platform
- No native dependencies — WASM bundle included

**Usage**:
```typescript
import { Resvg } from "@resvg/resvg-js";

function renderSparkline(values: number[]): Buffer {
  const svg = generateSparklineSVG(values, 200, 50); // Build SVG string
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 200 } });
  const pngData = resvg.render();
  return pngData.asPng(); // Returns Buffer
}
```

**Performance**: 200x50px PNG renders in <10ms. Well within the 5-second timeout budget.

**Fallback**: If rendering fails (try/catch), fall back to text-only with Unicode trend arrows:
- Up: `↑` or `📈`
- Down: `↓` or `📉`
- Flat: `→` or `➡️`

**SVG template**: Simple polyline on transparent background with metric color. No axes, no labels — pure trend line.

### Alternatives Considered
- **sharp**: Powerful but heavyweight, requires native addons
- **canvas (node-canvas)**: Requires Cairo — native dependency pain
- **roughjs**: Sketch-style, wrong aesthetic for data

---

## 6. Z-Score Anomaly Detection

### Decision: Rolling 30-day window, 2.5 SD threshold, min 7 data points

### Rationale
Z-score is the simplest statistically sound anomaly detection for startup metrics. 2.5 SD catches genuine anomalies while tolerating normal variance. 7 minimum data points ensures the standard deviation is meaningful.

### Key Findings

**Formula**:
```
z_score = |current_value - mean| / standard_deviation
FIRE if z_score >= 2.5
```

**Rolling window computation** (efficient):
```typescript
function computeZScore(values: number[], current: number): number {
  const n = values.length;
  if (n < 2) return 0; // Can't compute SD with < 2 points

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1); // Sample variance
  const sd = Math.sqrt(variance);

  if (sd === 0) return 0; // Constant values — no anomaly possible

  return Math.abs(current - mean) / sd;
}
```

**Condition-specific evaluation:**

| Condition | Check | Z-score guard |
|-----------|-------|---------------|
| `drop_wow_pct` | `(previous - current) / previous * 100 >= threshold` | Yes — prevents "3 → 2 is 33% drop" noise |
| `spike_vs_avg` | `current / mean >= threshold` | Yes — prevents spikes on tiny absolute values |
| `below_threshold` | `current < threshold` | No — absolute thresholds are deterministic |
| `above_threshold` | `current > threshold` | No — absolute thresholds are deterministic |

**Edge cases:**
- **Zero base**: Skip `drop_wow_pct` (division by zero)
- **SD = 0**: Skip Z-score guard (all values identical — any change is infinite Z-score, but should still evaluate the primary condition)
- **Negative values**: Absolute value for Z-score, signed for condition check
- **Missing data points**: Skip evaluation if `history.length < minDataPoints`

**Statistical justification for min 7 data points**: With fewer than 7 data points, the sample standard deviation is unreliable (wide confidence intervals). 7 gives a reasonable estimate for daily metrics over 1 week.

**Why 2.5 SD**: A 2.5 SD threshold captures approximately 0.6% of normal distribution tails. For startup metrics (which are inherently noisy), this is more conservative than the typical 2.0 SD used in manufacturing. It prevents alert fatigue while catching genuine anomalies.

---

## 7. HMAC-SHA256 Webhook Signing

### Decision: Standard HMAC-SHA256 with `X-Porta-Signature` header

### Rationale
HMAC-SHA256 is the industry standard for webhook signature verification (used by GitHub, Stripe, Slack). Node.js `crypto` module provides it natively.

### Implementation
```typescript
import { createHmac } from "node:crypto";

function signWebhookPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// Header: X-Porta-Signature: sha256=<hex_digest>
```

**Verification on consumer side**:
```typescript
function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## 8. SSRF Prevention for Webhooks

### Decision: Validate URL at config time AND delivery time with DNS re-resolution

### Rationale
Webhook URLs configured by users can be abused to target internal services (SSRF). DNS rebinding attacks change DNS resolution between config and delivery. Must validate at both times.

### Implementation

**Blocked IP ranges:**
- `10.0.0.0/8` (RFC 1918)
- `172.16.0.0/12` (RFC 1918)
- `192.168.0.0/16` (RFC 1918)
- `127.0.0.0/8` (loopback)
- `169.254.0.0/16` (link-local, includes AWS metadata `169.254.169.254`)
- `0.0.0.0/8` (unspecified)
- `::1/128` (IPv6 loopback)
- `fc00::/7` (IPv6 private)

```typescript
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

async function validateWebhookUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return { valid: false, error: "HTTPS required" };

  // Resolve DNS
  const { address } = await lookup(parsed.hostname);
  if (isPrivateIp(address)) {
    return { valid: false, error: "Private/internal IP addresses are not allowed" };
  }

  return { valid: true };
}
```

**DNS rebinding guard**: At delivery time, resolve DNS again before making the HTTP request. If the resolved IP is private, abort delivery and log error.

---

## 9. BullMQ Queue Architecture

### Decision: 6 queues (existing sync + task-sync, new telegram + webhook + portfolio + purge)

### Rationale
Each queue represents a distinct delivery concern with different retry/backoff semantics.

### Queue Registry

| Queue Name | Purpose | Concurrency | Retry | Repeatable |
|------------|---------|-------------|-------|------------|
| `sync` (existing) | Connector sync + health recompute | 3 | 3 retries, exponential | Yes (per-connector interval) |
| `task-sync` (existing) | Linear issue creation | 1 | 2 retries | No |
| `telegram` (NEW) | Digest + alert message delivery | 1 | 4 retries (1m, 5m, 15m, 60m) | Yes (daily digest) |
| `webhook` (NEW) | Webhook payload delivery | 3 | 4 retries (1m, 5m, 15m, 60m) | No |
| `portfolio` (NEW) | Weekly portfolio AI digest | 1 | 2 retries | Yes (weekly) |
| `purge` (NEW) | Event log + snapshot history cleanup | 1 | 1 retry | Yes (daily) |

**Post-sync pipeline** (extended):
```
sync job completes
  → recompute health snapshot
  → store metric history (snapshot_history)
  → evaluate alert rules
  → for each fired alert:
      → emit event_log entry
      → enqueue telegram notification (if linked)
      → enqueue webhook delivery (if configured + event type matches)
  → generate insight (existing)
  → seed default alerts (first sync only)
  → update streak
```

**BullMQ repeatables** for scheduled jobs:
```typescript
// Daily digest — per-workspace, at configured time
await telegramQueue.add("digest", { workspaceId }, {
  repeat: { pattern: "0 9 * * *" }, // Adjusted per workspace timezone
  jobId: `digest-${workspaceId}`,
});

// Weekly portfolio digest
await portfolioQueue.add("portfolio", { workspaceId }, {
  repeat: { pattern: "0 10 * * 1" }, // Monday 10am
  jobId: `portfolio-${workspaceId}`,
});

// Daily purge
await purgeQueue.add("purge", {}, {
  repeat: { pattern: "0 3 * * *" }, // 3am daily
  jobId: "purge",
});
```

---

## 10. Postgres Connector: Multi-Metric View

### Decision: `connectionUri` only in config, AI-generated `porta_metrics` view

### Rationale
The current Postgres connector config includes `schema`, `view`, `label`, `unit` fields — designed for a single custom metric. The new design uses a standardized 6-column `porta_metrics` view that returns all metrics as rows. AI generates the initial CREATE VIEW SQL based on schema introspection.

### Key Findings

**Schema introspection query:**
```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_name, ordinal_position
```

**AI view generation prompt** (sent to Anthropic API):
```
Given this PostgreSQL schema, generate a CREATE OR REPLACE VIEW porta_metrics
statement that extracts the most valuable business metrics.

The view MUST return exactly these columns:
- metric_key (text): unique identifier (snake_case)
- label (text): human-readable name
- unit (text): display unit (e.g., "users", "RUB", "%")
- category (text): one of engagement/revenue/health/growth/custom
- value (numeric): current metric value
- captured_at (timestamptz): when the value was computed (use now())

Schema:
{schema_dump}

Startup context:
- Name: {startup.name}
- Type: {startup.type}
- Currency: {startup.currency}
```

**Sync query:**
```sql
SELECT metric_key, label, unit, category, value, captured_at
FROM porta_metrics
```

**Universal promotion**: If a row's `metric_key` matches a universal metric name (`mrr`, `active_users`, `churn_rate`, `error_rate`, `arpu`), Porta promotes it to the universal slot on the health snapshot.

**Migration from current schema**: Remove `schema` and `view` columns from `custom_metric` table. Postgres connector config drops to `connectionUri` only.

---

## 11. API Key Authentication

### Decision: SHA-256 hashed storage, `porta_<scope>_<32chars>` format

### Rationale
API keys for MCP/REST access must be secure at rest (hashed, not encrypted — no need to reverse) and include scope in the key format for quick permission checks.

### Implementation

**Key generation:**
```typescript
import { randomBytes, createHash } from "node:crypto";

function generateApiKey(scope: "read" | "write"): { key: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString("hex").slice(0, 32);
  const key = `porta_${scope}_${random}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 8); // "porta_re" or "porta_wr"
  return { key, hash, prefix };
}
```

**Auth middleware:**
```typescript
async function authenticateApiKey(authorization: string): Promise<ApiKeyContext> {
  const key = authorization.replace("Bearer ", "");
  const hash = createHash("sha256").update(key).digest("hex");
  const apiKey = await db.query.apiKey.findFirst({ where: eq(apiKey.keyHash, hash) });

  if (!apiKey || apiKey.revokedAt) throw new Error("FORBIDDEN");

  // Update last_used_at
  await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, apiKey.id));

  return { workspaceId: apiKey.workspaceId, scope: apiKey.scope, keyPrefix: apiKey.keyPrefix };
}
```

**Rate limiting**: 60 req/min per key. Implemented via Redis sliding window counter keyed on `api_key:<hash_prefix>`.

---

## Summary of Decisions

| # | Unknown | Decision | Risk |
|---|---------|----------|------|
| 1 | MCP SDK maturity | Native MCP via `elysia-mcp` v0.1.1 + REST fallback | Low — plugin exists, REST as safety net |
| 2 | YooKassa API | HTTP Basic Auth + fetch, no SDK | Low — API is stable, cursor pagination confirmed |
| 3 | Sentry API | Bearer token + standard endpoints, scopes: `project:read`, `org:read`, `event:read` | Low — well-documented |
| 4 | Telegram framework | grammY with `Api` class for sending, webhook/polling for receiving | Low — mature, TypeScript-first |
| 5 | Telegram triage | **Inline keyboard buttons** (not emoji reactions — reactions don't work in DMs) | Low — spec deviation documented |
| 6 | Sparkline rendering | `@resvg/resvg-js` native addon in Node.js worker (<5ms per render) | Low — proven, fast |
| 7 | Anomaly detection | Z-score, 2.5 SD, 30-day window, min 7 data points | Medium — may need tuning per metric type |
| 8 | Webhook signing | HMAC-SHA256 with timestamp in signed content, standard headers | Low — industry standard |
| 9 | SSRF prevention | IP validation + DNS rebinding guard at config AND delivery time | Low — comprehensive |
| 10 | Queue architecture | 6 BullMQ queues (2 existing + 4 new) | Low — follows existing pattern |
| 11 | Postgres multi-metric | porta_metrics view + AI generation | Medium — AI quality of generated SQL |
| 12 | API key auth | SHA-256 hash, `porta_<scope>_<32chars>` format, 60 req/min | Low — standard approach |

## Spec Deviations

| Spec Requirement | Deviation | Rationale |
|-----------------|-----------|-----------|
| US-2: Emoji reactions (👍/😴/❌) for triage | Inline keyboard buttons instead | Telegram Bot API does not support `message_reaction` in private DM chats — bot cannot be admin in 1:1 conversations. Inline keyboards provide equivalent one-tap triage UX |
| US-3: MCP SDK fallback to REST | Dual interface (native MCP + REST) | `elysia-mcp` v0.1.1 exists and is functional — ship both from day one |
| US-3: Sentry auth scope | `project:read` + `org:read` + `event:read` (not just `project:read`) | P95 latency and crash-free sessions require org-level endpoints that need additional scopes |
