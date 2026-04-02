import "../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import type { AuthController, AuthSnapshot } from "../lib/auth-client";
import { AuthPendingShell, authenticatedRoute } from "./_authenticated";

function createSnapshot(overrides: Partial<AuthSnapshot> = {}): AuthSnapshot {
  return {
    status: "signed-out",
    session: null,
    error: null,
    diagnostic: "missing-session",
    lastResolvedAt: null,
    ...overrides,
  };
}

function createAuthenticatedSnapshot(): AuthSnapshot {
  return createSnapshot({
    status: "authenticated",
    diagnostic: "none",
    session: {
      user: {
        id: "user_123",
        email: "founder@example.com",
        name: "Founder",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
      },
      session: {
        id: "session_123",
        userId: "user_123",
        expiresAt: new Date(),
        activeOrganizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        token: "token_123",
        ipAddress: null,
        userAgent: null,
      },
    },
  });
}

function createTestAuthController(
  initialSnapshot = createSnapshot(),
  overrides: Partial<AuthController> = {}
) {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  const controller: AuthController = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bootstrapSession: overrides.bootstrapSession ?? mock(async () => snapshot),
    signInWithGoogle:
      overrides.signInWithGoogle ??
      mock(async () => {
        /* noop */
      }),
    signInWithMagicLink:
      overrides.signInWithMagicLink ??
      mock(async () => {
        /* noop */
      }),
    markSignedOut:
      overrides.markSignedOut ??
      mock(() => {
        snapshot = createSnapshot();
        for (const listener of listeners) {
          listener();
        }
      }),
  };

  return { controller };
}

async function runBeforeLoad(auth: AuthController, pathname = "/app") {
  const beforeLoad = authenticatedRoute.options.beforeLoad;

  if (!beforeLoad) {
    throw new Error("Expected authenticated route beforeLoad to be defined.");
  }

  return beforeLoad({
    context: { auth },
    location: { pathname },
  } as never);
}

afterEach(() => {
  cleanup();
});

describe("authenticated route guard", () => {
  test("redirects signed-out users to /auth/sign-in", async () => {
    const bootstrapSession = mock(async () =>
      createSnapshot({ diagnostic: "missing-session" })
    );
    const { controller } = createTestAuthController(createSnapshot(), {
      bootstrapSession,
    });

    try {
      await runBeforeLoad(controller);
      throw new Error(
        "Expected the authenticated route to redirect signed-out users."
      );
    } catch (error) {
      expect(error).toMatchObject({
        options: {
          to: "/auth/sign-in",
          search: {
            redirect: "/app",
          },
        },
      });
    }
  });

  test("shows a deterministic loading shell while the session bootstrap is pending", () => {
    const view = render(<AuthPendingShell />);

    expect(view.getByRole("main", { name: "auth bootstrap" })).toBeTruthy();
    expect(
      view.getByText(
        "The dashboard stays locked until the session bootstrap resolves."
      )
    ).toBeTruthy();
  });

  test("unlocks the guarded route tree for authenticated sessions", async () => {
    const authState = createAuthenticatedSnapshot();
    const bootstrapSession = mock(async () => authState);
    const { controller } = createTestAuthController(authState, {
      bootstrapSession,
    });

    await expect(runBeforeLoad(controller)).resolves.toMatchObject({
      authState,
    });
  });

  test("treats malformed session bootstrap results as unauthenticated and redirects safely", async () => {
    const malformedSignedOut = createSnapshot({
      status: "signed-out",
      diagnostic: "malformed-session",
    });
    const bootstrapSession = mock(async () => malformedSignedOut);
    const { controller } = createTestAuthController(createSnapshot(), {
      bootstrapSession,
    });

    try {
      await runBeforeLoad(controller);
      throw new Error(
        "Expected malformed session bootstrap to redirect safely."
      );
    } catch (error) {
      expect(error).toMatchObject({
        options: {
          to: "/auth/sign-in",
          search: {
            redirect: "/app",
          },
        },
      });
    }
  });
});
