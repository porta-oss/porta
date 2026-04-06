// MCP API key authentication middleware.
// Extracts Bearer token, hashes with SHA-256, validates against api_key table,
// enforces scope (read/write), updates last_used_at, and returns workspace context.
// Includes Redis sliding-window rate limiting (60 req/min per key).

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import Redis from "ioredis";

import { apiKey } from "../../db/schema/api-key";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpScope = "read" | "write";

/** Successful authentication result with workspace context. */
export interface McpAuthContext {
  apiKeyId: string;
  keyPrefix: string;
  scope: McpScope;
  workspaceId: string;
}

/** Authentication/authorization error returned to the client. */
export interface McpAuthError {
  code: string;
  error: string;
  retryAfter?: number;
}

type DrizzleDb = ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/** Pluggable rate limiter so callers can inject Redis or a stub. */
export interface McpRateLimiter {
  check(apiKeyId: string): Promise<{ allowed: boolean; retryAfter?: number }>;
  close?(): Promise<void>;
}

/**
 * Redis-backed sliding-window rate limiter using INCR + EXPIRE.
 * Key format: `rate:mcp:{apiKeyId}`, window = 60 s, max = 60 requests.
 */
export function createRedisRateLimiter(
  redisUrl: string,
  opts?: { maxRequests?: number; windowSeconds?: number }
): McpRateLimiter {
  const client = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const max = opts?.maxRequests ?? RATE_LIMIT_MAX;
  const window = opts?.windowSeconds ?? RATE_LIMIT_WINDOW_SECONDS;

  return {
    async check(apiKeyId: string) {
      const key = `rate:mcp:${apiKeyId}`;
      const count = await client.incr(key);

      // Set expiry only on the first increment (new window).
      if (count === 1) {
        await client.expire(key, window);
      }

      if (count > max) {
        const ttl = await client.ttl(key);
        return { allowed: false, retryAfter: ttl > 0 ? ttl : window };
      }

      return { allowed: true };
    },

    async close() {
      await client.quit();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hash a raw API key with SHA-256 for comparison against stored hashes. */
function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Extract Bearer token from the Authorization header. */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Authenticate an MCP request via API key.
 *
 * 1. Extract Bearer token from Authorization header
 * 2. SHA-256 hash the token
 * 3. Look up api_key by key_hash
 * 4. Check revoked_at is null (else 401)
 * 5. Check scope against the required scope for the endpoint
 * 6. Update last_used_at
 * 7. Return workspace context
 */
export async function authenticateMcpRequest(
  request: Request,
  requiredScope: McpScope,
  db: DrizzleDb,
  set: { status?: number | string },
  rateLimiter?: McpRateLimiter
): Promise<McpAuthContext | McpAuthError> {
  const token = extractBearerToken(request);

  if (!token) {
    set.status = 401;
    return {
      error:
        "Missing or malformed Authorization header. Use: Bearer porta_<scope>_<key>",
      code: "UNAUTHORIZED",
    };
  }

  const hash = hashApiKey(token);

  const [record] = await db
    .select()
    .from(apiKey)
    .where(eq(apiKey.keyHash, hash))
    .limit(1);

  if (!record) {
    set.status = 401;
    return {
      error: "Invalid API key.",
      code: "UNAUTHORIZED",
    };
  }

  if (record.revokedAt) {
    set.status = 401;
    return {
      error: "API key has been revoked.",
      code: "UNAUTHORIZED",
    };
  }

  // Write keys can access all endpoints; read keys can only access read endpoints
  if (requiredScope === "write" && record.scope === "read") {
    set.status = 403;
    return {
      error: "Insufficient scope. This endpoint requires write access.",
      code: "FORBIDDEN",
    };
  }

  // Rate limit: 60 req/min per API key (sliding window via Redis)
  if (rateLimiter) {
    const rateResult = await rateLimiter.check(record.id);
    if (!rateResult.allowed) {
      set.status = 429;
      return {
        error: "Rate limit exceeded. Maximum 60 requests per minute.",
        code: "RATE_LIMITED",
        retryAfter: rateResult.retryAfter,
      };
    }
  }

  // Update last_used_at asynchronously (non-blocking)
  void db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, record.id));

  return {
    apiKeyId: record.id,
    keyPrefix: record.keyPrefix,
    scope: record.scope as McpScope,
    workspaceId: record.workspaceId,
  };
}

/** Type guard — returns true when the result is an auth error. */
export function isMcpAuthError(
  result: McpAuthContext | McpAuthError
): result is McpAuthError {
  return "error" in result;
}
