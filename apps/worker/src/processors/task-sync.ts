// Task-sync processor — creates Linear issues from internal tasks.
//
// Lifecycle per job:
//   1. Load internal task by ID
//   2. Validate task exists and is not already synced
//   3. Mark task as syncing
//   4. Create Linear issue via GraphQL API
//   5a. On success → store issue reference, mark synced
//   5b. On failure → record error, mark failed (retryable errors throw for BullMQ retry)
//
// Never stores or logs Linear API keys, auth tokens, or full response bodies.
// Never marks a task synced before a valid external issue reference is stored.

import type { Job } from "bullmq";

import type { InternalTaskRepository, InternalTaskRow } from "../repository";

/** Reference-only payload — only the task ID. */
export interface TaskSyncJobPayload {
  taskId: string;
}

/** Result from the Linear issue creation call. */
export interface LinearIssueResult {
  error?: string;
  issueId?: string;
  issueUrl?: string;
  retryable?: boolean;
  success: boolean;
}

/** Function that creates a Linear issue from task data. */
export type LinearCreateIssueFn = (
  task: InternalTaskRow,
  teamId: string
) => Promise<LinearIssueResult>;

export interface TaskSyncProcessorDeps {
  createLinearIssue: LinearCreateIssueFn;
  linearTeamId: string;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  taskRepo: InternalTaskRepository;
}

function getLinearHttpError(status: number): LinearIssueResult | null {
  if (status === 401) {
    return {
      success: false,
      error: "Linear API authentication failed (401). Check LINEAR_API_KEY.",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      success: false,
      error: "Linear API rate limit exceeded (429). Retry later.",
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      success: false,
      error: `Linear API server error (${status}).`,
      retryable: true,
    };
  }

  return null;
}

function parseLinearIssueResponse(body: unknown): LinearIssueResult {
  const payload = body as {
    data?: {
      issueCreate?: {
        success?: boolean;
        issue?: { id?: string; url?: string };
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors && payload.errors.length > 0) {
    const messages = payload.errors
      .map((error) => error.message ?? "unknown")
      .join("; ");
    return {
      success: false,
      error: `Linear GraphQL errors: ${messages}`,
      retryable: false,
    };
  }

  const issueCreate = payload.data?.issueCreate;
  if (
    !(issueCreate?.success && issueCreate.issue?.id && issueCreate.issue?.url)
  ) {
    return {
      success: false,
      error: "Linear issue creation response missing issue id/url.",
      retryable: false,
    };
  }

  return {
    success: true,
    issueId: issueCreate.issue.id,
    issueUrl: issueCreate.issue.url,
  };
}

/**
 * Create a Linear issue via the GraphQL API.
 * Returns a structured result — never throws for API errors.
 */
export function createLinearIssueClient(apiKey: string): LinearCreateIssueFn {
  return async function createIssue(
    task: InternalTaskRow,
    teamId: string
  ): Promise<LinearIssueResult> {
    const description = [
      task.description,
      "",
      "---",
      "Source: Internal task from insight action",
      `Startup: ${task.startupId}`,
      task.linkedMetricKeys.length > 0
        ? `Linked metrics: ${task.linkedMetricKeys.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const mutation = `
      mutation CreateIssue($teamId: String!, $title: String!, $description: String) {
        issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
          success
          issue {
            id
            url
          }
        }
      }
    `;

    const variables = {
      teamId,
      title: task.title,
      description,
    };

    let response: Response;
    try {
      response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify({ query: mutation, variables }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Network error or timeout
      return {
        success: false,
        error: `Linear API request failed: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
      };
    }

    const httpError = getLinearHttpError(response.status);
    if (httpError) {
      return httpError;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        success: false,
        error: "Linear API returned malformed JSON response.",
        retryable: false,
      };
    }

    return parseLinearIssueResponse(body);
  };
}

function getTaskSyncDurationMs(startedAt: Date, completedAt: Date): number {
  return completedAt.getTime() - startedAt.getTime();
}

async function handleTaskSyncFailure(
  deps: TaskSyncProcessorDeps,
  taskId: string,
  attemptAt: Date,
  error: string
) {
  await deps.taskRepo.markTaskSyncFailed({
    taskId,
    error,
    attemptAt,
  });
}

async function syncTaskToLinear(
  deps: TaskSyncProcessorDeps,
  taskId: string,
  task: InternalTaskRow,
  logCtx: Record<string, unknown>
): Promise<void> {
  const attemptAt = new Date();
  await deps.taskRepo.markTaskSyncing(taskId, attemptAt);

  const result = await deps.createLinearIssue(task, deps.linearTeamId);

  if (result.success && result.issueId && result.issueUrl) {
    const syncedAt = new Date();
    await deps.taskRepo.markTaskSynced({
      taskId,
      linearIssueId: result.issueId,
      linearIssueUrl: result.issueUrl,
      syncedAt,
    });

    deps.log.info("task synced to Linear", {
      ...logCtx,
      linearIssueId: result.issueId,
      durationMs: getTaskSyncDurationMs(attemptAt, syncedAt),
    });
    return;
  }

  const failedAt = new Date();
  const error = result.error ?? "Unknown Linear API error";

  await handleTaskSyncFailure(deps, taskId, failedAt, error);

  const failureLog = {
    ...logCtx,
    error,
    durationMs: getTaskSyncDurationMs(attemptAt, failedAt),
  };

  if (result.retryable) {
    deps.log.warn("task sync failed (retryable)", failureLog);
    throw new Error(error);
  }

  deps.log.error("task sync failed (non-retryable)", failureLog);
}

/**
 * Create a deterministic founder-proof Linear issue client.
 * Returns a stable external reference shape without calling the Linear API.
 * Preserves the same contract as the real client so the task-sync processor
 * writes synced status and a valid issue reference to the DB.
 */
export function createFounderProofLinearClient(): LinearCreateIssueFn {
  return async function createFounderProofIssue(
    task: InternalTaskRow,
    _teamId: string
  ): Promise<LinearIssueResult> {
    // Deterministic ID derived from task ID for idempotency
    const issueId = `FP-${task.id}`;
    const issueUrl = `https://linear.app/founder-proof/issue/${issueId}`;

    return {
      success: true,
      issueId,
      issueUrl,
    };
  };
}

/**
 * Create a BullMQ-compatible processor function for task-sync jobs.
 */
export function createTaskSyncProcessor(deps: TaskSyncProcessorDeps) {
  return async function processTaskSyncJob(
    job: Job<TaskSyncJobPayload>
  ): Promise<void> {
    const { taskId } = job.data;
    const attempt = job.attemptsMade + 1;

    const logCtx = {
      taskId,
      attempt,
      bullmqJobId: job.id,
    };

    // Validate payload
    if (!taskId) {
      deps.log.error("task sync job missing taskId — dropping", logCtx);
      return; // Non-retryable: don't throw, BullMQ marks as completed
    }

    deps.log.info("task sync job started", logCtx);

    // 1. Load task
    const task = await deps.taskRepo.findTask(taskId);

    if (!task) {
      deps.log.error("task not found — may have been deleted", logCtx);
      return; // Non-retryable
    }

    // 2. Idempotent check — if already synced, skip
    if (task.syncStatus === "synced" && task.linearIssueId) {
      deps.log.info("task already synced — skipping", {
        ...logCtx,
        linearIssueId: task.linearIssueId,
      });
      return;
    }

    await syncTaskToLinear(deps, taskId, task, logCtx);
  };
}
