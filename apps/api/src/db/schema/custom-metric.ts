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
 * One row per startup — stores setup metadata (label, unit, schema, view)
 * plus the last synced metric values (metric_value, previous_value, captured_at).
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
    /** Human-readable label displayed on the dashboard. */
    label: text("label").notNull(),
    /** Display unit, e.g. "$", "%", "users". */
    unit: text("unit").notNull(),
    /** Identifier-safe schema name of the prepared view. */
    schema: text("schema").notNull(),
    /** Identifier-safe view name of the prepared view. */
    view: text("view").notNull(),
    /** Status of the metric: pending (pre-sync), active (synced), error (sync failed). */
    status: text("status").notNull().default("pending"),
    /** Last synced metric value. */
    metricValue: numeric("metric_value"),
    /** Previous metric value from the last-but-one sync. */
    previousValue: numeric("previous_value"),
    /** Timestamp of the last successful metric capture. */
    capturedAt: timestamp("captured_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("custom_metric_startup_uidx").on(table.startupId),
    index("custom_metric_connector_idx").on(table.connectorId),
    index("custom_metric_status_idx").on(table.status),
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
