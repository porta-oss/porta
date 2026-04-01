export const STARTUP_TYPES = ['b2b_saas'] as const;

export type StartupType = (typeof STARTUP_TYPES)[number];

export interface WorkspaceShellState {
  workspaceName: string | null;
  startupCount: number;
  requiresOnboarding: boolean;
}

export interface StartupDraft {
  name: string;
  type: StartupType;
  stage: 'idea' | 'mvp' | 'growth';
  timezone: string;
  currency: string;
}

export const DEFAULT_STARTUP_DRAFT: StartupDraft = {
  name: '',
  type: 'b2b_saas',
  stage: 'mvp',
  timezone: 'UTC',
  currency: 'USD'
};
