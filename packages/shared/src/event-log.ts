// Event log types and schemas shared across API, worker, and UI.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "alert.fired",
  "alert.ack",
  "alert.snoozed",
  "alert.dismissed",
  "alert.resolved",
  "connector.synced",
  "connector.errored",
  "connector.created",
  "connector.deleted",
  "insight.degraded",
  "insight.generated",
  "insight.viewed",
  "telegram.digest",
  "telegram.alert",
  "telegram.reaction",
  "mcp.query",
  "mcp.action",
  "mcp.key_created",
  "mcp.key_revoked",
  "task.created",
  "task.completed",
  "webhook.delivered",
  "webhook.failed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ACTOR_TYPES = ["system", "user", "ai", "mcp"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-type payload Zod schemas
// ---------------------------------------------------------------------------

const alertFiredPayload = z.object({
  metricKey: z.string(),
  ruleId: z.string(),
  severity: z.string(),
  threshold: z.number(),
  value: z.number(),
});

const alertAckPayload = z.object({
  alertId: z.string(),
  ruleId: z.string(),
});

const alertSnoozedPayload = z.object({
  alertId: z.string(),
  ruleId: z.string(),
  snoozedUntil: z.string(),
});

const alertDismissedPayload = z.object({
  alertId: z.string(),
  ruleId: z.string(),
});

const alertResolvedPayload = z.object({
  alertId: z.string(),
  resolvedValue: z.number().nullable(),
  ruleId: z.string(),
});

const connectorSyncedPayload = z.object({
  connectorId: z.string(),
  provider: z.string(),
  recordsProcessed: z.number().int(),
});

const connectorErroredPayload = z.object({
  connectorId: z.string(),
  error: z.string(),
  provider: z.string(),
});

const connectorCreatedPayload = z.object({
  connectorId: z.string(),
  provider: z.string(),
});

const connectorDeletedPayload = z.object({
  connectorId: z.string(),
  provider: z.string(),
});

const insightDegradedPayload = z.object({
  reason: z.enum(["insufficient_startups", "ai_unavailable", "ai_timeout"]),
  startupCount: z.number().int(),
});

const insightGeneratedPayload = z.object({
  insightId: z.string(),
  summary: z.string(),
});

const insightViewedPayload = z.object({
  insightId: z.string(),
});

const telegramDigestPayload = z.object({
  chatId: z.string(),
  metricsIncluded: z.number().int(),
  startupCount: z.number().int(),
});

const telegramAlertPayload = z.object({
  alertId: z.string(),
  chatId: z.string(),
  metricKey: z.string(),
  severity: z.string(),
});

const telegramReactionPayload = z.object({
  chatId: z.string(),
  messageId: z.string(),
  reaction: z.string(),
});

const mcpQueryPayload = z.object({
  parameters: z.record(z.string(), z.unknown()),
  tool: z.string(),
});

const mcpActionPayload = z.object({
  parameters: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  tool: z.string(),
});

const mcpKeyCreatedPayload = z.object({
  keyId: z.string(),
  keyPrefix: z.string(),
  scope: z.string(),
});

const mcpKeyRevokedPayload = z.object({
  keyId: z.string(),
  keyPrefix: z.string(),
});

const taskCreatedPayload = z.object({
  taskId: z.string(),
  title: z.string(),
});

const taskCompletedPayload = z.object({
  taskId: z.string(),
  title: z.string(),
});

const webhookDeliveredPayload = z.object({
  eventType: z.string(),
  statusCode: z.number().int(),
  url: z.string(),
  webhookId: z.string(),
});

const webhookFailedPayload = z.object({
  attempt: z.number().int(),
  error: z.string(),
  eventType: z.string(),
  url: z.string(),
  webhookId: z.string(),
});

// ---------------------------------------------------------------------------
// Payload map — maps event type to its payload schema
// ---------------------------------------------------------------------------

export const EVENT_PAYLOAD_SCHEMAS = {
  "alert.ack": alertAckPayload,
  "alert.dismissed": alertDismissedPayload,
  "alert.fired": alertFiredPayload,
  "alert.resolved": alertResolvedPayload,
  "alert.snoozed": alertSnoozedPayload,
  "connector.created": connectorCreatedPayload,
  "connector.deleted": connectorDeletedPayload,
  "connector.errored": connectorErroredPayload,
  "connector.synced": connectorSyncedPayload,
  "insight.degraded": insightDegradedPayload,
  "insight.generated": insightGeneratedPayload,
  "insight.viewed": insightViewedPayload,
  "mcp.action": mcpActionPayload,
  "mcp.key_created": mcpKeyCreatedPayload,
  "mcp.key_revoked": mcpKeyRevokedPayload,
  "mcp.query": mcpQueryPayload,
  "task.completed": taskCompletedPayload,
  "task.created": taskCreatedPayload,
  "telegram.alert": telegramAlertPayload,
  "telegram.digest": telegramDigestPayload,
  "telegram.reaction": telegramReactionPayload,
  "webhook.delivered": webhookDeliveredPayload,
  "webhook.failed": webhookFailedPayload,
} as const satisfies Record<EventType, z.ZodType>;

// ---------------------------------------------------------------------------
// Discriminated union — each variant has eventType literal + typed payload
// ---------------------------------------------------------------------------

const eventEntry = <T extends EventType>(eventType: T) =>
  z.object({
    eventType: z.literal(eventType),
    payload: EVENT_PAYLOAD_SCHEMAS[eventType],
  });

export const eventLogEntrySchema = z.discriminatedUnion("eventType", [
  eventEntry("alert.fired"),
  eventEntry("alert.ack"),
  eventEntry("alert.snoozed"),
  eventEntry("alert.dismissed"),
  eventEntry("alert.resolved"),
  eventEntry("connector.synced"),
  eventEntry("connector.errored"),
  eventEntry("connector.created"),
  eventEntry("connector.deleted"),
  eventEntry("insight.degraded"),
  eventEntry("insight.generated"),
  eventEntry("insight.viewed"),
  eventEntry("telegram.digest"),
  eventEntry("telegram.alert"),
  eventEntry("telegram.reaction"),
  eventEntry("mcp.query"),
  eventEntry("mcp.action"),
  eventEntry("mcp.key_created"),
  eventEntry("mcp.key_revoked"),
  eventEntry("task.created"),
  eventEntry("task.completed"),
  eventEntry("webhook.delivered"),
  eventEntry("webhook.failed"),
]);

export type EventLogEntryInput = z.infer<typeof eventLogEntrySchema>;

// ---------------------------------------------------------------------------
// Summary interface — returned to the UI
// ---------------------------------------------------------------------------

export interface EventLogEntrySummary {
  actorId: string | null;
  actorType: ActorType;
  createdAt: string;
  eventType: EventType;
  id: string;
  payload: Record<string, unknown>;
  startupId: string | null;
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isEventType(value: string): value is EventType {
  return EVENT_TYPES.includes(value as EventType);
}

export function isActorType(value: string): value is ActorType {
  return ACTOR_TYPES.includes(value as ActorType);
}
