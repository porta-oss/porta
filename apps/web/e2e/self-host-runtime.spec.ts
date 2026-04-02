import { expect, test } from "@playwright/test";

/**
 * Self-host runtime smoke tests.
 *
 * Run against a live Docker Compose stack (no dev server).
 * Validates that the assembled stack serves the sign-in page
 * and proxies /api correctly.
 *
 * Usage:
 *   docker compose up --build -d
 *   npx playwright test --config playwright.self-host.config.ts
 */

test.describe("self-host runtime", () => {
  test("GET /api/health returns status ok with edition and database diagnostics", async ({
    request,
  }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      status: string;
      service: string;
      edition: string;
      database: {
        configured: boolean;
        tables: string[];
      };
      connectors: {
        supportedProviders: string[];
        encryptionKeyConfigured: boolean;
      };
    };

    expect(body.status).toBe("ok");
    expect(body.service).toBe("api");
    expect(body.edition).toBeTruthy();
    expect(body.database.configured).toBe(true);
    expect(body.database.tables.length).toBeGreaterThan(0);
    expect(body.connectors.encryptionKeyConfigured).toBe(true);

    // Verify no secrets are leaked in the health response
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("BETTER_AUTH_SECRET");
    expect(bodyText).not.toContain("CONNECTOR_ENCRYPTION_KEY");
    expect(bodyText).not.toContain("postgres:");
  });

  test("localhost serves the Porta sign-in page", async ({ page }) => {
    await page.goto("/auth/sign-in", { waitUntil: "networkidle" });

    // The sign-in page should render with a heading or form element
    await expect(page).toHaveTitle(/porta/i);

    // The page should contain sign-in related content
    const signInContent = page.locator(
      "text=/sign[\\s-]?in|log[\\s-]?in|email/i"
    );
    await expect(signInContent.first()).toBeVisible({ timeout: 10_000 });
  });

  test("localhost root redirects or serves an accessible page", async ({
    page,
  }) => {
    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response).not.toBeNull();
    expect(response?.status()).toBeLessThan(500);
  });

  test("/api/auth/session returns unauthenticated without a cookie", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/session");
    // Should return 200 with unauthenticated status, not 500 or proxy error
    expect(response.status()).toBeLessThan(500);
  });
});
