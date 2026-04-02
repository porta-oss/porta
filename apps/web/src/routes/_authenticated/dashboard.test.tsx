import '../../test/setup-dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import type { StartupRecord, WorkspaceSummary } from '@shared/types';

import type { AuthSnapshot } from '../../lib/auth-client';
import { DashboardPage, type DashboardApi } from './dashboard';

const WORKSPACE_A: WorkspaceSummary = {
  id: 'workspace_a',
  name: 'Acme Ventures',
  slug: 'acme-ventures'
};

const WORKSPACE_B: WorkspaceSummary = {
  id: 'workspace_b',
  name: 'Beta Ventures',
  slug: 'beta-ventures'
};

function createStartup(workspaceId = WORKSPACE_A.id, name = 'Acme Analytics'): StartupRecord {
  return {
    id: `${workspaceId}_${name}`,
    workspaceId,
    name,
    type: 'b2b_saas',
    stage: 'mvp',
    timezone: 'UTC',
    currency: 'USD',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
  };
}

function createAuthenticatedSnapshot(activeWorkspaceId: string | null = WORKSPACE_A.id): AuthSnapshot {
  return {
    status: 'authenticated',
    error: null,
    diagnostic: 'none',
    lastResolvedAt: Date.now(),
    session: {
      user: {
        id: 'user_123',
        email: 'founder@example.com',
        name: 'Founder',
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true
      },
      session: {
        id: 'session_123',
        userId: 'user_123',
        expiresAt: new Date(),
        activeOrganizationId: activeWorkspaceId,
        createdAt: new Date(),
        updatedAt: new Date(),
        token: 'token_123',
        ipAddress: null,
        userAgent: null
      }
    }
  };
}

function createApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listWorkspaces: overrides.listWorkspaces ?? mock(async () => ({ workspaces: [WORKSPACE_A], activeWorkspaceId: WORKSPACE_A.id })),
    setActiveWorkspace:
      overrides.setActiveWorkspace ??
      mock(async ({ workspaceId }: { workspaceId: string }) => ({
        activeWorkspaceId: workspaceId,
        workspace: workspaceId === WORKSPACE_B.id ? WORKSPACE_B : WORKSPACE_A
      })),
    listStartups:
      overrides.listStartups ??
      mock(async () => ({
        workspace: WORKSPACE_A,
        startups: [createStartup()]
      }))
  };
}

afterEach(() => {
  cleanup();
});

describe('dashboard shell route', () => {
  test('shows the mounted workspace and startup context after bootstrap', async () => {
    const api = createApi();
    const view = render(<DashboardPage authState={createAuthenticatedSnapshot()} api={api} />);

    expect(await view.findByRole('main', { name: 'dashboard shell' })).toBeTruthy();
    expect(await view.findByText('Workspace Acme Ventures is mounted inside the authenticated shell.')).toBeTruthy();
    expect(view.getByText(/Primary startup:/)).toBeTruthy();
    expect(await view.findAllByText('Acme Analytics')).toHaveLength(2);
  });

  test('keeps the shell chrome visible and points back to onboarding when the active workspace has no startups', async () => {
    const api = createApi({
      listStartups: mock(async () => ({ workspace: WORKSPACE_A, startups: [] }))
    });
    const view = render(<DashboardPage authState={createAuthenticatedSnapshot()} api={api} />);

    expect(await view.findByRole('main', { name: 'dashboard shell' })).toBeTruthy();
    expect(await view.findByText('No startups are attached to this workspace yet.')).toBeTruthy();
    expect(view.getByRole('link', { name: 'Complete onboarding' })).toBeTruthy();
  });

  test('preserves the shell chrome and exposes a retry path when startup navigation fails or is malformed', async () => {
    let attempt = 0;
    const listStartups = mock(async () => {
      attempt += 1;

      if (attempt === 1) {
        throw new Error('Startup navigation failed to load.');
      }

      return {
        workspace: WORKSPACE_A,
        startups: [createStartup()]
      };
    });
    const api = createApi({ listStartups });

    const view = render(<DashboardPage authState={createAuthenticatedSnapshot()} api={api} />);

    expect((await view.findByRole('alert')).textContent).toContain('Startup navigation failed to load.');
    expect(view.getByRole('heading', { name: 'Authenticated workspace shell' })).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Retry startup load' }));

    await waitFor(() => {
      expect(listStartups).toHaveBeenCalledTimes(2);
    });
    expect(await view.findAllByText('Acme Analytics')).toHaveLength(2);
  });

  test('shows a shell bootstrap failure loudly when workspace context cannot be parsed', async () => {
    const api = createApi({
      listWorkspaces: mock(async () => {
        throw new Error('The dashboard shell could not be bootstrapped.');
      })
    });
    const view = render(<DashboardPage authState={createAuthenticatedSnapshot(null)} api={api} />);

    expect((await view.findByRole('alert')).textContent).toContain('The dashboard shell could not be bootstrapped.');
    expect(view.getByRole('button', { name: 'Retry shell bootstrap' })).toBeTruthy();
  });

  test('switches the active workspace and reloads startup navigation for the new tenant', async () => {
    let startupListCall = 0;
    const listStartups = mock(async () => {
      startupListCall += 1;

      if (startupListCall === 1) {
        return {
          workspace: WORKSPACE_A,
          startups: [createStartup(WORKSPACE_A.id, 'Acme Analytics')]
        };
      }

      return {
        workspace: WORKSPACE_B,
        startups: [createStartup(WORKSPACE_B.id, 'Beta Analytics')]
      };
    });
    const setActiveWorkspace = mock(async () => ({
      activeWorkspaceId: WORKSPACE_B.id,
      workspace: WORKSPACE_B
    }));
    const api = createApi({
      listWorkspaces: mock(async () => ({ workspaces: [WORKSPACE_A, WORKSPACE_B], activeWorkspaceId: WORKSPACE_A.id })),
      setActiveWorkspace,
      listStartups
    });

    const view = render(<DashboardPage authState={createAuthenticatedSnapshot()} api={api} />);

    await view.findAllByText('Acme Analytics');

    fireEvent.change(view.getByLabelText('Switch workspace'), { target: { value: WORKSPACE_B.id } });
    fireEvent.click(view.getByRole('button', { name: 'Use selected workspace' }));

    await waitFor(() => {
      expect(setActiveWorkspace).toHaveBeenCalledWith({ workspaceId: WORKSPACE_B.id });
    });
    expect(await view.findAllByText('Beta Analytics')).toHaveLength(2);
  });
});
