import { relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { workspace } from "./auth";

export const startup = pgTable(
  "startup",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    stage: text("stage").notNull(),
    timezone: text("timezone").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("startup_workspaceId_idx").on(table.workspaceId),
    uniqueIndex("startup_workspace_name_uidx").on(
      table.workspaceId,
      table.name
    ),
  ]
);

export const startupRelations = relations(startup, ({ one }) => ({
  workspace: one(workspace, {
    fields: [startup.workspaceId],
    references: [workspace.id],
  }),
}));
