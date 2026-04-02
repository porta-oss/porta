import type { InternalTaskPayload, TaskSyncStatus } from '@shared/internal-task';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StartupTaskListProps {
  tasks: InternalTaskPayload[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry?: () => void;
}

// ---------------------------------------------------------------------------
// Sync badge
// ---------------------------------------------------------------------------

const SYNC_LABELS: Record<TaskSyncStatus, string> = {
  not_synced: 'Pending',
  queued: 'Queued',
  syncing: 'Syncing…',
  synced: 'Synced',
  failed: 'Failed',
};

const SYNC_COLORS: Record<TaskSyncStatus, { fg: string; bg: string }> = {
  not_synced: { fg: '#6b7280', bg: '#f3f4f6' },
  queued: { fg: '#2563eb', bg: '#dbeafe' },
  syncing: { fg: '#2563eb', bg: '#dbeafe' },
  synced: { fg: '#16a34a', bg: '#dcfce7' },
  failed: { fg: '#dc2626', bg: '#fef2f2' },
};

function TaskSyncBadge({ status }: { status: TaskSyncStatus }) {
  const colors = SYNC_COLORS[status] ?? SYNC_COLORS.not_synced;
  return (
    <span
      data-testid="task-sync-status"
      style={{
        display: 'inline-block',
        fontSize: '0.7rem',
        fontWeight: 500,
        padding: '0.15rem 0.45rem',
        borderRadius: '0.25rem',
        color: colors.fg,
        background: colors.bg,
      }}
    >
      {SYNC_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

function TaskRow({ task }: { task: InternalTaskPayload }) {
  return (
    <li
      data-testid="task-row"
      style={{
        display: 'grid',
        gap: '0.25rem',
        padding: '0.75rem 0',
        borderBottom: '1px solid #f3f4f6',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#111827' }}>
          {task.title}
        </span>
        <TaskSyncBadge status={task.syncStatus} />
      </div>
      <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>
        {task.description}
      </p>
      {task.linkedMetricKeys.length > 0 ? (
        <p style={{ margin: 0, fontSize: '0.7rem', color: '#9ca3af' }}>
          Linked metrics: {task.linkedMetricKeys.join(', ')}
        </p>
      ) : null}
      {task.linearIssueId ? (
        <p data-testid="task-linear-id" style={{ margin: 0, fontSize: '0.75rem', color: '#2563eb' }}>
          Linear: {task.linearIssueId}
        </p>
      ) : null}
      {task.lastSyncError ? (
        <p data-testid="task-sync-error" role="alert" style={{ margin: 0, fontSize: '0.75rem', color: '#dc2626' }}>
          Sync error: {task.lastSyncError}
        </p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StartupTaskList({ tasks, status, error, onRetry }: StartupTaskListProps) {
  // Don't render the section at all if idle and no tasks
  if (status === 'idle' && tasks.length === 0) return null;

  return (
    <section
      aria-label="startup tasks"
      data-testid="startup-task-list"
      style={{
        display: 'grid',
        gap: '0.5rem',
        padding: '1rem 1.25rem',
        border: '1px solid #e5e7eb',
        borderRadius: '0.75rem',
        background: '#ffffff',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280' }}>
        Tasks
      </p>

      {status === 'loading' ? (
        <p role="status" style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem' }}>
          Loading tasks…
        </p>
      ) : null}

      {status === 'error' ? (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <p role="alert" style={{ margin: 0, color: '#991b1b', fontSize: '0.85rem' }}>
            {error ?? 'Failed to load tasks.'}
          </p>
          {onRetry ? (
            <button type="button" onClick={onRetry} style={{ justifySelf: 'start', fontSize: '0.85rem' }}>
              Retry task load
            </button>
          ) : null}
        </div>
      ) : null}

      {(status === 'ready' || status === 'loading') && tasks.length === 0 && status !== 'loading' ? (
        <p data-testid="no-tasks" style={{ margin: 0, color: '#9ca3af', fontSize: '0.85rem' }}>
          No tasks yet. Create one from an insight action above.
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <ul data-testid="task-rows" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
