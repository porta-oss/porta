import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { workspace } from "./auth";
import { startup } from "./startup";

// ---------------------------------------------------------------------------
// event_log — audit trail for all system events
// ---------------------------------------------------------------------------

export const eventLog = pgTable(
  "event_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    startupId: text("startup_id").references(() => startup.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("event_log_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt
    ),
    index("event_log_startup_created_idx").on(table.startupId, table.createdAt),
    index("event_log_type_idx").on(table.eventType),
    index("event_log_created_idx").on(table.createdAt),
    check(
      "event_log_actor_type_check",
      sql`${table.actorType} IN ('system', 'user', 'ai', 'mcp')`
    ),
  ]
);

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  workspace: one(workspace, {
    fields: [eventLog.workspaceId],
    references: [workspace.id],
  }),
  startup: one(startup, {
    fields: [eventLog.startupId],
    references: [startup.id],
  }),
}));
