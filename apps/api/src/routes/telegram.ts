// Telegram bot configuration routes.
// POST /api/workspace/telegram — setup bot token, generate verification code.
// DELETE /api/workspace/telegram — unlink Telegram chat.
// POST /api/telegram/webhook/:configId — handle incoming Telegram updates.

import type { TelegramConfigSummary } from "@shared/telegram";
import { telegramSetupInputSchema } from "@shared/telegram";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";
import type { Transformer } from "grammy";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

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

// ------------------------------------------------------------------
// Webhook handler
// ------------------------------------------------------------------

/** Build a UserFromGetMe from stored config values (avoids getMe API call). */
function buildBotInfo(
  botToken: string,
  botUsername: string | null
): UserFromGetMe {
  const botId = Number.parseInt(botToken.split(":")[0], 10);
  return {
    id: Number.isFinite(botId) ? botId : 0,
    is_bot: true,
    first_name: botUsername ?? "Bot",
    username: botUsername ?? "bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    can_manage_bots: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  };
}

/**
 * Handle incoming Telegram updates via webhook.
 * Creates a grammY Bot per-request with the stored bot token, registers
 * `/start <code>` handling, and processes the update.
 *
 * @param apiTransformer - optional grammY Transformer to intercept outgoing
 *   Telegram API calls (used in tests to avoid real network requests).
 */
export async function handleTelegramWebhook(
  runtime: TelegramRuntime,
  configId: string,
  body: unknown,
  set: { status?: number | string },
  apiTransformer?: Transformer
): Promise<{ ok: boolean } | TelegramRouteError> {
  // Look up config by ID
  const configs = await runtime.db.db
    .select()
    .from(telegramConfig)
    .where(eq(telegramConfig.id, configId));

  const config = configs[0];
  if (!config) {
    return createErrorResponse(set, 404, {
      code: "TELEGRAM_CONFIG_NOT_FOUND",
      message: "No Telegram configuration found for this webhook.",
    });
  }

  // Create a grammY Bot with stored botInfo (skips getMe API call)
  const bot = new Bot(config.botToken, {
    botInfo: buildBotInfo(config.botToken, config.botUsername),
  });

  // Install test transformer if provided (intercepts outgoing API calls)
  if (apiTransformer) {
    bot.api.config.use(apiTransformer);
  }

  // Handle /start <code> — verify code, link chat, activate
  bot.command("start", async (ctx) => {
    const code = ctx.match?.trim();
    if (!code) {
      await ctx.reply("Please provide a verification code: /start <code>");
      return;
    }

    // Verify code matches this config and hasn't expired
    if (
      config.verificationCode !== code ||
      !config.verificationExpiresAt ||
      new Date(config.verificationExpiresAt) < new Date()
    ) {
      await ctx.reply("Invalid or expired code");
      return;
    }

    // Link chat_id, activate, clear verification code
    await runtime.db.db
      .update(telegramConfig)
      .set({
        chatId: String(ctx.chat.id),
        isActive: true,
        verificationCode: null,
        verificationExpiresAt: null,
      })
      .where(eq(telegramConfig.id, config.id));

    await ctx.reply("Linked!");
  });

  // Process the update through grammY middleware stack
  try {
    await bot.handleUpdate(body as Update);
  } catch (error) {
    console.error("[telegram] webhook processing error", {
      configId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true };
}
