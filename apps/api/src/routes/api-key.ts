// API key management route handlers.
// Create, list, and revoke API keys for MCP programmatic access.
// All operations require an authenticated session with an active workspace.
// Keys use SHA-256 hash storage — the full key is returned only at creation.

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { apiKey } from "../db/schema/api-key";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DrizzleDb = ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;

interface ApiKeyRuntime {
  db: { db: DrizzleDb };
}

interface ApiKeyWorkspaceContext {
  workspace: { id: string };
}

interface CreateApiKeyBody {
  name: string;
  scope: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateApiKey(scope: string): string {
  const random = randomBytes(16).toString("hex"); // 32 hex chars
  return `porta_${scope}_${random}`;
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.toISOString();
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/settings/api-keys
 * Create a new API key for the workspace.
 * Returns the full key once — it cannot be retrieved again.
 */
export async function handleCreateApiKey(
  runtime: ApiKeyRuntime,
  wsCtx: ApiKeyWorkspaceContext,
  body: CreateApiKeyBody,
  set: { status?: number | string }
) {
  const name = body.name?.trim();
  if (!name) {
    set.status = 400;
    return {
      error: {
        code: "NAME_REQUIRED",
        message: "API key name is required.",
      },
    };
  }

  const scope = body.scope?.trim();
  if (scope !== "read" && scope !== "write") {
    set.status = 400;
    return {
      error: {
        code: "INVALID_SCOPE",
        message: 'Scope must be "read" or "write".',
      },
    };
  }

  const fullKey = generateApiKey(scope);
  const keyHash = hashKey(fullKey);
  // Prefix: first 8 chars after "porta_{scope}_"
  const prefixStart = `porta_${scope}_`.length;
  const keyPrefix = fullKey.slice(0, prefixStart + 8);

  const insertedRows = await runtime.db.db
    .insert(apiKey)
    .values({
      workspaceId: wsCtx.workspace.id,
      name,
      keyHash,
      keyPrefix,
      scope,
    })
    .returning();

  const inserted = insertedRows[0];
  if (!inserted) {
    set.status = 502;
    return {
      error: {
        code: "API_KEY_CREATE_FAILED",
        message: "API key creation returned an unexpected payload.",
      },
    };
  }

  set.status = 201;
  return {
    key: fullKey,
    apiKey: {
      id: inserted.id,
      name: inserted.name,
      keyPrefix: inserted.keyPrefix,
      scope: inserted.scope,
      createdAt: toIso(inserted.createdAt),
    },
  };
}

/**
 * GET /api/settings/api-keys
 * List non-revoked API keys for the workspace.
 */
export async function handleListApiKeys(
  runtime: ApiKeyRuntime,
  wsCtx: ApiKeyWorkspaceContext
) {
  const rows = await runtime.db.db
    .select({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scope: apiKey.scope,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
    })
    .from(apiKey)
    .where(
      and(eq(apiKey.workspaceId, wsCtx.workspace.id), isNull(apiKey.revokedAt))
    );

  return {
    apiKeys: rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      scope: row.scope,
      lastUsedAt: toIso(row.lastUsedAt),
      createdAt: toIso(row.createdAt),
    })),
  };
}

/**
 * DELETE /api/settings/api-keys/:keyId
 * Revoke an API key by setting revoked_at.
 */
export async function handleRevokeApiKey(
  runtime: ApiKeyRuntime,
  wsCtx: ApiKeyWorkspaceContext,
  keyId: string,
  set: { status?: number | string }
) {
  const rows = await runtime.db.db
    .select({ id: apiKey.id, workspaceId: apiKey.workspaceId })
    .from(apiKey)
    .where(eq(apiKey.id, keyId));

  const existing = rows[0];
  if (!existing) {
    set.status = 404;
    return {
      error: {
        code: "API_KEY_NOT_FOUND",
        message: "API key not found.",
      },
    };
  }

  if (existing.workspaceId !== wsCtx.workspace.id) {
    set.status = 403;
    return {
      error: {
        code: "API_KEY_SCOPE_INVALID",
        message: "The API key does not belong to the active workspace.",
      },
    };
  }

  await runtime.db.db
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(eq(apiKey.id, keyId));

  return { revoked: true };
}
