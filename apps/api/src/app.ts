import { cors } from '@elysiajs/cors';
import { Elysia, t } from 'elysia';

import { createAuthRuntime, createWorkspaceSlug, type ApiAuthRuntime } from './auth';
import { createApiDatabase, type ApiDatabase } from './db/index';
import { type ApiEnv, readApiEnv } from './lib/env';
import { createStartupRouteContract } from './routes/startup';

interface AuthenticatedSession {
  session: {
    id: string;
    userId: string;
    expiresAt: Date | string;
    activeOrganizationId?: string | null;
  };
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified?: boolean;
    image?: string | null;
  };
}

type RequestAuthContext =
  | {
      status: 'authenticated';
      session: AuthenticatedSession['session'];
      user: AuthenticatedSession['user'];
      activeWorkspaceId: string | null;
    }
  | {
      status: 'unauthenticated';
      reason: 'missing-session' | 'invalid-session' | 'malformed-session';
    }
  | {
      status: 'error';
      code: 'AUTH_CONTEXT_TIMEOUT';
      message: string;
    };

interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: unknown;
  createdAt?: Date | string;
}

interface ApiRuntime {
  env: ApiEnv;
  db: ApiDatabase;
  auth: ApiAuthRuntime;
}

interface WorkspaceAuthApi {
  getSession: (input: { headers: Headers }) => Promise<unknown>;
  listOrganizations: (input: { headers: Headers }) => Promise<unknown>;
  createOrganization: (input: {
    headers: Headers;
    body: {
      name: string;
      slug: string;
      keepCurrentActiveOrganization: boolean;
    };
  }) => Promise<unknown>;
  setActiveOrganization: (input: {
    headers: Headers;
    body: {
      organizationId: string;
      organizationSlug?: string;
    };
  }) => Promise<unknown>;
  getFullOrganization: (input: {
    headers: Headers;
    query: {
      organizationId: string;
    };
  }) => Promise<unknown>;
  getActiveMember: (input: { headers: Headers }) => Promise<unknown>;
}

export type ApiApp = Elysia & { runtime: ApiRuntime };

class AuthContextTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Session context timed out after ${timeoutMs}ms.`);
    this.name = 'AuthContextTimeoutError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthenticatedSession(value: unknown): value is AuthenticatedSession {
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.user)) {
    return false;
  }

  return typeof value.session.id === 'string' && typeof value.session.userId === 'string' && typeof value.user.id === 'string';
}

function normalizeWorkspace(value: unknown): WorkspaceRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.slug !== 'string') {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    logo: typeof value.logo === 'string' || value.logo === null ? value.logo : undefined,
    metadata: value.metadata,
    createdAt: value.createdAt instanceof Date || typeof value.createdAt === 'string' ? value.createdAt : undefined
  };
}

function getAuthApi(runtime: ApiRuntime): WorkspaceAuthApi {
  return runtime.auth.auth.api as unknown as WorkspaceAuthApi;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new AuthContextTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function resolveRequestAuth(runtime: ApiRuntime, request: Request): Promise<RequestAuthContext> {
  try {
    const authApi = getAuthApi(runtime);
    const session = await withTimeout(authApi.getSession({ headers: request.headers }), runtime.env.authContextTimeoutMs);

    if (!session) {
      return {
        status: 'unauthenticated',
        reason: 'missing-session'
      };
    }

    if (!isAuthenticatedSession(session)) {
      return {
        status: 'unauthenticated',
        reason: 'malformed-session'
      };
    }

    const activeWorkspaceId =
      isRecord(session.session) && typeof session.session.activeOrganizationId === 'string'
        ? session.session.activeOrganizationId
        : null;

    return {
      status: 'authenticated',
      session: session.session,
      user: session.user,
      activeWorkspaceId
    };
  } catch (error) {
    if (error instanceof AuthContextTimeoutError) {
      return {
        status: 'error',
        code: 'AUTH_CONTEXT_TIMEOUT',
        message: error.message
      };
    }

    return {
      status: 'unauthenticated',
      reason: 'invalid-session'
    };
  }
}

function rejectProtectedRequest(authContext: RequestAuthContext, set: { status?: number | string }, path: string) {
  if (authContext.status === 'authenticated') {
    return authContext;
  }

  if (authContext.status === 'error') {
    set.status = 503;
    console.warn('[auth] protected request failed', {
      path,
      code: authContext.code
    });

    return {
      error: {
        code: authContext.code,
        message: authContext.message
      }
    };
  }

  set.status = 401;
  console.warn('[auth] protected request rejected', {
    path,
    reason: authContext.reason
  });

  return {
    error: {
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required for this route.'
    }
  };
}

async function listWorkspaceRecords(runtime: ApiRuntime, request: Request): Promise<WorkspaceRecord[]> {
  const authApi = getAuthApi(runtime);
  const workspaces = await withTimeout(authApi.listOrganizations({ headers: request.headers }), runtime.env.authContextTimeoutMs);

  if (!Array.isArray(workspaces)) {
    return [];
  }

  return workspaces.map(normalizeWorkspace).filter((workspace): workspace is WorkspaceRecord => workspace !== null);
}

export async function createApiApp(
  envSource: Record<string, string | undefined> = process.env,
  options?: {
    env?: ApiEnv;
    db?: ApiDatabase;
    auth?: ApiAuthRuntime;
    bootstrapDatabase?: boolean;
  }
): Promise<ApiApp> {
  const env = options?.env ?? readApiEnv(envSource, { strict: true });
  const db = options?.db ?? createApiDatabase(env);

  if (options?.bootstrapDatabase ?? true) {
    await db.bootstrap();
  }

  const auth = options?.auth ?? createAuthRuntime(env, db);
  const startupRoutes = createStartupRouteContract();
  const runtime: ApiRuntime = { env, db, auth };

  console.info('[auth] bootstrap ready', {
    mountPath: auth.bootstrap.basePath,
    googleConfigured: auth.bootstrap.providers.google.configured,
    magicLinkTransport: auth.bootstrap.magicLinkTransport
  });

  const app = new Elysia({ prefix: '/api' })
    .use(
      cors({
        origin: [env.webUrl],
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Cookie']
      })
    )
    .derive(async ({ request }) => ({
      authContext: await resolveRequestAuth(runtime, request)
    }))
    .get('/health', () => ({
      status: 'ok' as const,
      service: 'api',
      startupRoutes,
      auth: {
        mounted: true,
        mountPath: auth.bootstrap.basePath,
        providers: auth.bootstrap.providers,
        magicLinkTransport: auth.bootstrap.magicLinkTransport,
        observability: {
          sessionEndpoint: '/api/auth/session',
          activeWorkspaceEndpoint: '/api/workspaces/active'
        }
      },
      database: {
        configured: true,
        poolMax: env.databasePoolMax,
        tables: ['user', 'session', 'account', 'verification', 'workspace', 'member', 'invitation']
      }
    }))
    .get('/auth/session', ({ authContext }) => {
      if (authContext.status !== 'authenticated') {
        return {
          authenticated: false,
          reason: authContext.status === 'error' ? authContext.code : authContext.reason
        };
      }

      return {
        authenticated: true,
        user: {
          id: authContext.user.id,
          email: authContext.user.email,
          name: authContext.user.name
        },
        session: {
          id: authContext.session.id,
          expiresAt: authContext.session.expiresAt,
          activeWorkspaceId: authContext.activeWorkspaceId
        }
      };
    })
    .post(
      '/workspaces',
      async ({ authContext, body, request, set }) => {
        const denied = rejectProtectedRequest(authContext, set, '/api/workspaces');

        if ('error' in denied) {
          return denied;
        }

        const name = body.name.trim();
        const slug = (body.slug?.trim() || createWorkspaceSlug(name)).toLowerCase();

        if (!name) {
          set.status = 400;
          return {
            error: {
              code: 'WORKSPACE_NAME_REQUIRED',
              message: 'Workspace name cannot be blank.'
            }
          };
        }

        if (!slug) {
          set.status = 400;
          return {
            error: {
              code: 'WORKSPACE_SLUG_INVALID',
              message: 'Workspace slug could not be derived from the provided name.'
            }
          };
        }

        const existing = await listWorkspaceRecords(runtime, request);
        if (existing.some((workspace) => workspace.slug === slug)) {
          set.status = 409;
          return {
            error: {
              code: 'WORKSPACE_ALREADY_EXISTS',
              message: `A workspace with slug "${slug}" already exists for this user.`
            }
          };
        }

        const authApi = getAuthApi(runtime);
        const createdWorkspace = normalizeWorkspace(
          await withTimeout(
            authApi.createOrganization({
              headers: request.headers,
              body: {
                name,
                slug,
                keepCurrentActiveOrganization: false
              }
            }),
            runtime.env.authContextTimeoutMs
          )
        );

        if (!createdWorkspace) {
          set.status = 502;
          return {
            error: {
              code: 'WORKSPACE_CREATE_MALFORMED',
              message: 'Workspace creation returned an unexpected payload.'
            }
          };
        }

        await withTimeout(
          authApi.setActiveOrganization({
            headers: request.headers,
            body: {
              organizationId: createdWorkspace.id,
              organizationSlug: createdWorkspace.slug
            }
          }),
          runtime.env.authContextTimeoutMs
        );

        set.status = 201;
        return {
          workspace: createdWorkspace,
          activeWorkspaceId: createdWorkspace.id
        };
      },
      {
        body: t.Object({
          name: t.String(),
          slug: t.Optional(t.String())
        })
      }
    )
    .get('/workspaces', async ({ authContext, request, set }) => {
      const denied = rejectProtectedRequest(authContext, set, '/api/workspaces');

      if ('error' in denied) {
        return denied;
      }

      return {
        workspaces: await listWorkspaceRecords(runtime, request),
        activeWorkspaceId: denied.activeWorkspaceId
      };
    })
    .get('/workspaces/active', async ({ authContext, request, set }) => {
      const denied = rejectProtectedRequest(authContext, set, '/api/workspaces/active');

      if ('error' in denied) {
        return denied;
      }

      if (!denied.activeWorkspaceId) {
        return {
          workspace: null,
          member: null
        };
      }

      const authApi = getAuthApi(runtime);
      const workspace = normalizeWorkspace(
        await withTimeout(
          authApi.getFullOrganization({
            headers: request.headers,
            query: {
              organizationId: denied.activeWorkspaceId
            }
          }),
          runtime.env.authContextTimeoutMs
        )
      );

      const member = await withTimeout(authApi.getActiveMember({ headers: request.headers }), runtime.env.authContextTimeoutMs);

      return {
        workspace,
        member: isRecord(member)
          ? {
              id: typeof member.id === 'string' ? member.id : null,
              role: typeof member.role === 'string' ? member.role : null
            }
          : null
      };
    })
    .post(
      '/workspaces/active',
      async ({ authContext, body, request, set }) => {
        const denied = rejectProtectedRequest(authContext, set, '/api/workspaces/active');

        if ('error' in denied) {
          return denied;
        }

        const workspaces = await listWorkspaceRecords(runtime, request);
        const workspace = workspaces.find((entry) => entry.id === body.workspaceId);

        if (!workspace) {
          set.status = 404;
          return {
            error: {
              code: 'WORKSPACE_NOT_FOUND',
              message: 'The requested workspace is not accessible to this user.'
            }
          };
        }

        const authApi = getAuthApi(runtime);
        await withTimeout(
          authApi.setActiveOrganization({
            headers: request.headers,
            body: {
              organizationId: workspace.id,
              organizationSlug: workspace.slug
            }
          }),
          runtime.env.authContextTimeoutMs
        );

        return {
          activeWorkspaceId: workspace.id,
          workspace
        };
      },
      {
        body: t.Object({
          workspaceId: t.String()
        })
      }
    )
    .all('/auth', ({ request }) => auth.auth.handler(request))
    .all('/auth/*', ({ request }) => auth.auth.handler(request));

  return Object.assign(app, { runtime }) as unknown as ApiApp;
}
