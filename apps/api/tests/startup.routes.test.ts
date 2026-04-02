import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";

import { type ApiApp, createApiApp } from "../src/app";

const TEST_ENV = {
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL:
    "postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  CONNECTOR_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  MAGIC_LINK_SENDER_EMAIL: "dev@founder-control-plane.local",
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "5",
} as const;

const VALID_STARTUP: StartupDraft = {
  name: "Acme Analytics",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

let app: ApiApp;

beforeAll(async () => {
  app = await createApiApp(TEST_ENV);
});

beforeEach(async () => {
  app.runtime.auth.resetMagicLinks();
  await app.runtime.db.resetAuthTables();
});

afterAll(async () => {
  await app.runtime.db.close();
});

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
) {
  const headers = new Headers();

  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function createAuthenticatedSession(email = "founder@example.com") {
  const signInResponse = await send("/api/auth/sign-in/magic-link", {
    method: "POST",
    body: {
      email,
      name: "Founder",
    },
  });

  expect(signInResponse.status).toBe(200);
  const magicLink = app.runtime.auth.getLatestMagicLink(email);
  expect(magicLink).toBeDefined();

  // biome-ignore lint/style/noNonNullAssertion: expect() above guarantees magicLink is defined
  const verifyResponse = await app.handle(new Request(magicLink!.url));
  const cookie =
    convertSetCookieToCookie(verifyResponse.headers).get("cookie") ?? "";

  expect(cookie.length).toBeGreaterThan(0);

  return { cookie };
}

async function createWorkspace(cookie: string, name: string) {
  const response = await send("/api/workspaces", {
    method: "POST",
    cookie,
    body: { name },
  });
  const payload = await parseJson(response);

  expect(response.status).toBe(201);

  return payload.workspace as { id: string; name: string; slug: string };
}

async function setActiveWorkspace(cookie: string, workspaceId: string) {
  const response = await send("/api/workspaces/active", {
    method: "POST",
    cookie,
    body: { workspaceId },
  });

  expect(response.status).toBe(200);
}

describe("startup routes", () => {
  test("reject unauthenticated startup access and require an active workspace for authenticated founders", async () => {
    const unauthenticatedCreate = await send("/api/startups", {
      method: "POST",
      body: VALID_STARTUP,
    });
    const unauthenticatedCreatePayload = await parseJson(unauthenticatedCreate);

    expect(unauthenticatedCreate.status).toBe(401);
    expect(unauthenticatedCreatePayload.error).toMatchObject({
      code: "AUTH_REQUIRED",
    });

    const { cookie } = await createAuthenticatedSession();

    const noWorkspaceList = await send("/api/startups", { cookie });
    const noWorkspaceListPayload = await parseJson(noWorkspaceList);

    expect(noWorkspaceList.status).toBe(409);
    expect(noWorkspaceListPayload.error).toMatchObject({
      code: "ACTIVE_WORKSPACE_REQUIRED",
    });
  });

  test("validate malformed startup inputs before persistence", async () => {
    const { cookie } = await createAuthenticatedSession(
      "validation@example.com"
    );
    await createWorkspace(cookie, "Validation Workspace");

    const blankName = await send("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, name: "   " },
    });
    const blankNamePayload = await parseJson(blankName);

    expect(blankName.status).toBe(400);
    expect(blankNamePayload.error).toMatchObject({
      code: "STARTUP_NAME_REQUIRED",
      field: "name",
    });

    const invalidStage = await send("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, stage: "late-stage" },
    });
    const invalidStagePayload = await parseJson(invalidStage);

    expect(invalidStage.status).toBe(400);
    expect(invalidStagePayload.error).toMatchObject({
      code: "STARTUP_STAGE_INVALID",
      field: "stage",
    });

    const invalidTimezone = await send("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, timezone: "Mars/Olympus" },
    });
    const invalidTimezonePayload = await parseJson(invalidTimezone);

    expect(invalidTimezone.status).toBe(400);
    expect(invalidTimezonePayload.error).toMatchObject({
      code: "STARTUP_TIMEZONE_INVALID",
      field: "timezone",
    });

    const invalidCurrency = await send("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, currency: "JPY" },
    });
    const invalidCurrencyPayload = await parseJson(invalidCurrency);

    expect(invalidCurrency.status).toBe(400);
    expect(invalidCurrencyPayload.error).toMatchObject({
      code: "STARTUP_CURRENCY_INVALID",
      field: "currency",
    });

    const invalidType = await send("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, type: "marketplace" },
    });
    const invalidTypePayload = await parseJson(invalidType);

    expect(invalidType.status).toBe(400);
    expect(invalidTypePayload.error).toMatchObject({
      code: "STARTUP_TYPE_INVALID",
      field: "type",
    });
  });

  test("create and list startups within the active workspace, preventing repeated submissions from duplicating state", async () => {
    const { cookie } = await createAuthenticatedSession("owner@example.com");
    const workspace = await createWorkspace(cookie, "Acme Labs");

    const createResponse = await send("/api/startups", {
      method: "POST",
      cookie,
      body: VALID_STARTUP,
    });
    const createPayload = await parseJson(createResponse);

    expect(createResponse.status).toBe(201);
    expect(createPayload.workspace).toMatchObject({
      id: workspace.id,
      name: "Acme Labs",
    });
    expect(createPayload.startup).toMatchObject({
      workspaceId: workspace.id,
      name: "Acme Analytics",
      type: "b2b_saas",
    });
    expect((createPayload.startups as unknown[]).length).toBe(1);

    const duplicateResponse = await send("/api/startups", {
      method: "POST",
      cookie,
      body: VALID_STARTUP,
    });
    const duplicatePayload = await parseJson(duplicateResponse);

    expect(duplicateResponse.status).toBe(409);
    expect(duplicatePayload.error).toMatchObject({
      code: "STARTUP_ALREADY_EXISTS",
    });

    const listResponse = await send("/api/startups", { cookie });
    const listPayload = await parseJson(listResponse);

    expect(listResponse.status).toBe(200);
    expect(listPayload.workspace).toMatchObject({
      id: workspace.id,
      name: "Acme Labs",
    });
    expect(listPayload.startups).toMatchObject([
      {
        workspaceId: workspace.id,
        name: "Acme Analytics",
        type: "b2b_saas",
      },
    ]);
  });

  test("isolate startup reads and writes per active workspace and fail closed on cross-workspace access attempts", async () => {
    const { cookie } = await createAuthenticatedSession(
      "multi-workspace@example.com"
    );
    const firstWorkspace = await createWorkspace(cookie, "Acme Labs");

    await send("/api/startups", {
      method: "POST",
      cookie,
      body: VALID_STARTUP,
    });

    const secondWorkspace = await createWorkspace(cookie, "Beta Labs");
    const secondListResponse = await send("/api/startups", { cookie });
    const secondListPayload = await parseJson(secondListResponse);

    expect(secondListResponse.status).toBe(200);
    expect(secondListPayload.workspace).toMatchObject({
      id: secondWorkspace.id,
      name: "Beta Labs",
    });
    expect(secondListPayload.startups).toEqual([]);

    const secondCreateResponse = await send("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, name: "Beta Analytics" },
    });
    const secondCreatePayload = await parseJson(secondCreateResponse);

    expect(secondCreateResponse.status).toBe(201);
    expect(secondCreatePayload.startup).toMatchObject({
      workspaceId: secondWorkspace.id,
      name: "Beta Analytics",
    });

    await setActiveWorkspace(cookie, firstWorkspace.id);

    const firstListResponse = await send("/api/startups", { cookie });
    const firstListPayload = await parseJson(firstListResponse);

    expect(firstListResponse.status).toBe(200);
    expect(firstListPayload.workspace).toMatchObject({
      id: firstWorkspace.id,
      name: "Acme Labs",
    });
    expect(firstListPayload.startups).toMatchObject([
      {
        workspaceId: firstWorkspace.id,
        name: "Acme Analytics",
      },
    ]);

    const outsider = await createAuthenticatedSession("outsider@example.com");
    const outsiderSetActive = await send("/api/workspaces/active", {
      method: "POST",
      cookie: outsider.cookie,
      body: { workspaceId: firstWorkspace.id },
    });
    const outsiderSetActivePayload = await parseJson(outsiderSetActive);

    expect(outsiderSetActive.status).toBe(404);
    expect(outsiderSetActivePayload.error).toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });

    const outsiderStartupList = await send("/api/startups", {
      cookie: outsider.cookie,
    });
    const outsiderStartupListPayload = await parseJson(outsiderStartupList);

    expect(outsiderStartupList.status).toBe(409);
    expect(outsiderStartupListPayload.error).toMatchObject({
      code: "ACTIVE_WORKSPACE_REQUIRED",
    });
  });
});
