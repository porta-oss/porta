import { useEffect, useMemo, useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';

import { DEFAULT_STARTUP_DRAFT, type StartupDraft, type StartupRecord, type WorkspaceSummary } from '@shared/types';

import { StartupForm } from '../../components/startup-form';
import { API_BASE_URL, getErrorMessage } from '../../lib/auth-client';
import { authenticatedRoute } from '../_authenticated';

export interface OnboardingApi {
  listWorkspaces: () => Promise<{ workspaces: WorkspaceSummary[]; activeWorkspaceId: string | null }>;
  createWorkspace: (input: { name: string }) => Promise<{ workspace: WorkspaceSummary; activeWorkspaceId: string }>;
  setActiveWorkspace: (input: { workspaceId: string }) => Promise<{ activeWorkspaceId: string; workspace: WorkspaceSummary }>;
  listStartups: () => Promise<{ workspace: WorkspaceSummary; startups: StartupRecord[] }>;
  createStartup: (input: StartupDraft) => Promise<{ workspace: WorkspaceSummary; startup: StartupRecord; startups: StartupRecord[] }>;
}

export interface OnboardingPageProps {
  api?: OnboardingApi;
  navigateTo?: (to: '/app') => void;
}

interface OnboardingApiErrorShape {
  code: string;
  message: string;
}

interface BootstrapState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  startups: StartupRecord[];
}

const REQUEST_TIMEOUT_MS = 4000;

const EMPTY_BOOTSTRAP: BootstrapState = {
  workspaces: [],
  activeWorkspaceId: null,
  startups: []
};

export const onboardingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'app/onboarding',
  component: OnboardingRouteComponent
});

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

class OnboardingApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OnboardingApiError';
    this.code = code;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new OnboardingApiError('REQUEST_TIMEOUT', 'The request took too long. Retry without re-entering your work.')), timeoutMs);
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
    throw new OnboardingApiError('MALFORMED_RESPONSE', 'The server returned an unexpected response. Retry the onboarding step.');
  }

  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error)
      ? ({
          code: typeof payload.error.code === 'string' ? payload.error.code : `HTTP_${response.status}`,
          message:
            typeof payload.error.message === 'string'
              ? payload.error.message
              : 'The onboarding request could not be completed.'
        } satisfies OnboardingApiErrorShape)
      : {
          code: `HTTP_${response.status}`,
          message: 'The onboarding request could not be completed.'
        };

    throw new OnboardingApiError(error.code, error.message);
  }

  return payload;
}

function createDefaultOnboardingApi(): OnboardingApi {
  return {
    async listWorkspaces() {
      const payload = await requestJson('/workspaces');

      if (!isRecord(payload) || !Array.isArray(payload.workspaces) || !payload.workspaces.every(isWorkspaceSummary)) {
        throw new OnboardingApiError('MALFORMED_WORKSPACE_CONTEXT', 'The workspace context was malformed. Retry or return to workspace setup.');
      }

      return {
        workspaces: payload.workspaces,
        activeWorkspaceId: typeof payload.activeWorkspaceId === 'string' ? payload.activeWorkspaceId : null
      };
    },
    async createWorkspace(input) {
      const payload = await requestJson('/workspaces', {
        method: 'POST',
        body: JSON.stringify(input)
      });

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || typeof payload.activeWorkspaceId !== 'string') {
        throw new OnboardingApiError('MALFORMED_WORKSPACE_CREATE', 'Workspace creation returned an unexpected response. Retry the setup step.');
      }

      return {
        workspace: payload.workspace,
        activeWorkspaceId: payload.activeWorkspaceId
      };
    },
    async setActiveWorkspace(input) {
      const payload = await requestJson('/workspaces/active', {
        method: 'POST',
        body: JSON.stringify(input)
      });

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || typeof payload.activeWorkspaceId !== 'string') {
        throw new OnboardingApiError('MALFORMED_WORKSPACE_SWITCH', 'Workspace selection returned an unexpected response. Retry the setup step.');
      }

      return {
        workspace: payload.workspace,
        activeWorkspaceId: payload.activeWorkspaceId
      };
    },
    async listStartups() {
      const payload = await requestJson('/startups');

      if (!isRecord(payload) || !isWorkspaceSummary(payload.workspace) || !Array.isArray(payload.startups) || !payload.startups.every(isStartupRecord)) {
        throw new OnboardingApiError('MALFORMED_STARTUP_LIST', 'The startup list was malformed. Retry the onboarding step.');
      }

      return {
        workspace: payload.workspace,
        startups: payload.startups
      };
    },
    async createStartup(input) {
      const payload = await requestJson('/startups', {
        method: 'POST',
        body: JSON.stringify(input)
      });

      if (
        !isRecord(payload) ||
        !isWorkspaceSummary(payload.workspace) ||
        !isStartupRecord(payload.startup) ||
        !Array.isArray(payload.startups) ||
        !payload.startups.every(isStartupRecord)
      ) {
        throw new OnboardingApiError('MALFORMED_STARTUP_CREATE', 'Startup creation returned an unexpected response. Retry the onboarding step.');
      }

      return {
        workspace: payload.workspace,
        startup: payload.startup,
        startups: payload.startups
      };
    }
  };
}

function getOnboardingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof OnboardingApiError) {
    return error.message;
  }

  return getErrorMessage(error, fallback);
}

function OnboardingRouteComponent() {
  const navigate = useNavigate();

  return (
    <OnboardingPage
      navigateTo={(to) => {
        void navigate({ to });
      }}
    />
  );
}

export function OnboardingPage({ api = createDefaultOnboardingApi(), navigateTo }: OnboardingPageProps) {
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>(EMPTY_BOOTSTRAP);
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [startupDraft, setStartupDraft] = useState<StartupDraft>(DEFAULT_STARTUP_DRAFT);
  const [viewState, setViewState] = useState<'loading' | 'ready' | 'submitting-workspace' | 'submitting-startup' | 'error'>('loading');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeWorkspace = useMemo(
    () => bootstrapState.workspaces.find((workspace) => workspace.id === bootstrapState.activeWorkspaceId) ?? null,
    [bootstrapState.activeWorkspaceId, bootstrapState.workspaces]
  );

  async function loadBootstrap() {
    setViewState('loading');
    setBootstrapError(null);

    try {
      const workspaceState = await api.listWorkspaces();
      let startups: StartupRecord[] = [];

      if (workspaceState.activeWorkspaceId) {
        const startupState = await api.listStartups();
        startups = startupState.startups;
      }

      setBootstrapState({
        workspaces: workspaceState.workspaces,
        activeWorkspaceId: workspaceState.activeWorkspaceId,
        startups
      });
      setSelectedWorkspaceId((current) => {
        if (current) {
          return current;
        }

        return workspaceState.activeWorkspaceId ?? workspaceState.workspaces[0]?.id ?? '';
      });
      setViewState('ready');
    } catch (error) {
      setBootstrapError(getOnboardingErrorMessage(error, 'The onboarding surface could not load. Retry the workspace lookup.'));
      setViewState('error');
    }
  }

  useEffect(() => {
    void loadBootstrap();
  }, []);

  async function handleCreateWorkspace() {
    setWorkspaceError(null);
    setNotice(null);

    const trimmedName = workspaceName.trim();

    if (!trimmedName) {
      setWorkspaceError('Workspace name cannot be blank.');
      return;
    }

    setViewState('submitting-workspace');

    try {
      const response = await api.createWorkspace({ name: trimmedName });
      setWorkspaceName('');
      setSelectedWorkspaceId(response.activeWorkspaceId);
      setNotice(`Workspace ${response.workspace.name} is active. Add the first startup profile next.`);
      await loadBootstrap();
    } catch (error) {
      setWorkspaceError(getOnboardingErrorMessage(error, 'Workspace creation failed. Retry without leaving the form.'));
      setViewState('ready');
    }
  }

  async function handleSelectWorkspace() {
    setWorkspaceError(null);
    setNotice(null);

    if (!selectedWorkspaceId) {
      setWorkspaceError('Choose a workspace before continuing.');
      return;
    }

    setViewState('submitting-workspace');

    try {
      const response = await api.setActiveWorkspace({ workspaceId: selectedWorkspaceId });
      setNotice(`Workspace ${response.workspace.name} is active. Add the first startup profile next.`);
      await loadBootstrap();
    } catch (error) {
      setWorkspaceError(getOnboardingErrorMessage(error, 'Workspace selection failed. Retry without leaving the form.'));
      setViewState('ready');
    }
  }

  async function handleCreateStartup() {
    setStartupError(null);
    setNotice(null);

    if (!startupDraft.name.trim()) {
      setStartupError('Startup name cannot be blank.');
      return;
    }

    setViewState('submitting-startup');

    try {
      const response = await api.createStartup({
        ...startupDraft,
        name: startupDraft.name.trim()
      });
      setBootstrapState((current) => ({
        ...current,
        startups: response.startups
      }));
      setNotice(`${response.startup.name} is ready inside ${response.workspace.name}. Redirecting to the dashboard shell.`);
      navigateTo?.('/app');
      setViewState('ready');
    } catch (error) {
      setStartupError(getOnboardingErrorMessage(error, 'Startup creation failed. Retry without leaving the form.'));
      setViewState('ready');
    }
  }

  return (
    <main aria-label="startup onboarding" style={{ display: 'grid', gap: '1.5rem', padding: '2rem 1.5rem' }}>
      <header>
        <h2>Finish workspace onboarding</h2>
        <p>Create or select a workspace, then add the first B2B SaaS startup profile.</p>
      </header>

      {viewState === 'loading' ? <p role="status">Loading workspace and startup context…</p> : null}
      {bootstrapError ? <p role="alert">{bootstrapError}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <section aria-label="workspace setup" style={{ display: 'grid', gap: '1rem', padding: '1rem', border: '1px solid #e5e7eb' }}>
        <div>
          <h3 style={{ marginBottom: '0.5rem' }}>1. Pick the active workspace</h3>
          <p style={{ marginTop: 0 }}>
            {activeWorkspace
              ? `Active workspace: ${activeWorkspace.name}`
              : 'No active workspace yet. Create one or select an existing workspace to continue.'}
          </p>
        </div>

        <form
          aria-label="workspace create form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateWorkspace();
          }}
          style={{ display: 'grid', gap: '0.75rem' }}
        >
          <label htmlFor="workspace-name">Workspace name</label>
          <input
            id="workspace-name"
            name="workspaceName"
            type="text"
            placeholder="Acme Ventures"
            value={workspaceName}
            disabled={viewState === 'loading' || viewState === 'submitting-workspace'}
            onInput={(event) => setWorkspaceName((event.target as HTMLInputElement).value)}
          />
          <button type="submit" disabled={viewState === 'loading' || viewState === 'submitting-workspace'}>
            {viewState === 'submitting-workspace' ? 'Saving workspace…' : 'Create workspace'}
          </button>
        </form>

        {bootstrapState.workspaces.length > 0 ? (
          <form
            aria-label="workspace select form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSelectWorkspace();
            }}
            style={{ display: 'grid', gap: '0.75rem' }}
          >
            <label htmlFor="workspace-select">Existing workspaces</label>
            <select
              id="workspace-select"
              name="workspaceId"
              value={selectedWorkspaceId}
              disabled={viewState === 'loading' || viewState === 'submitting-workspace'}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
            >
              <option value="">Choose a workspace</option>
              {bootstrapState.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={viewState === 'loading' || viewState === 'submitting-workspace'}>
              Use selected workspace
            </button>
          </form>
        ) : null}

        {workspaceError ? <p role="alert">{workspaceError}</p> : null}
      </section>

      <section aria-label="startup setup" style={{ display: 'grid', gap: '1rem', padding: '1rem', border: '1px solid #e5e7eb' }}>
        <div>
          <h3 style={{ marginBottom: '0.5rem' }}>2. Add the first startup</h3>
          <p style={{ marginTop: 0 }}>
            {activeWorkspace
              ? `The first startup will be created inside ${activeWorkspace.name}.`
              : 'Startup creation stays locked until a valid active workspace exists.'}
          </p>
        </div>

        {bootstrapState.startups.length > 0 ? (
          <div>
            <p role="status">
              Startup onboarding is complete. {bootstrapState.startups[0]?.name} is attached to {activeWorkspace?.name ?? 'the active workspace'}.
            </p>
            <button type="button" onClick={() => navigateTo?.('/app')}>
              Return to dashboard shell
            </button>
          </div>
        ) : (
          <StartupForm
            value={startupDraft}
            disabled={!activeWorkspace || viewState === 'loading' || viewState === 'submitting-startup'}
            error={startupError}
            onChange={setStartupDraft}
            onSubmit={handleCreateStartup}
          />
        )}
      </section>

      {viewState === 'error' ? (
        <button type="button" onClick={() => void loadBootstrap()}>
          Retry onboarding load
        </button>
      ) : null}
    </main>
  );
}
