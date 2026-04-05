import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { workspace } from "./auth";

// ---------------------------------------------------------------------------
// telegram_config — per-workspace Telegram bot integration settings
// ---------------------------------------------------------------------------

export const telegramConfig = pgTable(
  "telegram_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    botToken: text("bot_token").notNull(),
    chatId: text("chat_id"),
    verificationCode: text("verification_code"),
    verificationExpiresAt: timestamp("verification_expires_at", {
      withTimezone: true,
    }),
    digestTime: text("digest_time").notNull().default("09:00"),
    digestTimezone: text("digest_timezone").notNull().default("UTC"),
    isActive: boolean("is_active").notNull().default(false),
    lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("telegram_config_workspace_uidx").on(table.workspaceId),
    index("telegram_config_chat_idx").on(table.chatId),
  ]
);

export const telegramConfigRelations = relations(telegramConfig, ({ one }) => ({
  workspace: one(workspace, {
    fields: [telegramConfig.workspaceId],
    references: [workspace.id],
  }),
}));
