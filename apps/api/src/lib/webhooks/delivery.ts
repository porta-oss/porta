// Webhook delivery: HMAC signing, SSRF validation, HTTP delivery, circuit breaker.
// Stub — implementation in Task 2.

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

// ---------------------------------------------------------------------------
// IP blocklist check
// ---------------------------------------------------------------------------

/**
 * Check if an IP address is in the SSRF blocklist:
 * RFC 1918 (10.x, 172.16-31.x, 192.168.x), loopback (127.x),
 * link-local (169.254.x), cloud metadata (169.254.169.254).
 */
export function isBlockedIp(_ip: string): boolean {
  throw new Error("Not implemented");
}

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 hex digest of the body using the given secret.
 */
export function signPayload(_body: string, _secret: string): string {
  throw new Error("Not implemented");
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Validate a webhook URL: must be HTTPS, resolved IP must not be blocked.
 * Accepts optional resolver for testing (defaults to real DNS).
 */
export async function validateUrl(
  _url: string,
  _resolver?: (hostname: string) => Promise<string[]>
): Promise<UrlValidationResult> {
  throw new Error("Not implemented");
}

// ---------------------------------------------------------------------------
// Webhook delivery
// ---------------------------------------------------------------------------

/**
 * Deliver a webhook payload to the configured URL with HMAC signing.
 * Re-resolves DNS at delivery time (DNS rebinding guard).
 */
export async function deliverWebhook(
  _config: WebhookConfig,
  _payload: WebhookDeliveryPayload,
  _options?: DeliveryOptions
): Promise<DeliveryResult> {
  throw new Error("Not implemented");
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/**
 * Record a delivery result. On failure, increments consecutive_failures.
 * If failures reach 10, disables the webhook (circuit breaker).
 * On success, resets consecutive_failures to 0.
 */
export async function recordDeliveryResult(
  _pool: DbPool,
  _webhookConfigId: string,
  _success: boolean
): Promise<CircuitBreakerResult> {
  throw new Error("Not implemented");
}
