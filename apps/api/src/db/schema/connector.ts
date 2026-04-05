import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { startup } from "./startup";

export const connector = pgTable(
  "connector",
  {
    id: text("id").primaryKey(),
    startupId: text("startup_id")
      .notNull()
      .references(() => startup.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("pending"),
    /** Hex-encoded AES-256-GCM ciphertext. */
    encryptedConfig: text("encrypted_config").notNull(),
    /** Hex-encoded 12-byte IV for AES-256-GCM. */
    encryptionIv: text("encryption_iv").notNull(),
    /** Hex-encoded 16-byte GCM authentication tag. */
    encryptionAuthTag: text("encryption_auth_tag").notNull(),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncDurationMs: integer("last_sync_duration_ms"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("connector_startup_provider_uidx").on(
      table.startupId,
      table.provider
    ),
    index("connector_startupId_idx").on(table.startupId),
    index("connector_status_idx").on(table.status),
    check(
      "connector_provider_check",
      sql`${table.provider} IN ('posthog', 'stripe', 'postgres', 'yookassa', 'sentry')`
    ),
    check(
      "connector_status_check",
      sql`${table.status} IN ('pending', 'connected', 'error', 'disconnected', 'stale')`
    ),
  ]
);

export const connectorRelations = relations(connector, ({ one, many }) => ({
  startup: one(startup, {
    fields: [connector.startupId],
    references: [startup.id],
  }),
  syncJobs: many(syncJob),
}));

export const syncJob = pgTable(
  "sync_job",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id")
      .notNull()
      .references(() => connector.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    trigger: text("trigger").notNull(),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sync_job_connectorId_idx").on(table.connectorId),
    index("sync_job_status_idx").on(table.status),
    index("sync_job_createdAt_idx").on(table.createdAt),
    check(
      "sync_job_status_check",
      sql`${table.status} IN ('queued', 'running', 'completed', 'failed')`
    ),
    check(
      "sync_job_trigger_check",
      sql`${table.trigger} IN ('initial', 'manual', 'scheduled')`
    ),
  ]
);

export const syncJobRelations = relations(syncJob, ({ one }) => ({
  connector: one(connector, {
    fields: [syncJob.connectorId],
    references: [connector.id],
  }),
}));
