// Event log emitter — inserts audit trail entries into the event_log table.
// Direct insert, no batching or queuing. Fire-and-forget by design so callers
// can choose whether to await the write or let it settle in the background.

import type { ActorType, EventType } from "@shared/event-log";

import { eventLog } from "../../db/schema/event-log";

/** Minimal Drizzle-compatible DB interface for inserting event log entries. */
interface EventDb {
  insert: typeof insertSignature;
}

type InsertValues = typeof eventLog.$inferInsert;
interface InsertReturn {
  values: (v: InsertValues) => Promise<unknown>;
}
declare function insertSignature(table: typeof eventLog): InsertReturn;

export interface EmitEventParams {
  actorId?: string | null;
  actorType: ActorType;
  eventType: EventType;
  payload: Record<string, unknown>;
  startupId?: string | null;
  workspaceId: string;
}

/**
 * Insert a single event into the event_log table.
 * Callers may `await` for guaranteed delivery or fire-and-forget.
 */
export async function emit(
  db: EventDb,
  params: EmitEventParams
): Promise<void> {
  await db.insert(eventLog).values({
    workspaceId: params.workspaceId,
    startupId: params.startupId ?? null,
    eventType: params.eventType,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    payload: params.payload,
  });
}
