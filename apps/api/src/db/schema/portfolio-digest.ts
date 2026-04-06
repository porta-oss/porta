import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspace } from "./auth";

export const portfolioDigest = pgTable(
  "portfolio_digest",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    aiSynthesis: text("ai_synthesis"),
    structuredData: jsonb("structured_data").notNull(),
    startupCount: integer("startup_count").notNull().default(0),
    synthesizedAt: timestamp("synthesized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("portfolio_digest_workspace_uidx").on(table.workspaceId),
    index("portfolio_digest_synthesized_at_idx").on(table.synthesizedAt),
  ]
);
