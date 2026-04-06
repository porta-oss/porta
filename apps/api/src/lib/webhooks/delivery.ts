// Webhook delivery: HMAC signing, SSRF validation, HTTP delivery, circuit breaker.

import { createHmac } from "node:crypto";
import { promises as dns } from "node:dns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  error?: string;
  httpStatus?: number;
  success: boolean;
}

export interface WebhookConfig {
  id: string;
  secret: string;
  url: string;
}

export interface WebhookDeliveryPayload {
  deliveryId: string;
  event: string;
  payload: Record<string, unknown>;
  startupId: string;
  timestamp: string;
}

export interface UrlValidationResult {
  error?: string;
  valid: boolean;
}

/** Options for dependency injection in tests. */
export interface DeliveryOptions {
  fetcher?: (
    url: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>;
  resolver?: (hostname: string) => Promise<string[]>;
}

export interface CircuitBreakerResult {
  circuitBroken: boolean;
  consecutiveFailures: number;
}

/** Minimal pool interface matching ApiDatabase.pool. */
export interface DbPool {
  query: (sql: string) => Promise<unknown>;
}

const CIRCUIT_BREAKER_THRESHOLD = 10;
const DELIVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Default DNS resolver
// ---------------------------------------------------------------------------

async function defaultResolver(hostname: string): Promise<string[]> {
  const result = await dns.resolve4(hostname);
  return result;
}

// ---------------------------------------------------------------------------
// IP blocklist check
// ---------------------------------------------------------------------------

export function isBlockedIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    return true;
  }

  const [a, b] = parts;

  // Loopback: 127.0.0.0/8
  if (a === 127) {
    return true;
  }
  // RFC 1918: 10.0.0.0/8
  if (a === 10) {
    return true;
  }
  // RFC 1918: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  // RFC 1918: 192.168.0.0/16
  if (a === 192 && b === 168) {
    return true;
  }
  // Link-local: 169.254.0.0/16 (includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export async function validateUrl(
  url: string,
  resolver?: (hostname: string) => Promise<string[]>
): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, error: "URL must use HTTPS" };
  }

  const resolve = resolver ?? defaultResolver;
  let ips: string[];
  try {
    ips = await resolve(parsed.hostname);
  } catch {
    return { valid: false, error: "DNS resolution failed" };
  }

  for (const ip of ips) {
    if (isBlockedIp(ip)) {
      return { valid: false, error: `Blocked IP address: ${ip}` };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Webhook delivery
// ---------------------------------------------------------------------------

export async function deliverWebhook(
  config: WebhookConfig,
  payload: WebhookDeliveryPayload,
  options?: DeliveryOptions
): Promise<DeliveryResult> {
  // Re-resolve DNS at delivery time (DNS rebinding guard)
  const urlValidation = await validateUrl(config.url, options?.resolver);
  if (!urlValidation.valid) {
    return { success: false, error: urlValidation.error };
  }

  const body = JSON.stringify(payload);
  const signature = signPayload(body, config.secret);
  const fetcher = options?.fetcher ?? fetch;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetcher(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Porta-Signature": `sha256=${signature}`,
        "X-Porta-Delivery": payload.deliveryId,
      },
      body,
      signal: controller.signal,
    });

    return { success: response.ok, httpStatus: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delivery failed";
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export async function recordDeliveryResult(
  pool: DbPool,
  webhookConfigId: string,
  success: boolean
): Promise<CircuitBreakerResult> {
  if (success) {
    await pool.query(
      `UPDATE "webhook_config"
       SET consecutive_failures = 0, updated_at = NOW()
       WHERE id = '${webhookConfigId}'`
    );
    return { circuitBroken: false, consecutiveFailures: 0 };
  }

  // Increment failures atomically and check threshold
  const result = (await pool.query(
    `UPDATE "webhook_config"
     SET consecutive_failures = consecutive_failures + 1,
         updated_at = NOW()
     WHERE id = '${webhookConfigId}'
     RETURNING consecutive_failures`
  )) as { rows: Array<{ consecutive_failures: number }> };

  const failures = result.rows[0].consecutive_failures;

  if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
    await pool.query(
      `UPDATE "webhook_config"
       SET enabled = false, circuit_broken_at = NOW(), updated_at = NOW()
       WHERE id = '${webhookConfigId}'`
    );
    return { circuitBroken: true, consecutiveFailures: failures };
  }

  return { circuitBroken: false, consecutiveFailures: failures };
}
