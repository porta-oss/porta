// Webhook configuration and payload contracts shared across API, worker, and UI.

import { z } from "zod";
import type { EventType } from "./event-log";
import { EVENT_TYPES } from "./event-log";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Webhook delivery payload sent to the subscriber endpoint. */
export const webhookPayloadSchema = z.object({
  deliveryId: z.uuid(),
  event: z.enum(EVENT_TYPES),
  payload: z.record(z.string(), z.unknown()),
  startupId: z.string(),
  timestamp: z.iso.datetime(),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/** Input schema for creating or updating a webhook configuration. */
export const webhookConfigInputSchema = z.object({
  enabled: z.boolean().optional().default(true),
  eventTypes: z.array(z.enum(EVENT_TYPES)).min(1),
  url: z.url().refine((u) => u.startsWith("https://"), "URL must use HTTPS"),
});

export type WebhookConfigInput = z.infer<typeof webhookConfigInputSchema>;

// ---------------------------------------------------------------------------
// Summary interface — returned to the UI
// ---------------------------------------------------------------------------

export interface WebhookConfigSummary {
  circuitBrokenAt: string | null;
  consecutiveFailures: number;
  enabled: boolean;
  eventTypes: EventType[];
  id: string;
  startupId: string;
  url: string;
}
