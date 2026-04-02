import {
  isStartupCurrency,
  isStartupStage,
  isStartupTimezone,
  isStartupType,
  type StartupDraft,
  type StartupRecord
} from '@shared/types';

export const STARTUP_ROUTE_PREFIX = '/startups';

export interface StartupRouteContract {
  list: {
    method: 'GET';
    path: '/startups';
    auth: 'required';
  };
  create: {
    method: 'POST';
    path: '/startups';
    auth: 'required';
  };
}

export interface StartupValidationError {
  code:
    | 'STARTUP_NAME_REQUIRED'
    | 'STARTUP_TYPE_INVALID'
    | 'STARTUP_STAGE_INVALID'
    | 'STARTUP_TIMEZONE_INVALID'
    | 'STARTUP_CURRENCY_INVALID';
  field: keyof StartupDraft;
  message: string;
}

export function createStartupRouteContract(): StartupRouteContract {
  return {
    list: {
      method: 'GET',
      path: STARTUP_ROUTE_PREFIX,
      auth: 'required'
    },
    create: {
      method: 'POST',
      path: STARTUP_ROUTE_PREFIX,
      auth: 'required'
    }
  };
}

export function sanitizeStartupDraft(input: StartupDraft): StartupDraft {
  return {
    name: input.name.trim(),
    type: input.type,
    stage: input.stage,
    timezone: input.timezone,
    currency: input.currency
  };
}

export function validateStartupDraft(input: StartupDraft): StartupValidationError | null {
  const draft = sanitizeStartupDraft(input);

  if (!draft.name) {
    return {
      code: 'STARTUP_NAME_REQUIRED',
      field: 'name',
      message: 'Startup name cannot be blank.'
    };
  }

  if (!isStartupType(draft.type)) {
    return {
      code: 'STARTUP_TYPE_INVALID',
      field: 'type',
      message: 'Startup type must stay within the supported B2B SaaS slice.'
    };
  }

  if (!isStartupStage(draft.stage)) {
    return {
      code: 'STARTUP_STAGE_INVALID',
      field: 'stage',
      message: 'Startup stage is invalid for the onboarding flow.'
    };
  }

  if (!isStartupTimezone(draft.timezone)) {
    return {
      code: 'STARTUP_TIMEZONE_INVALID',
      field: 'timezone',
      message: 'Startup timezone must be selected from the supported onboarding list.'
    };
  }

  if (!isStartupCurrency(draft.currency)) {
    return {
      code: 'STARTUP_CURRENCY_INVALID',
      field: 'currency',
      message: 'Startup currency must be selected from the supported onboarding list.'
    };
  }

  return null;
}

export function serializeStartupRecord(row: {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  stage: string;
  timezone: string;
  currency: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): StartupRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type as StartupRecord['type'],
    stage: row.stage as StartupRecord['stage'],
    timezone: row.timezone as StartupRecord['timezone'],
    currency: row.currency as StartupRecord['currency'],
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
    updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString()
  };
}
