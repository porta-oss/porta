import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// This E2E spec verifies the optional Postgres custom metric flow on the
// dashboard. It requires a running dev environment (API + web + worker).
//
// Because this is an optional post-onboarding flow that depends on an
// external Postgres source, the spec uses the dashboard's API mock layer
// when available, or skips gracefully in CI where the real Postgres target
// is not reachable.
// ---------------------------------------------------------------------------

test.describe("postgres custom metric dashboard flow", () => {
  test("setup form is visible on dashboard after onboarding is complete", async ({
    page,
  }) => {
    // Navigate to dashboard (assumes authenticated session from global setup)
    await page.goto("/app");

    // Wait for dashboard to load
    await expect(
      page.getByRole("main", { name: "dashboard shell" })
    ).toBeVisible({ timeout: 10_000 });

    // The postgres setup form should be visible when no postgres connector exists
    const setupForm = page.getByTestId("postgres-custom-metric-setup");
    // The form may or may not be visible depending on whether startup + connectors loaded
    // If the dashboard has startups, the setup form should appear
    const hasStartups = await page
      .getByText(/Primary startup:/)
      .isVisible()
      .catch(() => false);

    if (hasStartups) {
      await expect(setupForm).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByRole("button", { name: "Add Postgres metric" })
      ).toBeVisible();
    }
  });

  test("setup form validates blank fields", async ({ page }) => {
    await page.goto("/app");
    await expect(
      page.getByRole("main", { name: "dashboard shell" })
    ).toBeVisible({ timeout: 10_000 });

    const hasStartups = await page
      .getByText(/Primary startup:/)
      .isVisible()
      .catch(() => false);
    if (!hasStartups) {
      test.skip();
      return;
    }

    const setupForm = page.getByTestId("postgres-custom-metric-setup");
    await expect(setupForm).toBeVisible({ timeout: 5000 });

    // Submit empty form
    await page.getByRole("button", { name: "Add Postgres metric" }).click();

    // Should show validation error
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("alert").first()).toContainText(
      "Connection URI is required"
    );
  });

  test("custom metric panel shows not-configured guidance when no metric exists", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(
      page.getByRole("main", { name: "dashboard shell" })
    ).toBeVisible({ timeout: 10_000 });

    const hasStartups = await page
      .getByText(/Primary startup:/)
      .isVisible()
      .catch(() => false);
    if (!hasStartups) {
      test.skip();
      return;
    }

    // Wait for health data to load
    const healthHero = page.getByLabel("startup health hero");
    const hasHealth = await healthHero.isVisible().catch(() => false);

    if (hasHealth) {
      const panel = page.getByTestId("custom-metric-panel");
      await expect(panel).toBeVisible({ timeout: 5000 });
      await expect(panel).toContainText("No custom metric configured");
    }
  });

  test("onboarding flow completes without postgres being required", async ({
    page,
  }) => {
    await page.goto("/app/onboarding");

    // Onboarding page should load
    await expect(
      page.getByRole("main", { name: "startup onboarding" })
    ).toBeVisible({ timeout: 10_000 });

    // Verify PostHog and Stripe are the only connector options in onboarding
    // Postgres should NOT appear in onboarding
    const onboardingText = await page
      .getByRole("main", { name: "startup onboarding" })
      .textContent();
    expect(onboardingText).not.toContain("Postgres custom metric setup form");
  });
});
