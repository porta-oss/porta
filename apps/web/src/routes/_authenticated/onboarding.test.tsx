import '../../test/setup-dom';

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import type { StartupDraft, StartupRecord, WorkspaceSummary } from '@shared/types';

import { OnboardingPage, type OnboardingApi } from './onboarding';

function setNativeInputValue(element: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  fireEvent.input(element, { target: { value } });
}

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
    id: 'startup_1',
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

function createApi(overrides: Partial<OnboardingApi> = {}): OnboardingApi {
  return {
    listWorkspaces: overrides.listWorkspaces ?? mock(async () => ({ workspaces: [], activeWorkspaceId: null })),
    createWorkspace:
      overrides.createWorkspace ??
      mock(async ({ name }: { name: string }) => ({
        workspace: {
          id: 'workspace_created',
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        },
        activeWorkspaceId: 'workspace_created'
      })),
    setActiveWorkspace:
      overrides.setActiveWorkspace ??
      mock(async ({ workspaceId }: { workspaceId: string }) => ({
        workspace: workspaceId === WORKSPACE_B.id ? WORKSPACE_B : WORKSPACE_A,
        activeWorkspaceId: workspaceId
      })),
    listStartups: overrides.listStartups ?? mock(async () => ({ workspace: WORKSPACE_A, startups: [] })),
    createStartup:
      overrides.createStartup ??
      mock(async (input: StartupDraft) => ({
        workspace: WORKSPACE_A,
        startup: createStartup(WORKSPACE_A.id, input.name),
        startups: [createStartup(WORKSPACE_A.id, input.name)]
      }))
  };
}

afterEach(() => {
  cleanup();
});

describe('startup onboarding route', () => {
  test('keeps startup creation locked until a workspace exists for the signed-in founder', async () => {
    const api = createApi();
    const view = render(<OnboardingPage api={api} />);

    expect(await view.findByText('No active workspace yet. Create one or select an existing workspace to continue.')).toBeTruthy();
    expect(view.getByRole('button', { name: /startup/i }).hasAttribute('disabled')).toBe(true);
  });

  test('creates a workspace, then creates the first startup and transitions back to the dashboard shell', async () => {
    let bootstrapStep = 0;
    const listWorkspaces = mock(async () => {
      bootstrapStep += 1;

      if (bootstrapStep === 1) {
        return { workspaces: [], activeWorkspaceId: null };
      }

      return { workspaces: [WORKSPACE_A], activeWorkspaceId: WORKSPACE_A.id };
    });
    const listStartups = mock(async () => ({ workspace: WORKSPACE_A, startups: [] }));
    const createWorkspace = mock(async () => ({ workspace: WORKSPACE_A, activeWorkspaceId: WORKSPACE_A.id }));
    const createStartupCall = mock(async (input: StartupDraft) => ({
      workspace: WORKSPACE_A,
      startup: createStartup(WORKSPACE_A.id, input.name),
      startups: [createStartup(WORKSPACE_A.id, input.name)]
    }));
    const navigateTo = mock(() => {});
    const api = createApi({ listWorkspaces, listStartups, createWorkspace, createStartup: createStartupCall });

    const view = render(<OnboardingPage api={api} navigateTo={navigateTo} />);

    await view.findByText('No active workspace yet. Create one or select an existing workspace to continue.');

    setNativeInputValue(view.getByLabelText('Workspace name') as HTMLInputElement, 'Acme Ventures');
    fireEvent.submit(view.getByRole('form', { name: 'workspace create form' }));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith({ name: 'Acme Ventures' });
    });
    expect(await view.findByText('The first startup will be created inside Acme Ventures.')).toBeTruthy();

    setNativeInputValue(view.getByLabelText('Startup name') as HTMLInputElement, 'Acme Analytics');
    fireEvent.submit(view.getByRole('form', { name: 'startup form' }));

    await waitFor(() => {
      expect(createStartupCall).toHaveBeenCalledWith({
        name: 'Acme Analytics',
        type: 'b2b_saas',
        stage: 'mvp',
        timezone: 'UTC',
        currency: 'USD'
      });
      expect(navigateTo).toHaveBeenCalledWith('/app');
    });
  });

  test('keeps validation errors visible when the founder submits an empty startup name', async () => {
    const createStartupCall = mock(async () => ({
      workspace: WORKSPACE_A,
      startup: createStartup(),
      startups: [createStartup()]
    }));
    const api = createApi({
      listWorkspaces: mock(async () => ({ workspaces: [WORKSPACE_A], activeWorkspaceId: WORKSPACE_A.id })),
      listStartups: mock(async () => ({ workspace: WORKSPACE_A, startups: [] })),
      createStartup: createStartupCall
    });

    const view = render(<OnboardingPage api={api} />);

    expect(await view.findByText('The first startup will be created inside Acme Ventures.')).toBeTruthy();

    fireEvent.submit(view.getByRole('form', { name: 'startup form' }));

    expect((await view.findByRole('alert')).textContent).toContain('Startup name cannot be blank.');
    expect(createStartupCall).not.toHaveBeenCalled();
  });

  test('surfaces missing-workspace and malformed-response failures without clearing the entered startup draft', async () => {
    const createStartupCall = mock(async () => {
      throw new Error('Create or select a workspace before continuing startup onboarding.');
    });
    const api = createApi({
      listWorkspaces: mock(async () => ({ workspaces: [WORKSPACE_A, WORKSPACE_B], activeWorkspaceId: WORKSPACE_A.id })),
      listStartups: mock(async () => ({ workspace: WORKSPACE_A, startups: [] })),
      createStartup: createStartupCall
    });

    const view = render(<OnboardingPage api={api} />);

    await view.findByText('The first startup will be created inside Acme Ventures.');

    setNativeInputValue(view.getByLabelText('Startup name') as HTMLInputElement, 'Retryable Startup');
    fireEvent.submit(view.getByRole('form', { name: 'startup form' }));

    expect((await view.findByRole('alert')).textContent).toContain('Create or select a workspace before continuing startup onboarding.');
    expect((view.getByLabelText('Startup name') as HTMLInputElement).value).toBe('Retryable Startup');
  });

  test('lets the founder select an existing workspace when the session has no active workspace yet', async () => {
    const setActiveWorkspace = mock(async ({ workspaceId }: { workspaceId: string }) => ({
      workspace: WORKSPACE_B,
      activeWorkspaceId: workspaceId
    }));
    let bootstrapStep = 0;
    const listWorkspaces = mock(async () => {
      bootstrapStep += 1;

      if (bootstrapStep === 1) {
        return { workspaces: [WORKSPACE_A, WORKSPACE_B], activeWorkspaceId: null };
      }

      return { workspaces: [WORKSPACE_A, WORKSPACE_B], activeWorkspaceId: WORKSPACE_B.id };
    });
    const api = createApi({
      listWorkspaces,
      setActiveWorkspace,
      listStartups: mock(async () => ({ workspace: WORKSPACE_B, startups: [] }))
    });

    const view = render(<OnboardingPage api={api} />);

    await view.findByText('No active workspace yet. Create one or select an existing workspace to continue.');

    fireEvent.change(view.getByLabelText('Existing workspaces'), {
      target: { value: WORKSPACE_B.id }
    });
    fireEvent.submit(view.getByRole('form', { name: 'workspace select form' }));

    await waitFor(() => {
      expect(setActiveWorkspace).toHaveBeenCalledWith({ workspaceId: WORKSPACE_B.id });
    });
    expect(await view.findByText('The first startup will be created inside Beta Ventures.')).toBeTruthy();
  });
});
