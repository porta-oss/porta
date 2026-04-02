// Internal-task schema — stores tasks derived from insight actions.
//
// One table:
//   - internal_task: one task per startup + source insight + action index
//     combination (idempotent). Carries startup linkage, insight/action
//     metadata, linked metric keys, and Linear sync status.
//
// The API writes on create; the worker updates sync status; the UI reads.
// Never store Linear API keys, GraphQL headers, or secret payloads.

import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, integer } from 'drizzle-orm/pg-core';

import { startup } from './startup';

export const internalTask = pgTable(
  'internal_task',
  {
    id: text('id').primaryKey(),
    startupId: text('startup_id')
      .notNull()
      .references(() => startup.id, { onDelete: 'cascade' }),

    // Source insight/action linkage
    sourceInsightId: text('source_insight_id').notNull(),
    sourceActionIndex: integer('source_action_index').notNull(),

    // Task content — derived from insight action at creation time
    title: text('title').notNull(),
    description: text('description').notNull(),

    // Metric linkage — metric keys from the evidence packet
    /** JSONB: string[] of metric keys from the insight evidence. */
    linkedMetricKeys: jsonb('linked_metric_keys').notNull().$type<string[]>(),

    // Linear sync state
    syncStatus: text('sync_status').notNull().default('not_synced'),
    linearIssueId: text('linear_issue_id'),
    lastSyncError: text('last_sync_error'),
    lastSyncAttemptAt: timestamp('last_sync_attempt_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // One task per startup + insight + action index — enforces idempotency
    uniqueIndex('internal_task_startup_insight_action_uidx').on(
      table.startupId,
      table.sourceInsightId,
      table.sourceActionIndex,
    ),
    index('internal_task_startupId_idx').on(table.startupId),
    index('internal_task_syncStatus_idx').on(table.syncStatus),
    index('internal_task_createdAt_idx').on(table.createdAt),
  ],
);

export const internalTaskRelations = relations(internalTask, ({ one }) => ({
  startup: one(startup, {
    fields: [internalTask.startupId],
    references: [startup.id],
  }),
}));
