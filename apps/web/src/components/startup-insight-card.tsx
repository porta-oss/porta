import type { InternalTaskPayload } from "@shared/internal-task";
import type {
  InsightAction,
  InsightExplanation,
  LatestInsightPayload,
} from "@shared/startup-insight";
import { INSIGHT_CONDITION_LABELS } from "@shared/startup-insight";

import type { InsightDisplayStatus } from "./startup-insight-card-types";

// Re-export the display status for use by the dashboard
export type { InsightDisplayStatus };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StartupInsightCardProps {
  /** Index of the action currently being converted (loading state). */
  creatingActionIndex?: number | null;
  diagnosticMessage: string | null;
  displayStatus: InsightDisplayStatus;
  insight: LatestInsightPayload | null;
  /** Called when the founder clicks "Create task" on an action. */
  onCreateTask?: (actionIndex: number) => void;
  onRetry?: () => void;
  /** Error from the most recent create-task attempt. */
  taskCreateError?: string | null;
  /** Tasks already created from actions — used to show idempotent state. */
  tasks?: InternalTaskPayload[];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EvidenceBullets({ insight }: { insight: LatestInsightPayload }) {
  const items = insight.evidence.items;
  if (items.length === 0) {
    return null;
  }

  return (
    <ul
      data-testid="insight-evidence"
      style={{
        margin: "0.5rem 0",
        paddingLeft: "1.25rem",
        listStyleType: "disc",
      }}
    >
      {items.map((item, i) => (
        <li
          key={`${item.metricKey}-${i}`}
          style={{
            fontSize: "0.85rem",
            color: "#374151",
            marginBottom: "0.25rem",
          }}
        >
          <strong>{item.label}:</strong> {formatMetricValue(item.currentValue)}
          {item.previousValue === null ? null : (
            <span
              style={{
                color:
                  item.direction === "down"
                    ? "#dc2626"
                    : item.direction === "up"
                      ? "#16a34a"
                      : "#6b7280",
              }}
            >
              {" "}
              (
              {item.direction === "down"
                ? "↓"
                : item.direction === "up"
                  ? "↑"
                  : "→"}{" "}
              from {formatMetricValue(item.previousValue)})
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ExplanationSection({
  explanation,
}: {
  explanation: InsightExplanation;
}) {
  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div data-testid="insight-observation">
        <p
          style={{
            margin: 0,
            fontSize: "0.7rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          Observation
        </p>
        <p
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.9rem",
            color: "#111827",
          }}
        >
          {explanation.observation}
        </p>
      </div>
      <div data-testid="insight-hypothesis">
        <p
          style={{
            margin: 0,
            fontSize: "0.7rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          Hypothesis
        </p>
        <p
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.9rem",
            color: "#111827",
          }}
        >
          {explanation.hypothesis}
        </p>
      </div>
    </div>
  );
}

function SyncStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    not_synced: "Not synced",
    queued: "Queued",
    syncing: "Syncing…",
    synced: "Synced to Linear",
    failed: "Sync failed",
  };
  const colors: Record<string, string> = {
    not_synced: "#6b7280",
    queued: "#2563eb",
    syncing: "#2563eb",
    synced: "#16a34a",
    failed: "#dc2626",
  };
  const bgColors: Record<string, string> = {
    not_synced: "#f3f4f6",
    queued: "#dbeafe",
    syncing: "#dbeafe",
    synced: "#dcfce7",
    failed: "#fef2f2",
  };

  return (
    <span
      data-testid="task-sync-badge"
      style={{
        display: "inline-block",
        fontSize: "0.7rem",
        fontWeight: 500,
        padding: "0.1rem 0.4rem",
        borderRadius: "0.25rem",
        color: colors[status] ?? "#6b7280",
        background: bgColors[status] ?? "#f3f4f6",
      }}
    >
      {labels[status] ?? status}
    </span>
  );
}

interface ActionListProps {
  actions: InsightAction[];
  creatingActionIndex?: number | null;
  onCreateTask?: (actionIndex: number) => void;
  sourceInsightId?: string;
  taskCreateError?: string | null;
  tasks?: InternalTaskPayload[];
}

function ActionList({
  actions,
  tasks = [],
  creatingActionIndex = null,
  taskCreateError = null,
  onCreateTask,
  sourceInsightId,
}: ActionListProps) {
  // Build a lookup: actionIndex → task (if already created from this insight)
  const taskByActionIndex = new Map<number, InternalTaskPayload>();
  for (const t of tasks) {
    if (!sourceInsightId || t.sourceInsightId === sourceInsightId) {
      taskByActionIndex.set(t.sourceActionIndex, t);
    }
  }

  return (
    <div data-testid="insight-actions">
      <p
        style={{
          margin: "0 0 0.5rem",
          fontSize: "0.7rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#6b7280",
        }}
      >
        Recommended Actions
      </p>
      <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>
        {actions.map((action, i) => {
          const existingTask = taskByActionIndex.get(i);
          const isCreating = creatingActionIndex === i;

          return (
            <li key={`action-${i}`} style={{ marginBottom: "0.75rem" }}>
              <strong style={{ fontSize: "0.9rem", color: "#111827" }}>
                {action.label}
              </strong>
              <p
                style={{
                  margin: "0.15rem 0 0",
                  fontSize: "0.8rem",
                  color: "#6b7280",
                }}
              >
                {action.rationale}
              </p>
              <div
                style={{
                  marginTop: "0.35rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                {existingTask ? (
                  <>
                    <span
                      data-testid={`action-${i}-task-created`}
                      style={{
                        fontSize: "0.8rem",
                        color: "#16a34a",
                        fontWeight: 500,
                      }}
                    >
                      ✓ Task created
                    </span>
                    <SyncStatusBadge status={existingTask.syncStatus} />
                    {existingTask.linearIssueId ? (
                      <span
                        data-testid={`action-${i}-linear-link`}
                        style={{ fontSize: "0.75rem", color: "#2563eb" }}
                      >
                        Linear: {existingTask.linearIssueId}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <button
                    data-testid={`action-${i}-create-task`}
                    disabled={isCreating}
                    onClick={() => onCreateTask?.(i)}
                    style={{
                      fontSize: "0.8rem",
                      padding: "0.25rem 0.6rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #d1d5db",
                      background: isCreating ? "#f3f4f6" : "#ffffff",
                      color: isCreating ? "#9ca3af" : "#374151",
                      cursor: isCreating ? "not-allowed" : "pointer",
                    }}
                    type="button"
                  >
                    {isCreating ? "Creating…" : "Create task"}
                  </button>
                )}
              </div>
              {/* Show create error for this specific action */}
            </li>
          );
        })}
      </ol>
      {taskCreateError ? (
        <p
          data-testid="task-create-error"
          role="alert"
          style={{
            margin: "0.25rem 0 0",
            fontSize: "0.75rem",
            color: "#dc2626",
          }}
        >
          {taskCreateError}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StartupInsightCard({
  insight,
  displayStatus,
  diagnosticMessage,
  onRetry,
  tasks = [],
  creatingActionIndex = null,
  taskCreateError = null,
  onCreateTask,
}: StartupInsightCardProps) {
  // Unavailable: no insight generated yet
  if (displayStatus === "unavailable") {
    return (
      <section
        aria-label="startup insight"
        data-testid="startup-insight-card"
        style={{
          display: "grid",
          gap: "0.75rem",
          padding: "1.25rem",
          border: "1px solid #e5e7eb",
          borderRadius: "1rem",
          background: "#f9fafb",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          Grounded Insight
        </p>
        <p
          data-testid="insight-unavailable"
          style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}
        >
          {diagnosticMessage ?? "No insight available yet."}
        </p>
      </section>
    );
  }

  // Blocked: connectors not healthy or data stale
  if (displayStatus === "blocked") {
    return (
      <section
        aria-label="startup insight"
        data-testid="startup-insight-card"
        style={{
          display: "grid",
          gap: "0.75rem",
          padding: "1.25rem",
          border: "1px solid #fde68a",
          borderRadius: "1rem",
          background: "#fffbeb",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#92400e",
          }}
        >
          Grounded Insight — Blocked
        </p>
        <p
          data-testid="insight-blocked"
          role="status"
          style={{ margin: 0, color: "#92400e", fontSize: "0.9rem" }}
        >
          {diagnosticMessage ?? "Insight generation is currently blocked."}
        </p>
      </section>
    );
  }

  // Error: generation failed and no last-good insight
  if (displayStatus === "error") {
    return (
      <section
        aria-label="startup insight"
        data-testid="startup-insight-card"
        style={{
          display: "grid",
          gap: "0.75rem",
          padding: "1.25rem",
          border: "1px solid #fecaca",
          borderRadius: "1rem",
          background: "#fef2f2",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#991b1b",
          }}
        >
          Grounded Insight — Error
        </p>
        <p
          data-testid="insight-error"
          role="alert"
          style={{ margin: 0, color: "#991b1b", fontSize: "0.9rem" }}
        >
          {diagnosticMessage ?? "Failed to generate insight."}
        </p>
        {onRetry ? (
          <button
            onClick={onRetry}
            style={{ justifySelf: "start" }}
            type="button"
          >
            Retry insight load
          </button>
        ) : null}
      </section>
    );
  }

  // Ready: show the full insight card
  if (!insight?.explanation) {
    // Defensive: displayStatus=ready but no explanation — treat as unavailable
    return (
      <section
        aria-label="startup insight"
        data-testid="startup-insight-card"
        style={{
          display: "grid",
          gap: "0.75rem",
          padding: "1.25rem",
          border: "1px solid #e5e7eb",
          borderRadius: "1rem",
          background: "#f9fafb",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6b7280",
          }}
        >
          Grounded Insight
        </p>
        <p
          data-testid="insight-unavailable"
          style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}
        >
          No insight available yet.
        </p>
      </section>
    );
  }

  const conditionLabel =
    INSIGHT_CONDITION_LABELS[insight.conditionCode] ?? insight.conditionCode;

  return (
    <section
      aria-label="startup insight"
      data-testid="startup-insight-card"
      style={{
        display: "grid",
        gap: "1rem",
        padding: "1.25rem",
        border: "1px solid #dbeafe",
        borderRadius: "1rem",
        background: "#eff6ff",
      }}
    >
      {/* Header */}
      <div>
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#1d4ed8",
          }}
        >
          Grounded Insight
        </p>
        <p
          data-testid="insight-condition"
          style={{
            margin: "0.25rem 0 0",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#1e3a5f",
          }}
        >
          {conditionLabel}
        </p>
      </div>

      {/* Evidence */}
      <EvidenceBullets insight={insight} />

      {/* Observation + Hypothesis */}
      <ExplanationSection explanation={insight.explanation} />

      {/* Actions */}
      <ActionList
        actions={insight.explanation.actions}
        creatingActionIndex={creatingActionIndex}
        onCreateTask={onCreateTask}
        taskCreateError={taskCreateError}
        tasks={tasks}
      />

      {/* Diagnostic message for stale-but-showing-last-good */}
      {diagnosticMessage ? (
        <p
          data-testid="insight-diagnostic"
          style={{
            margin: 0,
            fontSize: "0.8rem",
            color: "#92400e",
            fontStyle: "italic",
          }}
        >
          {diagnosticMessage}
        </p>
      ) : null}
    </section>
  );
}
