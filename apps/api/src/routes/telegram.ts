// Telegram bot configuration routes.
// POST /api/workspace/telegram — setup bot token, generate verification code.
// DELETE /api/workspace/telegram — unlink Telegram chat.

import type { TelegramConfigSummary } from "@shared/telegram";
import { telegramSetupInputSchema } from "@shared/telegram";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";

import { telegramConfig } from "../db/schema/telegram-config";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface TelegramRuntime {
  db: {
    db: ReturnType<typeof drizzle>;
  };
}

interface WorkspaceContext {
  workspace: { id: string };
}

interface TelegramRouteError {
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
  error: TelegramRouteError["error"]
): TelegramRouteError {
  set.status = status;
  return { error };
}

function generateVerificationCode(): string {
  const code = Math.floor(100_000 + Math.random() * 900_000);
  return String(code);
}

interface TelegramConfigRow {
  botUsername: string | null;
  chatId: string | null;
  digestTime: string;
  digestTimezone: string;
  id: string;
  isActive: boolean;
  lastDigestAt: Date | string | null;
  workspaceId: string;
}

function serializeTelegramConfig(
  row: TelegramConfigRow
): TelegramConfigSummary {
  return {
    botUsername: row.botUsername,
    chatId: row.chatId,
    digestTime: row.digestTime,
    digestTimezone: row.digestTimezone,
    id: row.id,
    isActive: row.isActive,
    lastDigestAt: toIso(row.lastDigestAt),
    workspaceId: row.workspaceId,
  };
}

/** Fetch bot info from Telegram API. Extracted for testability. */
export async function fetchBotInfo(
  botToken: string
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const url = `https://api.telegram.org/bot${botToken}/getMe`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      return { ok: false, error: `Telegram API returned ${response.status}` };
    }

    const data = (await response.json()) as {
      ok: boolean;
      result?: { username?: string };
    };

    if (!(data.ok && data.result?.username)) {
      return { ok: false, error: "Invalid response from Telegram API" };
    }

    return { ok: true, username: data.result.username };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to reach Telegram API",
    };
  }
}

// ------------------------------------------------------------------
// Handlers
// ------------------------------------------------------------------

export async function handleSetupTelegram(
  runtime: TelegramRuntime,
  wsCtx: WorkspaceContext,
  body: unknown,
  set: { status?: number | string },
  botInfoFetcher: typeof fetchBotInfo = fetchBotInfo
): Promise<
  | {
      config: TelegramConfigSummary;
      verificationCode: string;
    }
  | TelegramRouteError
> {
  const parsed = telegramSetupInputSchema.safeParse(body);
  if (!parsed.success) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const input = parsed.data;

  // Verify bot token with Telegram API
  const botInfo = await botInfoFetcher(input.botToken);
  if (!botInfo.ok) {
    return createErrorResponse(set, 400, {
      code: "TELEGRAM_BOT_INVALID",
      message: botInfo.error,
    });
  }

  const verificationCode = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  try {
    // Upsert: insert or update if workspace already has a config
    const existing = await runtime.db.db
      .select({ id: telegramConfig.id })
      .from(telegramConfig)
      .where(eq(telegramConfig.workspaceId, wsCtx.workspace.id));

    let rows: unknown[];

    if (existing.length > 0) {
      rows = await runtime.db.db
        .update(telegramConfig)
        .set({
          botToken: input.botToken,
          botUsername: botInfo.username,
          chatId: null,
          isActive: false,
          verificationCode,
          verificationExpiresAt: expiresAt,
          digestTime: input.digestTime,
          digestTimezone: input.digestTimezone,
        })
        .where(eq(telegramConfig.workspaceId, wsCtx.workspace.id))
        .returning();
    } else {
      rows = await runtime.db.db
        .insert(telegramConfig)
        .values({
          workspaceId: wsCtx.workspace.id,
          botToken: input.botToken,
          botUsername: botInfo.username,
          verificationCode,
          verificationExpiresAt: expiresAt,
          digestTime: input.digestTime,
          digestTimezone: input.digestTimezone,
        })
        .returning();
    }

    const row = rows[0];
    if (!row) {
      return createErrorResponse(set, 500, {
        code: "TELEGRAM_SETUP_FAILED",
        message: "Failed to save Telegram configuration.",
      });
    }

    set.status = existing.length > 0 ? 200 : 201;
    return {
      config: serializeTelegramConfig(row as TelegramConfigRow),
      verificationCode,
    };
  } catch (error) {
    const pgCode = getPgErrorCode(error);

    if (pgCode === "23505") {
      return createErrorResponse(set, 409, {
        code: "TELEGRAM_DUPLICATE",
        message: "Telegram is already configured for this workspace.",
      });
    }

    console.error("[telegram] setup failed", {
      workspaceId: wsCtx.workspace.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "TELEGRAM_SETUP_FAILED",
      message: "Failed to save Telegram configuration. Please retry.",
      retryable: true,
    });
  }
}

export async function handleDeleteTelegram(
  runtime: TelegramRuntime,
  wsCtx: WorkspaceContext,
  set: { status?: number | string }
): Promise<{ deleted: boolean; workspaceId: string } | TelegramRouteError> {
  try {
    const rows = await runtime.db.db
      .update(telegramConfig)
      .set({
        chatId: null,
        isActive: false,
      })
      .where(eq(telegramConfig.workspaceId, wsCtx.workspace.id))
      .returning({ id: telegramConfig.id });

    if (rows.length === 0) {
      return createErrorResponse(set, 404, {
        code: "TELEGRAM_NOT_FOUND",
        message: "No Telegram configuration found for this workspace.",
      });
    }

    return { deleted: true, workspaceId: wsCtx.workspace.id };
  } catch (error) {
    console.error("[telegram] delete failed", {
      workspaceId: wsCtx.workspace.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "TELEGRAM_DELETE_FAILED",
      message: "Failed to unlink Telegram. Please retry.",
      retryable: true,
    });
  }
}
