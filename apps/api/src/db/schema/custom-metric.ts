import { relations } from "drizzle-orm";
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { connector } from "./connector";
import { startup } from "./startup";

/**
 * Startup-scoped custom metric definition and read-model row.
 *
 * One row per (startup, key) pair — stores setup metadata (label, unit, category)
 * plus the last synced metric values (metric_value, previous_value, delta, captured_at).
 * The connection string lives in the linked connector row (encrypted).
 */
export const customMetric = pgTable(
  "custom_metric",
  {
    id: text("id").primaryKey(),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    connectorId: text("connector_id")
      .notNull()
      .references(() => connector.id, { onDelete: "cascade" }),
    /** Identifier-safe key for this metric (e.g. 'dau', 'nps_score'). */
    key: text("key").notNull().default(""),
    /** Human-readable label displayed on the dashboard. */
    label: text("label").notNull(),
    /** Display unit, e.g. "$", "%", "users". */
    unit: text("unit").notNull(),
    /** Metric category for grouping. */
    category: text("category").notNull().default("custom"),
    /** Last synced metric value. */
    metricValue: numeric("metric_value"),
    /** Previous metric value from the last-but-one sync. */
    previousValue: numeric("previous_value"),
    /** Computed delta between current and previous value. */
    delta: numeric("delta"),
    /** Timestamp of the last successful metric capture. */
    capturedAt: timestamp("captured_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("custom_metric_startup_key_uidx").on(
      table.startupId,
      table.key
    ),
    index("custom_metric_connector_idx").on(table.connectorId),
  ]
);

export const customMetricRelations = relations(customMetric, ({ one }) => ({
  startup: one(startup, {
    fields: [customMetric.startupId],
    references: [startup.id],
  }),
  connector: one(connector, {
    fields: [customMetric.connectorId],
    references: [connector.id],
  }),
}));
