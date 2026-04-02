export const STARTUP_TYPES = ["b2b_saas"] as const;
export const STARTUP_STAGES = ["idea", "mvp", "growth"] as const;
export const STARTUP_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
] as const;
export const STARTUP_CURRENCIES = ["USD", "EUR", "GBP"] as const;

export type StartupType = (typeof STARTUP_TYPES)[number];
export type StartupStage = (typeof STARTUP_STAGES)[number];
export type StartupTimezone = (typeof STARTUP_TIMEZONES)[number];
export type StartupCurrency = (typeof STARTUP_CURRENCIES)[number];

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceShellState {
  activeWorkspaceId: string | null;
  requiresOnboarding: boolean;
  startupCount: number;
  workspaceName: string | null;
}

export interface StartupDraft {
  currency: StartupCurrency;
  name: string;
  stage: StartupStage;
  timezone: StartupTimezone;
  type: StartupType;
}

export interface StartupRecord extends StartupDraft {
  createdAt: string;
  id: string;
  updatedAt: string;
  workspaceId: string;
}

export const DEFAULT_STARTUP_DRAFT: StartupDraft = {
  name: "",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

export function isStartupType(value: string): value is StartupType {
  return STARTUP_TYPES.includes(value as StartupType);
}

export function isStartupStage(value: string): value is StartupStage {
  return STARTUP_STAGES.includes(value as StartupStage);
}

export function isStartupTimezone(value: string): value is StartupTimezone {
  return STARTUP_TIMEZONES.includes(value as StartupTimezone);
}

export function isStartupCurrency(value: string): value is StartupCurrency {
  return STARTUP_CURRENCIES.includes(value as StartupCurrency);
}
