import { useEffect, useState } from 'react';

import type { WorkspaceSummary } from '@shared/types';

export interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  startupCount: number;
  isLoading?: boolean;
  isSwitching?: boolean;
  error?: string | null;
  onActivateWorkspace?: (workspaceId: string) => void | Promise<void>;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  startupCount,
  isLoading = false,
  isSwitching = false,
  error = null,
  onActivateWorkspace
}: WorkspaceSwitcherProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId ?? '');

  useEffect(() => {
    setSelectedWorkspaceId(activeWorkspaceId ?? '');
  }, [activeWorkspaceId]);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const canSwitch = Boolean(selectedWorkspaceId) && selectedWorkspaceId !== activeWorkspaceId && !isLoading && !isSwitching;

  return (
    <section
      aria-label="workspace switcher"
      style={{
        display: 'grid',
        gap: '0.875rem',
        padding: '1rem',
        border: '1px solid #e5e7eb',
        borderRadius: '1rem',
        background: '#fff'
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280' }}>
          Active workspace
        </p>
        <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.125rem' }}>{activeWorkspace?.name ?? 'No active workspace yet'}</h2>
        <p style={{ margin: '0.35rem 0 0', color: '#4b5563' }}>
          {activeWorkspace
            ? `${startupCount} ${startupCount === 1 ? 'startup' : 'startups'} currently scoped to this dashboard.`
            : 'Choose or create a workspace in onboarding before the shell can load startup data.'}
        </p>
      </div>

      {workspaces.length > 0 ? (
        <>
          <label htmlFor="workspace-switcher-select">Switch workspace</label>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              id="workspace-switcher-select"
              name="workspaceId"
              value={selectedWorkspaceId}
              disabled={isLoading || isSwitching}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
              style={{ minWidth: '14rem' }}
            >
              <option value="">Choose a workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={!canSwitch} onClick={() => void onActivateWorkspace?.(selectedWorkspaceId)}>
              {isSwitching ? 'Switching workspace…' : 'Use selected workspace'}
            </button>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, color: '#4b5563' }}>No workspaces are available yet. Finish onboarding to create the first one.</p>
      )}

      {error ? <p role="alert" style={{ margin: 0, color: '#991b1b' }}>{error}</p> : null}
    </section>
  );
}
