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
