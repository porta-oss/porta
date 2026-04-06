// Event log query route handler.
// Returns paginated events for the active workspace with optional filters
// (startupId, eventTypes, date range) and cursor-based keyset pagination.

import type { EventLogEntrySummary } from "@shared/event-log";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventLogDb {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

export interface EventLogRuntime {
  db: { db: EventLogDb };
}

interface EventLogWorkspaceContext {
  workspace: { id: string };
}

interface ListEventsQuery {
  cursor?: string;
  eventTypes?: string;
  from?: string;
  limit?: string;
  startupId?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface CursorPayload {
  createdAt: string;
  id: string;
}

function decodeCursor(encoded: string): CursorPayload | null {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString("base64");
}

// ---------------------------------------------------------------------------
// Row type from DB
// ---------------------------------------------------------------------------

interface EventLogRow {
  actor_id: string | null;
  actor_type: string;
  created_at: string | Date;
  event_type: string;
  id: string;
  payload: Record<string, unknown>;
  startup_id: string | null;
  workspace_id: string;
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function serializeRow(row: EventLogRow): EventLogEntrySummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    startupId: row.startup_id,
    eventType: row.event_type as EventLogEntrySummary["eventType"],
    actorType: row.actor_type as EventLogEntrySummary["actorType"],
    actorId: row.actor_id,
    payload: row.payload,
    createdAt: toIsoString(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleListEvents(
  runtime: EventLogRuntime,
  ctx: EventLogWorkspaceContext,
  query: ListEventsQuery,
  set: { status?: number | string }
): Promise<unknown> {
  const workspaceId = ctx.workspace.id;

  // Parse and clamp limit
  const rawLimit = query.limit ? Number.parseInt(query.limit, 10) : 50;
  const limit =
    Number.isNaN(rawLimit) || rawLimit <= 0 ? 50 : Math.min(rawLimit, 200);

  // Decode cursor
  let cursor: CursorPayload | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) {
      set.status = 400;
      return {
        error: {
          code: "INVALID_CURSOR",
          message: "The pagination cursor is malformed.",
        },
      };
    }
  }

  // Parse eventTypes filter
  const eventTypes = query.eventTypes
    ? query.eventTypes
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : null;

  // Build dynamic WHERE clauses
  const conditions: ReturnType<typeof sql>[] = [
    sql`workspace_id = ${workspaceId}`,
  ];

  if (query.startupId) {
    conditions.push(sql`startup_id = ${query.startupId}`);
  }

  if (eventTypes && eventTypes.length > 0) {
    const list = eventTypes.map((et) => sql`${et}`);
    conditions.push(sql`event_type IN (${sql.join(list, sql`, `)})`);
  }

  if (query.from) {
    conditions.push(sql`created_at >= ${query.from}::timestamptz`);
  }

  if (query.to) {
    conditions.push(sql`created_at <= ${query.to}::timestamptz`);
  }

  if (cursor) {
    conditions.push(
      sql`(created_at < ${cursor.createdAt}::timestamptz OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}))`
    );
  }

  const whereClause = sql.join(conditions, sql` AND `);

  // Fetch limit + 1 to determine hasMore
  const fetchLimit = limit + 1;

  const result = await runtime.db.db.execute(
    sql`SELECT id, workspace_id, startup_id, event_type, actor_type, actor_id, payload, created_at
        FROM event_log
        WHERE ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ${fetchLimit}`
  );

  const rows = result.rows as EventLogRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const events = pageRows.map(serializeRow);

  const lastRow =
    hasMore && pageRows.length > 0 ? (pageRows.at(-1) ?? null) : null;
  const nextCursor = lastRow
    ? encodeCursor(toIsoString(lastRow.created_at), lastRow.id)
    : null;

  return {
    events,
    pagination: {
      cursor: nextCursor,
      hasMore,
      limit,
    },
  };
}

export type { EventLogWorkspaceContext };
