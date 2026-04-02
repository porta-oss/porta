import { useEffect, useSyncExternalStore } from 'react';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins';

export const AUTH_BOOTSTRAP_TIMEOUT_MS = Number(import.meta.env.VITE_AUTH_TIMEOUT_MS ?? 2000);
export const DEFAULT_AUTH_REDIRECT_PATH = '/app';
export const AUTH_SESSION_BOOTSTRAP_PATH = '/get-session';

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL?.trim();

  if (configured) {
    return configured;
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    const { hostname } = window.location;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
  }

  return 'http://localhost:3000';
}

export const AUTH_BASE_URL = new URL('/api/auth', resolveApiBaseUrl()).toString();
export const API_BASE_URL = new URL('/api', AUTH_BASE_URL).toString();

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  plugins: [magicLinkClient(), organizationClient()]
});

export type BetterAuthSession = (typeof authClient)['$Infer']['Session'];

export interface AuthUiError {
  code: 'AUTH_UNAVAILABLE' | 'AUTH_TIMEOUT' | 'AUTH_RESPONSE_MALFORMED' | 'AUTH_ACTION_FAILED';
  message: string;
}

export interface AuthSnapshot {
  status: 'idle' | 'loading' | 'authenticated' | 'signed-out' | 'error';
  session: BetterAuthSession | null;
  error: AuthUiError | null;
  diagnostic: 'none' | 'missing-session' | 'malformed-session' | 'timeout' | 'request-failed';
  lastResolvedAt: number | null;
}

export interface AuthController {
  getSnapshot: () => AuthSnapshot;
  subscribe: (listener: () => void) => () => void;
  bootstrapSession: (options?: { force?: boolean; timeoutMs?: number }) => Promise<AuthSnapshot>;
  signInWithGoogle: (options?: { redirectTo?: string }) => Promise<void>;
  signInWithMagicLink: (options: { email: string; redirectTo?: string }) => Promise<void>;
  markSignedOut: () => void;
}

interface BetterFetchResponseLike<T> {
  data?: T | null;
  error?: unknown;
}

class AuthBootstrapTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Authentication bootstrap timed out after ${timeoutMs}ms.`);
    this.name = 'AuthBootstrapTimeoutError';
  }
}

class AuthResponseMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthResponseMalformedError';
  }
}

class AuthActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthActionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBetterFetchResponseLike<T>(value: unknown): value is BetterFetchResponseLike<T> {
  return isRecord(value) && ('data' in value || 'error' in value);
}

function isSessionPayload(value: unknown): value is BetterAuthSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
    return false;
  }

  return (
    typeof value.user.id === 'string' &&
    typeof value.user.email === 'string' &&
    typeof value.session.id === 'string' &&
    typeof value.session.userId === 'string'
  );
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  return fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AuthBootstrapTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function unwrapActionResponse(response: unknown) {
  if (isBetterFetchResponseLike(response)) {
    if (response.error) {
      throw new AuthActionError(getErrorMessage(response.error, 'Authentication request failed.'));
    }

    return response.data;
  }

  return response;
}

function parseSessionResponse(response: unknown): { session: BetterAuthSession | null; diagnostic: AuthSnapshot['diagnostic'] } {
  const payload = isBetterFetchResponseLike<BetterAuthSession | null>(response) ? response.data ?? null : response;

  if (payload === null || payload === undefined) {
    return {
      session: null,
      diagnostic: 'missing-session'
    };
  }

  if (!isSessionPayload(payload)) {
    return {
      session: null,
      diagnostic: 'malformed-session'
    };
  }

  return {
    session: payload,
    diagnostic: 'none'
  };
}

function createInitialSnapshot(): AuthSnapshot {
  return {
    status: 'idle',
    session: null,
    error: null,
    diagnostic: 'none',
    lastResolvedAt: null
  };
}

function sanitizeRedirectTarget(value: string | undefined) {
  if (!value || !value.startsWith('/app')) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  return value;
}

export function createAuthController(client: typeof authClient = authClient): AuthController {
  let snapshot = createInitialSnapshot();
  let inFlight: Promise<AuthSnapshot> | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const setSnapshot = (next: AuthSnapshot) => {
    snapshot = next;
    notify();
    return snapshot;
  };

  const controller: AuthController = {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    async bootstrapSession(options) {
      const force = options?.force ?? false;
      const timeoutMs = options?.timeoutMs ?? AUTH_BOOTSTRAP_TIMEOUT_MS;

      if (!force) {
        if (snapshot.status === 'authenticated' || snapshot.status === 'signed-out') {
          return snapshot;
        }

        if (inFlight) {
          return inFlight;
        }
      }

      setSnapshot({
        ...snapshot,
        status: 'loading',
        error: null
      });

      inFlight = withTimeout(client.getSession(), timeoutMs)
        .then((response) => {
          const { session, diagnostic } = parseSessionResponse(response);

          if (!session) {
            return setSnapshot({
              status: 'signed-out',
              session: null,
              error: null,
              diagnostic,
              lastResolvedAt: Date.now()
            });
          }

          return setSnapshot({
            status: 'authenticated',
            session,
            error: null,
            diagnostic,
            lastResolvedAt: Date.now()
          });
        })
        .catch((error: unknown) => {
          const uiError: AuthUiError = error instanceof AuthBootstrapTimeoutError
            ? {
                code: 'AUTH_TIMEOUT',
                message: 'Authentication is taking too long. Retry the session check.'
              }
            : error instanceof AuthResponseMalformedError
              ? {
                  code: 'AUTH_RESPONSE_MALFORMED',
                  message: 'Authentication returned an unexpected response. Continuing as signed out.'
                }
              : {
                  code: 'AUTH_UNAVAILABLE',
                  message: 'Authentication is temporarily unavailable. Please try again.'
                };

          return setSnapshot({
            status: 'error',
            session: null,
            error: uiError,
            diagnostic: error instanceof AuthBootstrapTimeoutError ? 'timeout' : 'request-failed',
            lastResolvedAt: Date.now()
          });
        })
        .finally(() => {
          inFlight = null;
        });

      return inFlight;
    },
    async signInWithGoogle(options) {
      const response = await client.signIn.social({
        provider: 'google',
        callbackURL: sanitizeRedirectTarget(options?.redirectTo)
      });

      const payload = unwrapActionResponse(response);

      if (payload !== undefined && payload !== null && !isRecord(payload)) {
        throw new AuthActionError('Google sign-in returned an unexpected response.');
      }
    },
    async signInWithMagicLink(options) {
      const response = await client.signIn.magicLink({
        email: options.email,
        callbackURL: sanitizeRedirectTarget(options.redirectTo),
        errorCallbackURL: '/auth/sign-in'
      });

      const payload = unwrapActionResponse(response);

      if (payload !== undefined && payload !== null && !isRecord(payload)) {
        throw new AuthActionError('Magic-link sign-in returned an unexpected response.');
      }
    },
    markSignedOut() {
      setSnapshot({
        status: 'signed-out',
        session: null,
        error: null,
        diagnostic: 'missing-session',
        lastResolvedAt: Date.now()
      });
    }
  };

  return controller;
}

export const authController = createAuthController();

export function useAuthSnapshot(controller: AuthController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export function useAuthBootstrap(controller: AuthController) {
  const snapshot = useAuthSnapshot(controller);

  useEffect(() => {
    if (snapshot.status === 'idle') {
      void controller.bootstrapSession();
    }
  }, [controller, snapshot.status]);

  return snapshot;
}

export function buildProtectedRedirectTarget(pathname: string) {
  return sanitizeRedirectTarget(pathname);
}

export function describeSessionState(snapshot: AuthSnapshot) {
  switch (snapshot.status) {
    case 'loading':
      return 'Checking your existing session…';
    case 'authenticated':
      return 'Existing session found.';
    case 'signed-out':
      return 'No active session found.';
    case 'error':
      return snapshot.error?.message ?? 'Authentication is temporarily unavailable.';
    default:
      return 'Preparing authentication…';
  }
}

export function normalizePostAuthRedirect(value: string | undefined) {
  return sanitizeRedirectTarget(value);
}
