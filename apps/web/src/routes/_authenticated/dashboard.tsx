import { useEffect, useMemo, useState } from 'react';
import { createRoute } from '@tanstack/react-router';

import type { StartupRecord, WorkspaceSummary } from '@shared/types';

import { AppShell } from '../../components/app-shell';
import { API_BASE_URL, getErrorMessage, type AuthSnapshot } from '../../lib/auth-client';
import { authenticatedRoute } from '../_authenticated';

export interface DashboardApi {
  listWorkspaces: () => Promise<{ workspaces: WorkspaceSummary[]; activeWorkspaceId: string | null }>;
  setActiveWorkspace: (input: { workspaceId: string }) => Promise<{ activeWorkspaceId: string; workspace: WorkspaceSummary }>;
  listStartups: () => Promise<{ workspace: WorkspaceSummary; startups: StartupRecord[] }>;
}

export interface DashboardPageProps {
  authState: AuthSnapshot;
  api?: DashboardApi;
}

interface DashboardApiErrorShape {
  code: string;
  message: string;
}

class DashboardApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DashboardApiError';
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWorkspaceSummary(value: unknown): value is WorkspaceSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.slug === 'string';
}

function isStartupRecord(value: unknown): value is StartupRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.stage === 'string' &&
    typeof value.timezone === 'string' &&
    typeof value.currency === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new DashboardApiError('REQUEST_TIMEOUT', 'The dashboard shell timed out while loading. Retry the bootstrap.')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function requestJson(path: string, init?: RequestInit) {
  const normalizedPath = path.replace(/^\//, '');
  const response = await withTimeout(
    fetch(new URL(normalizedPath, `${API_BASE_URL}/`).toString(), {
      ...init,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {})
      }
    }),
    REQUEST_TIMEOUT_MS
  );

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    throw new DashboardApiError('MALFORMED_RESPONSE', 'The dashboard shell received a malformed response. Retry the bootstrap.');
  }

  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error)
      ? ({
          code: typeof payload.error.code === 'string' ? payload.error.code : `HTTP_${response.status}`,
          message:
            typeof payload.error.message === 'string'
              ? payload.error.message
              : 'The dashboard shell request could not be completed.'
        } satisfies DashboardApiErrorShape)
      : {
          code: `HTTP_${response.status}`,
          message: 'The dashboard shell request could not be completed.'
        };

    throw new DashboardApiError(error.code, error.message);
  }

  return payload;
}

function createDefaultDashboardApi(): DashboardApi {
  return {
    async listWorkspaces() {
      const payload = await requestJson('/workspaces');

      if (!isRecord(payload) || !Array.isArray(payload.workspaces) || !payload.workspaces.every(isWorkspaceSummary)) {
        throw new DashboardApiError('MALFORMED_WORKSPACE_CONTEXT', 'The dashboard shell could not parse the workspace context.');
      }

      return {
        workspaces: payload.workspaces,
        activeWorkspaceId: typeof payload.activeWorkspaceId === 'string' ? payload.activeWorkspaceId : null
      };
    },
    async setActiveWorkspace(input) {
      const payload = await requestJson('/workspaces/active', {
        method: 'POST',
        body: JSON.stringify(input)
      });

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || typeof payload.activeWorkspaceId !== 'string') {
        throw new DashboardApiError('MALFORMED_WORKSPACE_SWITCH', 'Workspace selection returned an unexpected shell payload.');
      }

      return {
        activeWorkspaceId: payload.activeWorkspaceId,
        workspace: payload.workspace
      };
    },
    async listStartups() {
      const payload = await requestJson('/startups');

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || !Array.isArray(payload.startups) || !payload.startups.every(isStartupRecord)) {
        throw new DashboardApiError('MALFORMED_STARTUP_LIST', 'The dashboard shell could not parse the startup list.');
      }

      return {
        workspace: payload.workspace,
        startups: payload.startups
      };
    }
  };
}

function getDashboardErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DashboardApiError) {
    return error.message;
  }

  return getErrorMessage(error, fallback);
}

export const dashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'app',
  component: DashboardRouteComponent
});

function DashboardRouteComponent() {
  const authState = dashboardRoute.useRouteContext({
    select: (context) => context.authState as AuthSnapshot
  });

  return <DashboardPage authState={authState} />;
}

export function DashboardPage({ authState, api = createDefaultDashboardApi() }: DashboardPageProps) {
  const [shellStatus, setShellStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [startupStatus, setStartupStatus] = useState<'idle' | 'loading' | 'refreshing' | 'ready' | 'error'>('idle');
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(authState.session?.session.activeOrganizationId ?? null);
  const [startups, setStartups] = useState<StartupRecord[]>([]);
  const [shellError, setShellError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces]
  );

  async function refreshStartups(workspaceId: string | null, mode: 'loading' | 'refreshing' = 'loading') {
    setStartupError(null);

    if (!workspaceId) {
      setStartups([]);
      setStartupStatus('ready');
      return;
    }

    setStartupStatus(mode);

    try {
      const startupState = await api.listStartups();

      if (startupState.workspace.id !== workspaceId) {
        throw new DashboardApiError('WORKSPACE_SCOPE_MISMATCH', 'The dashboard shell received startup data for the wrong workspace.');
      }

      setStartups(startupState.startups);
      setStartupStatus('ready');
    } catch (error) {
      setStartups([]);
      setStartupError(getDashboardErrorMessage(error, 'Startup navigation failed to load. Retry from the shell.'));
      setStartupStatus('error');
    }
  }

  async function refreshShell() {
    setShellStatus('loading');
    setShellError(null);
    setWorkspaceError(null);

    try {
      const workspaceState = await api.listWorkspaces();
      setWorkspaces(workspaceState.workspaces);
      setActiveWorkspaceId(workspaceState.activeWorkspaceId);
      setShellStatus('ready');
      await refreshStartups(workspaceState.activeWorkspaceId, 'loading');
    } catch (error) {
      setShellError(getDashboardErrorMessage(error, 'The dashboard shell could not be bootstrapped. Retry the workspace lookup.'));
      setStartupStatus('idle');
      setShellStatus('error');
    }
  }

  useEffect(() => {
    void refreshShell();
  }, []);

  async function handleActivateWorkspace(workspaceId: string) {
    setWorkspaceError(null);
    setIsSwitchingWorkspace(true);

    try {
      const response = await api.setActiveWorkspace({ workspaceId });
      setActiveWorkspaceId(response.activeWorkspaceId);
      await refreshStartups(response.activeWorkspaceId, 'loading');
    } catch (error) {
      setWorkspaceError(getDashboardErrorMessage(error, 'Workspace switching failed. Retry from the shell.'));
    } finally {
      setIsSwitchingWorkspace(false);
    }
  }

  return (
    <AppShell
      user={{
        email: authState.session?.user.email ?? 'founder@example.com',
        name: authState.session?.user.name ?? null
      }}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      startups={startups}
      shellStatus={shellStatus}
      startupStatus={startupStatus}
      shellError={shellError}
      workspaceError={workspaceError}
      startupError={startupError}
      isSwitchingWorkspace={isSwitchingWorkspace}
      onRetryShell={refreshShell}
      onRetryStartups={() => refreshStartups(activeWorkspaceId, 'refreshing')}
      onActivateWorkspace={handleActivateWorkspace}
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div>
          <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280' }}>
            Dashboard frame
          </p>
          <h2 style={{ margin: '0.35rem 0 0' }}>Founder operating surface</h2>
        </div>

        <p style={{ margin: 0, color: '#4b5563' }}>
          {activeWorkspace
            ? `Workspace ${activeWorkspace.name} is mounted inside the authenticated shell.`
            : 'No workspace is active yet, so the dashboard shell is waiting for onboarding to establish tenancy.'}
        </p>

        {activeWorkspace && startups.length > 0 ? (
          <>
            <p style={{ margin: 0 }}>
              Primary startup: <strong>{startups[0]?.name}</strong>
            </p>
            <p style={{ margin: 0, color: '#4b5563' }}>
              The shell proves the slice end state by showing authenticated founder identity, active workspace tenancy, and startup data in one frame.
            </p>
          </>
        ) : null}

        {activeWorkspace && startups.length === 0 && startupStatus === 'ready' ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ margin: 0 }}>This workspace has no startups yet, so the shell stays intact and points back to onboarding.</p>
            <a href="/app/onboarding">Complete onboarding</a>
          </div>
        ) : null}

        {!activeWorkspace && shellStatus === 'ready' ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ margin: 0 }}>Create or select a workspace before the dashboard can load scoped product data.</p>
            <a href="/app/onboarding">Open workspace onboarding</a>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
