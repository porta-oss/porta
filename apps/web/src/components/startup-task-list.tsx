import type {
  InternalTaskPayload,
  TaskSyncStatus,
} from "@shared/internal-task";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface StartupTaskListProps {
  error: string | null;
  onRetry?: () => void;
  status: "idle" | "loading" | "ready" | "error";
  tasks: InternalTaskPayload[];
}

const SYNC_LABELS: Record<TaskSyncStatus, string> = {
  not_synced: "Pending",
  queued: "Queued",
  syncing: "Syncing\u2026",
  synced: "Synced",
  failed: "Failed",
};

function syncBadgeVariant(
  status: TaskSyncStatus
): "default" | "secondary" | "destructive" | "outline" {
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

function TaskSyncBadge({ status }: { status: TaskSyncStatus }) {
  return (
    <Badge data-testid="task-sync-status" variant={syncBadgeVariant(status)}>
      {SYNC_LABELS[status] ?? status}
    </Badge>
  );
}

function TaskRow({ task }: { task: InternalTaskPayload }) {
  return (
    <li
      className="grid gap-1 border-muted border-b py-3"
      data-testid="task-row"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{task.title}</span>
        <TaskSyncBadge status={task.syncStatus} />
      </div>
      <p className="text-muted-foreground text-sm">{task.description}</p>
      {task.linkedMetricKeys.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Linked metrics: {task.linkedMetricKeys.join(", ")}
        </p>
      ) : null}
      {task.linearIssueId ? (
        <p className="text-info text-xs" data-testid="task-linear-id">
          Linear: {task.linearIssueId}
        </p>
      ) : null}
      {task.lastSyncError ? (
        <p
          className="text-danger text-xs"
          data-testid="task-sync-error"
          role="alert"
        >
          Sync error: {task.lastSyncError}
        </p>
      ) : null}
    </li>
  );
}

export function StartupTaskList({
  tasks,
  status,
  error,
  onRetry,
}: StartupTaskListProps) {
  if (status === "idle" && tasks.length === 0) {
    return null;
  }

  return (
    <Card aria-label="startup tasks" data-testid="startup-task-list">
      <CardContent className="grid gap-2 pt-4">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">
          Tasks
        </p>

        {status === "loading" ? (
          <p className="text-muted-foreground text-sm" role="status">
            Loading tasks\u2026
          </p>
        ) : null}

        {status === "error" ? (
          <div className="grid gap-1.5">
            <Alert variant="destructive">
              <AlertDescription>
                {error ?? "Failed to load tasks."}
              </AlertDescription>
            </Alert>
            {onRetry ? (
              <Button onClick={onRetry} size="sm" variant="outline">
                Retry task load
              </Button>
            ) : null}
          </div>
        ) : null}

        {(status === "ready" || status === "loading") &&
        tasks.length === 0 &&
        status !== "loading" ? (
          <p className="text-muted-foreground text-sm" data-testid="no-tasks">
            No tasks yet. Create one from an insight action above.
          </p>
        ) : null}

        {tasks.length > 0 ? (
          <ul className="m-0 list-none p-0" data-testid="task-rows">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
