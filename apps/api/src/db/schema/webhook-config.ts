import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { startup } from "./startup";

// ---------------------------------------------------------------------------
// webhook_config — per-startup outbound webhook endpoint configuration
// ---------------------------------------------------------------------------

export const webhookConfig = pgTable(
  "webhook_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    eventTypes: jsonb("event_types").notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    circuitBrokenAt: timestamp("circuit_broken_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("webhook_config_startup_uidx").on(table.startupId),
    index("webhook_config_enabled_idx").on(table.enabled),
  ]
);

export const webhookConfigRelations = relations(webhookConfig, ({ one }) => ({
  startup: one(startup, {
    fields: [webhookConfig.startupId],
    references: [startup.id],
  }),
}));
