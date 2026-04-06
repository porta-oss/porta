# Webhook Delivery Contracts

**Spec ref**: US-9

## Configuration

**Route**: `POST /api/startups/:startupId/webhook`

```typescript
// Create/Update webhook config
{
  url: string;                // HTTPS only, no private IPs
  eventTypes: EventType[];    // Which events trigger delivery
  enabled?: boolean;          // Default true
}
// Response includes auto-generated `secret` (shown once)
```

**URL validation (at config time AND delivery time):**
- Must be HTTPS (`/^https:\/\//`)
- DNS resolve → reject if IP is RFC 1918 (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`), loopback (`127.x`), or cloud metadata (`169.254.169.254`)
- Re-resolve DNS at delivery time (DNS rebinding guard)

## Payload Shape

Defined as Zod schema in `packages/shared/src/webhook.ts`:

```typescript
interface WebhookPayload {
  event: EventType;
  timestamp: string;          // ISO 8601
  startupId: string;
  payload: object;            // Per-event-type shape (same as event_log.payload)
  deliveryId: string;         // UUIDv4 — for consumer-side dedup
}
```

## HTTP Delivery

**Method**: `POST`

**Headers**:
```
Content-Type: application/json
X-Porta-Signature: sha256=<HMAC-SHA256 hex digest of body using secret>
X-Porta-Delivery: <deliveryId>
```

**HMAC computation** (Node.js):
```typescript
import { createHmac } from "node:crypto";
const signature = createHmac("sha256", secret)
  .update(JSON.stringify(body))
  .digest("hex");
// Header: X-Porta-Signature: sha256=<signature>
```

**Timeout**: 10 seconds per attempt.

## Retry & Circuit Breaker

**Retry**: BullMQ exponential backoff — 1m, 5m, 15m, 60m (4 retries max).

**Dead-letter queue**: Failed deliveries after 4 retries stored for 7 days, viewable in dashboard webhook config panel.

**Circuit breaker**: After 10 consecutive failures to same endpoint:
1. Set `webhook_config.enabled = false`
2. Set `webhook_config.circuit_broken_at = now()`
3. Log `webhook.circuit_broken` event
4. Notify operator via Telegram (if linked) or dashboard banner

**Event logging**: Each delivery logged with status, HTTP response code, and `deliveryId`. Payload content NOT logged (avoid PII duplication).
