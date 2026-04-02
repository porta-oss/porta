import { randomUUID } from 'node:crypto';

import { cors } from '@elysiajs/cors';
import { asc, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import type { StartupDraft } from '@shared/types';

import { createAuthRuntime, createWorkspaceSlug, type ApiAuthRuntime } from './auth';
import { createApiDatabase, type ApiDatabase } from './db/index';
import { startup as startupTable } from './db/schema/startup';
import { type ApiEnv, readApiEnv } from './lib/env';
import {
  createStartupRouteContract,
  sanitizeStartupDraft,
  serializeStartupRecord,
  validateStartupDraft
} from './routes/startup';

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

class RequestTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms.`);
    this.name = 'RequestTimeoutError';
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new RequestTimeoutError(label, timeoutMs)), timeoutMs);
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
    const session = await withTimeout(
      authApi.getSession({ headers: request.headers }),
      runtime.env.authContextTimeoutMs,
      'Session context'
    );

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
    if (error instanceof RequestTimeoutError) {
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
  const workspaces = await withTimeout(
    authApi.listOrganizations({ headers: request.headers }),
    runtime.env.authContextTimeoutMs,
    'Workspace lookup'
  );

  if (!Array.isArray(workspaces)) {
    return [];
  }

  return workspaces.map(normalizeWorkspace).filter((workspace): workspace is WorkspaceRecord => workspace !== null);
}

async function resolveActiveWorkspace(
  runtime: ApiRuntime,
  request: Request,
  authContext: RequestAuthContext,
  set: { status?: number | string },
  path: string
): Promise<
  | {
      auth: Extract<RequestAuthContext, { status: 'authenticated' }>;
      workspace: WorkspaceRecord;
    }
  | {
      error: {
        code: string;
        message: string;
      };
    }
> {
  const denied = rejectProtectedRequest(authContext, set, path);

  if ('error' in denied) {
    return denied;
  }

  if (!denied.activeWorkspaceId) {
    set.status = 409;
    console.warn('[startup] workspace context missing', {
      path,
      userId: denied.user.id
    });

    return {
      error: {
        code: 'ACTIVE_WORKSPACE_REQUIRED',
        message: 'Create or select a workspace before continuing startup onboarding.'
      }
    };
  }

  const workspaces = await listWorkspaceRecords(runtime, request);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === denied.activeWorkspaceId);

  if (!activeWorkspace) {
    set.status = 403;
    console.warn('[startup] workspace scope invalid', {
      path,
      userId: denied.user.id,
      activeWorkspaceId: denied.activeWorkspaceId
    });

    return {
      error: {
        code: 'WORKSPACE_SCOPE_INVALID',
        message: 'The active workspace is unavailable for this session. Return to workspace setup and choose a valid workspace.'
      }
    };
  }

  return {
    auth: denied,
    workspace: activeWorkspace
  };
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function getPgErrorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === 'string') {
    return error.code;
  }

  if (isRecord(error) && 'cause' in error) {
    return getPgErrorCode(error.cause);
  }

  return undefined;
}

function getPgErrorDetail(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.detail === 'string') {
    return error.detail;
  }

  if (isRecord(error) && 'cause' in error) {
    return getPgErrorDetail(error.cause);
  }

  return undefined;
}

async function listStartupsByWorkspace(runtime: ApiRuntime, workspaceId: string) {
  return withTimeout(
    runtime.db.db.select().from(startupTable).where(eq(startupTable.workspaceId, workspaceId)).orderBy(asc(startupTable.createdAt)),
    runtime.env.authContextTimeoutMs,
    'Startup list query'
  );
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
        tables: ['user', 'session', 'account', 'verification', 'workspace', 'member', 'invitation', 'startup']
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
            runtime.env.authContextTimeoutMs,
            'Workspace creation'
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
          runtime.env.authContextTimeoutMs,
          'Workspace activation'
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
          runtime.env.authContextTimeoutMs,
          'Active workspace lookup'
        )
      );

      const member = await withTimeout(
        authApi.getActiveMember({ headers: request.headers }),
        runtime.env.authContextTimeoutMs,
        'Active workspace membership lookup'
      );

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
          runtime.env.authContextTimeoutMs,
          'Active workspace switch'
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
    .get('/startups', async ({ authContext, request, set }) => {
      const activeWorkspace = await resolveActiveWorkspace(runtime, request, authContext, set, '/api/startups');

      if ('error' in activeWorkspace) {
        return activeWorkspace;
      }

      const startups = await listStartupsByWorkspace(runtime, activeWorkspace.workspace.id);

      return {
        workspace: activeWorkspace.workspace,
        startups: startups.map((row) =>
          serializeStartupRecord({
            ...row,
            createdAt: toDate(row.createdAt),
            updatedAt: toDate(row.updatedAt)
          })
        )
      };
    })
    .post(
      '/startups',
      async ({ authContext, body, request, set }) => {
        const activeWorkspace = await resolveActiveWorkspace(runtime, request, authContext, set, '/api/startups');

        if ('error' in activeWorkspace) {
          return activeWorkspace;
        }

        const draft = sanitizeStartupDraft({
          name: body.name,
          type: body.type,
          stage: body.stage,
          timezone: body.timezone,
          currency: body.currency
        } as StartupDraft);
        const validationError = validateStartupDraft(draft);

        if (validationError) {
          set.status = 400;
          console.warn('[startup] create validation failed', {
            workspaceId: activeWorkspace.workspace.id,
            code: validationError.code,
            field: validationError.field
          });

          return {
            error: validationError
          };
        }

        try {
          const createdRows = await withTimeout(
            runtime.db.db
              .insert(startupTable)
              .values({
                id: randomUUID(),
                workspaceId: activeWorkspace.workspace.id,
                name: draft.name,
                type: draft.type,
                stage: draft.stage,
                timezone: draft.timezone,
                currency: draft.currency
              })
              .returning(),
            runtime.env.authContextTimeoutMs,
            'Startup creation'
          );
          const createdRow = createdRows[0];

          if (!createdRow) {
            set.status = 502;
            console.error('[startup] create malformed', {
              workspaceId: activeWorkspace.workspace.id
            });

            return {
              error: {
                code: 'STARTUP_CREATE_MALFORMED',
                message: 'Startup creation returned an unexpected payload.'
              }
            };
          }

          const startups = await listStartupsByWorkspace(runtime, activeWorkspace.workspace.id);

          set.status = 201;
          return {
            workspace: activeWorkspace.workspace,
            startup: serializeStartupRecord({
              ...createdRow,
              createdAt: toDate(createdRow.createdAt),
              updatedAt: toDate(createdRow.updatedAt)
            }),
            startups: startups.map((row) =>
              serializeStartupRecord({
                ...row,
                createdAt: toDate(row.createdAt),
                updatedAt: toDate(row.updatedAt)
              })
            )
          };
        } catch (error) {
          if (error instanceof RequestTimeoutError) {
            set.status = 503;
            console.warn('[startup] create timed out', {
              workspaceId: activeWorkspace.workspace.id
            });

            return {
              error: {
                code: 'STARTUP_CREATE_TIMEOUT',
                message: 'Startup creation timed out. Please retry without leaving the form.'
              }
            };
          }

          const pgErrorCode = getPgErrorCode(error);
          const pgErrorDetail = getPgErrorDetail(error);

          if (pgErrorCode === '23505') {
            set.status = 409;
            console.warn('[startup] duplicate create prevented', {
              workspaceId: activeWorkspace.workspace.id,
              detail: pgErrorDetail
            });

            return {
              error: {
                code: 'STARTUP_ALREADY_EXISTS',
                message: 'A startup with this name already exists in the active workspace.'
              }
            };
          }

          if (pgErrorCode === '23514') {
            set.status = 400;
            console.warn('[startup] persistence validation failed', {
              workspaceId: activeWorkspace.workspace.id,
              detail: pgErrorDetail
            });

            return {
              error: {
                code: 'STARTUP_PERSISTENCE_INVALID',
                message: 'Startup data failed database validation. Review the onboarding values and retry.'
              }
            };
          }

          set.status = 500;
          console.error('[startup] create failed', {
            workspaceId: activeWorkspace.workspace.id,
            error: error instanceof Error ? error.message : String(error)
          });

          return {
            error: {
              code: 'STARTUP_CREATE_FAILED',
              message: 'Startup creation failed. Please retry from the onboarding form.'
            }
          };
        }
      },
      {
        body: t.Object({
          name: t.String(),
          type: t.String(),
          stage: t.String(),
          timezone: t.String(),
          currency: t.String()
        })
      }
    )
    .all('/auth', ({ request }) => auth.auth.handler(request))
    .all('/auth/*', ({ request }) => auth.auth.handler(request));

  return Object.assign(app, { runtime }) as unknown as ApiApp;
}
