// Webhook configuration CRUD routes.
// All routes require an authenticated session with an active workspace.
// Provides create, read, update, and delete for per-startup webhook config.
// One webhook per startup (unique constraint on startupId).

import type { EventType } from "@shared/event-log";
import type { WebhookConfigSummary } from "@shared/webhook";
import { webhookConfigInputSchema } from "@shared/webhook";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";

import { webhookConfig } from "../db/schema/webhook-config";
import { validateUrl } from "../lib/webhooks/delivery";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface WebhookConfigRuntime {
  db: {
    db: ReturnType<typeof drizzle>;
  };
  resolver?: (hostname: string) => Promise<string[]>;
}

interface WorkspaceContext {
  workspace: { id: string };
}

interface WebhookConfigRouteError {
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPgErrorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }
  if (isRecord(error) && "cause" in error) {
    return getPgErrorCode(error.cause);
  }
  return undefined;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function createErrorResponse(
  set: { status?: number | string },
  status: number,
  error: WebhookConfigRouteError["error"]
): WebhookConfigRouteError {
  set.status = status;
  return { error };
}

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface WebhookConfigRow {
  circuitBrokenAt: Date | string | null;
  consecutiveFailures: number;
  enabled: boolean;
  eventTypes: unknown;
  id: string;
  secret: string;
  startupId: string;
  url: string;
}

function serializeWebhookConfig(row: WebhookConfigRow): WebhookConfigSummary {
  return {
    circuitBrokenAt: toIso(row.circuitBrokenAt),
    consecutiveFailures: row.consecutiveFailures,
    enabled: row.enabled,
    eventTypes: row.eventTypes as EventType[],
    id: row.id,
    startupId: row.startupId,
    url: row.url,
  };
}

// ------------------------------------------------------------------
// Handlers
// ------------------------------------------------------------------

export async function handleCreateWebhookConfig(
  runtime: WebhookConfigRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  body: unknown,
  set: { status?: number | string }
): Promise<
  { secret: string; webhook: WebhookConfigSummary } | WebhookConfigRouteError
> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  const parsed = webhookConfigInputSchema.safeParse(body);
  if (!parsed.success) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const input = parsed.data;

  // SSRF validation
  const urlCheck = await validateUrl(input.url, runtime.resolver);
  if (!urlCheck.valid) {
    return createErrorResponse(set, 400, {
      code: "URL_VALIDATION_FAILED",
      message: urlCheck.error ?? "URL validation failed.",
    });
  }

  const secret = generateSecret();

  try {
    const rows = await runtime.db.db
      .insert(webhookConfig)
      .values({
        startupId,
        url: input.url,
        secret,
        eventTypes: input.eventTypes,
        enabled: input.enabled,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      return createErrorResponse(set, 500, {
        code: "WEBHOOK_CREATE_FAILED",
        message: "Failed to create webhook.",
      });
    }

    set.status = 201;
    return {
      webhook: serializeWebhookConfig(row as WebhookConfigRow),
      secret,
    };
  } catch (error) {
    const pgCode = getPgErrorCode(error);

    if (pgCode === "23505") {
      return createErrorResponse(set, 409, {
        code: "WEBHOOK_DUPLICATE",
        message: "A webhook already exists for this startup.",
      });
    }

    console.error("[webhook-config] create failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "WEBHOOK_CREATE_FAILED",
      message: "Failed to create webhook. Please retry.",
      retryable: true,
    });
  }
}

export async function handleGetWebhookConfig(
  runtime: WebhookConfigRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  set: { status?: number | string }
): Promise<{ webhook: WebhookConfigSummary | null } | WebhookConfigRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  try {
    const rows = await runtime.db.db
      .select()
      .from(webhookConfig)
      .where(eq(webhookConfig.startupId, startupId));

    const row = rows[0];
    if (!row) {
      return { webhook: null };
    }

    return { webhook: serializeWebhookConfig(row as WebhookConfigRow) };
  } catch (error) {
    console.error("[webhook-config] get failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "WEBHOOK_GET_FAILED",
      message: "Failed to get webhook config. Please retry.",
      retryable: true,
    });
  }
}

export async function handleUpdateWebhookConfig(
  runtime: WebhookConfigRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  body: unknown,
  set: { status?: number | string }
): Promise<{ webhook: WebhookConfigSummary } | WebhookConfigRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  const raw = isRecord(body) ? body : {};
  const updateSchema = webhookConfigInputSchema.partial();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const input = parsed.data;

  const updates: Record<string, unknown> = {};
  if ("url" in raw && input.url !== undefined) {
    // Re-validate URL with SSRF check
    const urlCheck = await validateUrl(input.url, runtime.resolver);
    if (!urlCheck.valid) {
      return createErrorResponse(set, 400, {
        code: "URL_VALIDATION_FAILED",
        message: urlCheck.error ?? "URL validation failed.",
      });
    }
    updates.url = input.url;
  }
  if ("eventTypes" in raw && input.eventTypes !== undefined) {
    updates.eventTypes = input.eventTypes;
  }
  if ("enabled" in raw && input.enabled !== undefined) {
    updates.enabled = input.enabled;
  }

  if (Object.keys(updates).length === 0) {
    return createErrorResponse(set, 400, {
      code: "NO_UPDATES",
      message: "No valid fields to update.",
    });
  }

  try {
    const rows = await runtime.db.db
      .update(webhookConfig)
      .set(updates)
      .where(eq(webhookConfig.startupId, startupId))
      .returning();

    const row = rows[0];
    if (!row) {
      return createErrorResponse(set, 404, {
        code: "WEBHOOK_NOT_FOUND",
        message: "Webhook config not found for this startup.",
      });
    }

    return { webhook: serializeWebhookConfig(row as WebhookConfigRow) };
  } catch (error) {
    console.error("[webhook-config] update failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "WEBHOOK_UPDATE_FAILED",
      message: "Failed to update webhook. Please retry.",
      retryable: true,
    });
  }
}

export async function handleDeleteWebhookConfig(
  runtime: WebhookConfigRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  set: { status?: number | string }
): Promise<{ deleted: boolean; startupId: string } | WebhookConfigRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  try {
    const rows = await runtime.db.db
      .delete(webhookConfig)
      .where(eq(webhookConfig.startupId, startupId))
      .returning({ id: webhookConfig.id });

    if (rows.length === 0) {
      return createErrorResponse(set, 404, {
        code: "WEBHOOK_NOT_FOUND",
        message: "Webhook config not found for this startup.",
      });
    }

    return { deleted: true, startupId };
  } catch (error) {
    console.error("[webhook-config] delete failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "WEBHOOK_DELETE_FAILED",
      message: "Failed to delete webhook. Please retry.",
      retryable: true,
    });
  }
}
