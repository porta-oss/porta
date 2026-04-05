// Startup-health snapshot schema — stores the persisted B2B SaaS health
// read model computed by the sync worker.
//
// Two tables:
//   - health_snapshot: one row per startup, replaced atomically per recompute.
//   - health_funnel_stage: one row per funnel stage per startup, replaced alongside the snapshot.
//
// Never contains connector credentials or raw provider data.

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { startup } from "./startup";

export const healthSnapshot = pgTable(
  "health_snapshot",
  {
    id: text("id").primaryKey(),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    healthState: text("health_state").notNull(),
    blockedReason: text("blocked_reason"),
    northStarKey: text("north_star_key").notNull(),
    northStarValue: numeric("north_star_value"),
    northStarPreviousValue: numeric("north_star_previous_value"),
    /** JSONB: UniversalMetrics from @shared/universal-metrics */
    supportingMetrics: jsonb("supporting_metrics").notNull(),
    syncJobId: text("sync_job_id"),
    computedAt: timestamp("computed_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("health_snapshot_startup_uidx").on(table.startupId),
    index("health_snapshot_healthState_idx").on(table.healthState),
    index("health_snapshot_computedAt_idx").on(table.computedAt),
  ]
);

export const healthSnapshotRelations = relations(healthSnapshot, ({ one }) => ({
  startup: one(startup, {
    fields: [healthSnapshot.startupId],
    references: [startup.id],
  }),
}));

export const healthFunnelStage = pgTable(
  "health_funnel_stage",
  {
    id: text("id").primaryKey(),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    value: integer("value").notNull(),
    position: integer("position").notNull(),
    /** References the health_snapshot.id this stage belongs to. */
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => healthSnapshot.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("health_funnel_stage_startupId_idx").on(table.startupId),
    uniqueIndex("health_funnel_stage_startup_key_uidx").on(
      table.startupId,
      table.key
    ),
    index("health_funnel_stage_snapshotId_idx").on(table.snapshotId),
  ]
);

export const healthFunnelStageRelations = relations(
  healthFunnelStage,
  ({ one }) => ({
    startup: one(startup, {
      fields: [healthFunnelStage.startupId],
      references: [startup.id],
    }),
    snapshot: one(healthSnapshot, {
      fields: [healthFunnelStage.snapshotId],
      references: [healthSnapshot.id],
    }),
  })
);

// ---------------------------------------------------------------------------
// health_snapshot_history — time-series metric values for sparklines / trends
// ---------------------------------------------------------------------------

export const healthSnapshotHistory = pgTable(
  "health_snapshot_history",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    value: numeric("value").notNull(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => healthSnapshot.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("health_snapshot_history_startup_metric_idx").on(
      table.startupId,
      table.metricKey,
      table.capturedAt
    ),
    index("health_snapshot_history_captured_idx").on(table.capturedAt),
  ]
);

export const healthSnapshotHistoryRelations = relations(
  healthSnapshotHistory,
  ({ one }) => ({
    startup: one(startup, {
      fields: [healthSnapshotHistory.startupId],
      references: [startup.id],
    }),
    snapshot: one(healthSnapshot, {
      fields: [healthSnapshotHistory.snapshotId],
      references: [healthSnapshot.id],
    }),
  })
);
