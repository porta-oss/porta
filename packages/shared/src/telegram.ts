// Telegram bot configuration and digest payload contracts.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Validates a Telegram bot token (numeric ID + alphanumeric secret). */
export const telegramSetupInputSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{35}$/, "Invalid bot token"),
  digestTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Must be HH:MM format")
    .default("09:00"),
  digestTimezone: z.string().min(1).default("UTC"),
});

export type TelegramSetupInput = z.infer<typeof telegramSetupInputSchema>;

// ---------------------------------------------------------------------------
// Digest payload schemas
// ---------------------------------------------------------------------------

/** Per-startup summary included in a Telegram digest message. */
export const telegramStartupDigestSchema = z.object({
  alerts: z.number().int().nonnegative(),
  healthScore: z.number().min(0).max(100).nullable(),
  name: z.string(),
  northStarDelta: z.number().nullable(),
  northStarKey: z.string(),
  northStarValue: z.number().nullable(),
  startupId: z.string(),
  streakDays: z.number().int().nonnegative(),
});

export type TelegramStartupDigest = z.infer<typeof telegramStartupDigestSchema>;

/** Full digest payload sent via Telegram. */
export const telegramDigestPayloadSchema = z.object({
  generatedAt: z.iso.datetime(),
  startups: z.array(telegramStartupDigestSchema),
  workspaceId: z.string(),
});

export type TelegramDigestPayload = z.infer<typeof telegramDigestPayloadSchema>;

// ---------------------------------------------------------------------------
// Summary interface — returned to the UI
// ---------------------------------------------------------------------------

export interface TelegramConfigSummary {
  botUsername: string | null;
  chatId: string | null;
  digestTime: string;
  digestTimezone: string;
  id: string;
  isActive: boolean;
  lastDigestAt: string | null;
  workspaceId: string;
}
