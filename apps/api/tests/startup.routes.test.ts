import { describe, expect, test } from 'bun:test';

import { STARTUP_TYPES } from '@shared/types';

import { STARTUP_ROUTE_PREFIX, createStartupRouteContract } from '../src/routes/startup';

describe('startup route scaffold', () => {
  test('exposes the future workspace-scoped startup contract from a stable file path', () => {
    const contract = createStartupRouteContract();

    expect(STARTUP_ROUTE_PREFIX).toBe('/startups');
    expect(contract.list.path).toBe('/startups');
    expect(contract.create.method).toBe('POST');
    expect(contract.create.auth).toBe('required');
  });

  test('shared startup types stay narrow during the first-slice scaffold', () => {
    expect(STARTUP_TYPES).toEqual(['b2b_saas']);
  });
});
