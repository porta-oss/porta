// Startup-insight schema — stores the latest grounded insight per startup.
//
// One table:
//   - startup_insight: one row per startup (latest insight), replaced atomically.
//     Separates deterministic evidence (condition code, evidence packet) from
//     AI-authored explanation (observation, hypothesis, actions).
//     Tracks generation diagnostics (status, last error) without storing
//     raw provider payloads, prompts, or secrets.
//
// The worker writes; the API reads; the UI renders.

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { startup } from "./startup";

export const startupInsight = pgTable(
  "startup_insight",
  {
    id: text("id").primaryKey(),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),

    // Deterministic fields
    conditionCode: text("condition_code").notNull(),
    /** JSONB: EvidencePacket from @shared/startup-insight */
    evidence: jsonb("evidence").notNull(),

    // AI explanation fields (null when generation skipped/failed)
    /** JSONB: InsightExplanation from @shared/startup-insight (nullable) */
    explanation: jsonb("explanation"),

    // Generation diagnostics
    generationStatus: text("generation_status").notNull(),
    lastError: text("last_error"),
    /** Model used for the explainer call, null if skipped. */
    model: text("model"),
    /** Explainer latency in milliseconds, null if skipped. */
    explainerLatencyMs: integer("explainer_latency_ms"),

    // Timestamps
    generatedAt: timestamp("generated_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("startup_insight_startup_uidx").on(table.startupId),
    index("startup_insight_conditionCode_idx").on(table.conditionCode),
    index("startup_insight_generationStatus_idx").on(table.generationStatus),
    index("startup_insight_generatedAt_idx").on(table.generatedAt),
  ]
);

export const startupInsightRelations = relations(startupInsight, ({ one }) => ({
  startup: one(startup, {
    fields: [startupInsight.startupId],
    references: [startup.id],
  }),
}));
