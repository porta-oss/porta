import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { startup } from "./startup";

// ---------------------------------------------------------------------------
// alert_rule — per-startup threshold rules that fire alerts
// ---------------------------------------------------------------------------

export const alertRule = pgTable(
  "alert_rule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    condition: text("condition").notNull(),
    threshold: numeric("threshold").notNull(),
    severity: text("severity").notNull().default("medium"),
    enabled: boolean("enabled").notNull().default(true),
    minDataPoints: integer("min_data_points").notNull().default(7),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("alert_rule_startup_idx").on(table.startupId),
    uniqueIndex("alert_rule_startup_metric_condition_uidx").on(
      table.startupId,
      table.metricKey,
      table.condition
    ),
    check(
      "alert_rule_condition_check",
      sql`${table.condition} IN ('drop_wow_pct', 'spike_vs_avg', 'below_threshold', 'above_threshold')`
    ),
    check(
      "alert_rule_severity_check",
      sql`${table.severity} IN ('critical', 'high', 'medium', 'low')`
    ),
  ]
);

export const alertRuleRelations = relations(alertRule, ({ one, many }) => ({
  startup: one(startup, {
    fields: [alertRule.startupId],
    references: [startup.id],
  }),
  alerts: many(alert),
}));

// ---------------------------------------------------------------------------
// alert — fired instances of alert rules
// ---------------------------------------------------------------------------

export const alert = pgTable(
  "alert",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => alertRule.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    severity: text("severity").notNull(),
    value: numeric("value").notNull(),
    threshold: numeric("threshold").notNull(),
    status: text("status").notNull().default("active"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull(),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("alert_startup_idx").on(table.startupId),
    index("alert_status_idx").on(table.status),
    index("alert_startup_status_idx").on(table.startupId, table.status),
    index("alert_rule_idx").on(table.ruleId),
    check(
      "alert_status_check",
      sql`${table.status} IN ('active', 'acknowledged', 'snoozed', 'dismissed', 'resolved')`
    ),
  ]
);

export const alertRelations = relations(alert, ({ one }) => ({
  startup: one(startup, {
    fields: [alert.startupId],
    references: [startup.id],
  }),
  rule: one(alertRule, {
    fields: [alert.ruleId],
    references: [alertRule.id],
  }),
}));

// ---------------------------------------------------------------------------
// streak — per-startup health streak tracking
// ---------------------------------------------------------------------------

export const streak = pgTable("streak", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  startupId: text("startup_id")
    .notNull()
    .unique()
    .references(() => startup.id, { onDelete: "cascade" }),
  currentDays: integer("current_days").notNull().default(0),
  longestDays: integer("longest_days").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  brokenAt: timestamp("broken_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const streakRelations = relations(streak, ({ one }) => ({
  startup: one(startup, {
    fields: [streak.startupId],
    references: [startup.id],
  }),
}));
