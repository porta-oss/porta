import type { InternalTaskPayload } from "@shared/internal-task";
import type {
  InsightAction,
  InsightExplanation,
  LatestInsightPayload,
} from "@shared/startup-insight";
import { INSIGHT_CONDITION_LABELS } from "@shared/startup-insight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import type { InsightDisplayStatus } from "./startup-insight-card-types";

export type { InsightDisplayStatus };

export interface StartupInsightCardProps {
  creatingActionIndex?: number | null;
  diagnosticMessage: string | null;
  displayStatus: InsightDisplayStatus;
  insight: LatestInsightPayload | null;
  onCreateTask?: (actionIndex: number) => void;
  onRetry?: () => void;
  taskCreateError?: string | null;
  tasks?: InternalTaskPayload[];
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value
  );
}

function EvidenceBullets({ insight }: { insight: LatestInsightPayload }) {
  const items = insight.evidence.items;
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="my-2 list-disc pl-5" data-testid="insight-evidence">
      {items.map((item) => {
        function directionColor(): string {
          if (item.direction === "down") {
            return "text-danger";
          }
          if (item.direction === "up") {
            return "text-success";
          }
          return "text-muted-foreground";
        }

        function directionArrow(): string {
          if (item.direction === "down") {
            return "\u2193";
          }
          if (item.direction === "up") {
            return "\u2191";
          }
          return "\u2192";
        }

        return (
          <li className="mb-1 text-sm" key={`${item.metricKey}-${item.label}`}>
            <strong>{item.label}:</strong>{" "}
            {formatMetricValue(item.currentValue)}
            {item.previousValue === null ? null : (
              <span className={directionColor()}>
                {" "}
                ({directionArrow()} from {formatMetricValue(item.previousValue)}
                )
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ExplanationSection({
  explanation,
}: {
  explanation: InsightExplanation;
}) {
  return (
    <div className="grid gap-3">
      <div data-testid="insight-observation">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">
          Observation
        </p>
        <p className="mt-1">{explanation.observation}</p>
      </div>
      <div data-testid="insight-hypothesis">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">
          Hypothesis
        </p>
        <p className="mt-1">{explanation.hypothesis}</p>
      </div>
    </div>
  );
}

function SyncStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    not_synced: "Not synced",
    queued: "Queued",
    syncing: "Syncing\u2026",
    synced: "Synced to Linear",
    failed: "Sync failed",
  };

  function variant(): "default" | "secondary" | "destructive" | "outline" {
    switch (status) {
      case "synced":
        return "default";
      case "queued":
      case "syncing":
        return "secondary";
      case "failed":
        return "destructive";
      default:
        return "outline";
    }
  }

  return (
    <Badge data-testid="task-sync-badge" variant={variant()}>
      {labels[status] ?? status}
    </Badge>
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
  const taskByActionIndex = new Map<number, InternalTaskPayload>();
  for (const t of tasks) {
    if (!sourceInsightId || t.sourceInsightId === sourceInsightId) {
      taskByActionIndex.set(t.sourceActionIndex, t);
    }
  }

  return (
    <div data-testid="insight-actions">
      <p className="mb-2 text-muted-foreground text-xs uppercase tracking-wider">
        Recommended Actions
      </p>
      <ol className="m-0 pl-5">
        {actions.map((action, i) => {
          const existingTask = taskByActionIndex.get(i);
          const isCreating = creatingActionIndex === i;

          return (
            <li className="mb-3" key={`action-${action.label}`}>
              <strong>{action.label}</strong>
              <p className="mt-0.5 text-muted-foreground text-sm">
                {action.rationale}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                {existingTask ? (
                  <>
                    <span
                      className="font-medium text-sm text-success"
                      data-testid={`action-${i}-task-created`}
                    >
                      \u2713 Task created
                    </span>
                    <SyncStatusBadge status={existingTask.syncStatus} />
                    {existingTask.linearIssueId ? (
                      <span
                        className="text-info text-xs"
                        data-testid={`action-${i}-linear-link`}
                      >
                        Linear: {existingTask.linearIssueId}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <Button
                    data-testid={`action-${i}-create-task`}
                    disabled={isCreating}
                    onClick={() => onCreateTask?.(i)}
                    size="sm"
                    variant="outline"
                  >
                    {isCreating ? "Creating\u2026" : "Create task"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {taskCreateError ? (
        <p
          className="mt-1 text-danger text-xs"
          data-testid="task-create-error"
          role="alert"
        >
          {taskCreateError}
        </p>
      ) : null}
    </div>
  );
}

function InsightShell({
  borderClass,
  children,
}: {
  borderClass: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      aria-label="startup insight"
      className={borderClass}
      data-testid="startup-insight-card"
    >
      <CardContent className="grid gap-3 pt-5">{children}</CardContent>
    </Card>
  );
}

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
  if (displayStatus === "unavailable") {
    return (
      <InsightShell borderClass="bg-muted">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">
          Insight
        </p>
        <p className="text-muted-foreground" data-testid="insight-unavailable">
          {diagnosticMessage ??
            "No insight yet. Insights appear after the first data sync."}
        </p>
      </InsightShell>
    );
  }

  if (displayStatus === "blocked") {
    return (
      <InsightShell borderClass="border-warning-border bg-warning-bg">
        <p className="text-warning text-xs uppercase tracking-wider">Insight</p>
        <p className="text-warning" data-testid="insight-blocked" role="status">
          {diagnosticMessage ??
            "Insights are paused until all connectors are healthy."}
        </p>
      </InsightShell>
    );
  }

  if (displayStatus === "error") {
    return (
      <InsightShell borderClass="border-danger-border bg-danger-bg">
        <p className="text-danger text-xs uppercase tracking-wider">Insight</p>
        <p className="text-danger" data-testid="insight-error" role="alert">
          {diagnosticMessage ??
            "Could not generate insight. Try again or check your connectors."}
        </p>
        {onRetry ? (
          <Button
            className="justify-self-start"
            onClick={onRetry}
            variant="outline"
          >
            Try again
          </Button>
        ) : null}
      </InsightShell>
    );
  }

  if (!insight?.explanation) {
    return (
      <InsightShell borderClass="bg-muted">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">
          Insight
        </p>
        <p className="text-muted-foreground" data-testid="insight-unavailable">
          No insight yet. Insights appear after the first data sync.
        </p>
      </InsightShell>
    );
  }

  const conditionLabel =
    INSIGHT_CONDITION_LABELS[insight.conditionCode] ?? insight.conditionCode;

  return (
    <InsightShell borderClass="border-info-border bg-info-bg">
      <div>
        <p className="text-info text-xs uppercase tracking-wider">Insight</p>
        <p
          className="mt-1 font-semibold text-info"
          data-testid="insight-condition"
        >
          {conditionLabel}
        </p>
      </div>

      <EvidenceBullets insight={insight} />
      <ExplanationSection explanation={insight.explanation} />

      <ActionList
        actions={insight.explanation.actions}
        creatingActionIndex={creatingActionIndex}
        onCreateTask={onCreateTask}
        taskCreateError={taskCreateError}
        tasks={tasks}
      />

      {diagnosticMessage ? (
        <p
          className="text-sm text-warning italic"
          data-testid="insight-diagnostic"
        >
          {diagnosticMessage}
        </p>
      ) : null}
    </InsightShell>
  );
}
