import type { ReactNode } from 'react';

import type { StartupRecord, WorkspaceSummary } from '@shared/types';

import { StartupList } from './startup-list';
import { WorkspaceSwitcher } from './workspace-switcher';

export interface AppShellProps {
  user: {
    email: string;
    name?: string | null;
  };
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  startups: StartupRecord[];
  shellStatus: 'loading' | 'ready' | 'error';
  startupStatus: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
  shellError?: string | null;
  workspaceError?: string | null;
  startupError?: string | null;
  isSwitchingWorkspace?: boolean;
  onRetryShell?: () => void | Promise<void>;
  onRetryStartups?: () => void | Promise<void>;
  onActivateWorkspace?: (workspaceId: string) => void | Promise<void>;
  children?: ReactNode;
}

export function AppShell({
  user,
  workspaces,
  activeWorkspaceId,
  startups,
  shellStatus,
  startupStatus,
  shellError = null,
  workspaceError = null,
  startupError = null,
  isSwitchingWorkspace = false,
  onRetryShell,
  onRetryStartups,
  onActivateWorkspace,
  children
}: AppShellProps) {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  return (
    <main
      aria-label="dashboard shell"
      style={{
        display: 'grid',
        gap: '1.5rem',
        padding: '2rem 1.5rem',
        background: '#f8fafc'
      }}
    >
      <header
        style={{
          display: 'grid',
          gap: '0.5rem',
          padding: '1.5rem',
          borderRadius: '1.25rem',
          background: 'linear-gradient(135deg, #111827 0%, #1f2937 100%)',
          color: '#f9fafb'
        }}
      >
        <p style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#cbd5e1' }}>
          Founder dashboard
        </p>
        <h1 style={{ margin: 0, fontSize: '1.75rem' }}>Portfolio overview</h1>
        <p style={{ margin: 0, color: '#e5e7eb' }}>
          {user.name ? `${user.name} (${user.email})` : user.email} — prioritize and monitor your startups from one surface.
        </p>
      </header>

      {shellStatus === 'loading' ? <p role="status">Bootstrapping the authenticated shell…</p> : null}
      {shellStatus === 'error' ? (
        <section
          aria-label="shell bootstrap error"
          style={{ display: 'grid', gap: '0.75rem', padding: '1rem', border: '1px solid #fecaca', borderRadius: '1rem', background: '#fef2f2' }}
        >
          <p role="alert" style={{ margin: 0, color: '#991b1b' }}>
            {shellError ?? 'The authenticated shell could not be loaded.'}
          </p>
          <button type="button" onClick={() => void onRetryShell?.()}>
            Retry shell bootstrap
          </button>
        </section>
      ) : null}

      <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'minmax(0, 18rem) minmax(0, 1fr)' }}>
        <aside style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            startupCount={startups.length}
            isLoading={shellStatus === 'loading'}
            isSwitching={isSwitchingWorkspace}
            error={workspaceError}
            onActivateWorkspace={onActivateWorkspace}
          />
          <StartupList
            workspaceName={activeWorkspace?.name ?? null}
            startups={startups}
            status={startupStatus}
            error={startupError}
            onRetry={onRetryStartups}
          />
        </aside>

        <section
          aria-label="dashboard content"
          style={{
            display: 'grid',
            gap: '1rem',
            padding: '1.25rem',
            border: '1px solid #e5e7eb',
            borderRadius: '1rem',
            background: '#fff'
          }}
        >
          {children ?? (
            <>
              <h2 style={{ margin: 0 }}>Workspace overview</h2>
              <p style={{ margin: 0, color: '#4b5563' }}>
                The dashboard shell keeps workspace and startup context visible so auth, tenancy, and onboarding regressions show up as explicit UI states instead of broken chrome.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
