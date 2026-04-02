import { type APIRequestContext, expect, test } from "@playwright/test";

/**
 * Poll for a dev magic link for the given email.
 * Returns the URL from the magic link delivery.
 */
async function fetchLatestMagicLink(
  request: APIRequestContext,
  email: string
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(
      `http://localhost:3000/api/dev/magic-links/latest?email=${encodeURIComponent(email)}`
    );

    if (response.ok()) {
      const payload = (await response.json()) as {
        delivery?: { url?: string };
      };

      if (payload.delivery?.url) {
        return payload.delivery.url;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No dev magic link was observed for ${email}.`);
}

test.describe("portfolio prioritization surface", () => {
  test("founder signs in, completes onboarding, and sees the portfolio card with health, trend, freshness, top issue — survives reload", async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `portfolio+${runId}@example.com`;
    const workspaceName = `Portfolio WS ${runId}`;
    const startupName = `Portfolio Startup ${runId}`;

    // ----------------------------------------------------------------
    // Step 1: Sign in via dev magic link
    // ----------------------------------------------------------------
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    const signInResponse = await page.request.post(
      "http://localhost:3000/api/auth/sign-in/magic-link",
      {
        data: {
          email,
          name: "Portfolio Founder",
          callbackURL: "http://localhost:5173/app",
          errorCallbackURL: "http://localhost:5173/auth/sign-in",
        },
      }
    );
    expect(signInResponse.ok()).toBe(true);

    const magicLinkUrl = await fetchLatestMagicLink(page.request, email);
    await page.goto(magicLinkUrl);

    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("main", { name: "portfolio dashboard" })
    ).toBeVisible();

    // ----------------------------------------------------------------
    // Step 2: Create workspace + startup via onboarding
    // ----------------------------------------------------------------
    await page.getByRole("link", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);

    await page.getByLabel("Workspace name").fill(workspaceName);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(
      page.getByText(
        `The first startup will be created inside ${workspaceName}.`
      )
    ).toBeVisible();

    await page.getByLabel("Startup name").fill(startupName);
    await page.getByRole("button", { name: "Create startup" }).click();
    await expect(page.getByText("Connect data sources")).toBeVisible();

    // ----------------------------------------------------------------
    // Step 3: Connect PostHog + Stripe
    // ----------------------------------------------------------------
    const posthogForm = page.getByRole("form", { name: "PostHog setup form" });
    await posthogForm.getByLabel("API key").fill("phx_e2e_portfolio_key");
    await posthogForm.getByLabel("Project ID").fill("99999");
    await posthogForm.getByRole("button", { name: "Connect PostHog" }).click();
    await expect(page.getByText("Connected").first()).toBeVisible({
      timeout: 10_000,
    });

    const stripeForm = page.getByRole("form", { name: "Stripe setup form" });
    await stripeForm.getByLabel("Secret key").fill("sk_test_e2e_portfolio_key");
    await stripeForm.getByRole("button", { name: "Connect Stripe" }).click();
    await expect(page.getByText("Connected").nth(1)).toBeVisible({
      timeout: 10_000,
    });

    // Finish onboarding → dashboard
    await expect(page.getByText("Data sources configured")).toBeVisible();
    await page.getByRole("button", { name: "Continue to dashboard" }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("main", { name: "portfolio dashboard" })
    ).toBeVisible();

    // ----------------------------------------------------------------
    // Step 4: Assert portfolio-first layout
    // ----------------------------------------------------------------
    // Portfolio header should be the first content heading
    await expect(
      page.getByRole("heading", { name: "Portfolio overview" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Startup prioritization" })
    ).toBeVisible();

    // ----------------------------------------------------------------
    // Step 5: Assert portfolio card — health, trend, freshness, top issue
    // ----------------------------------------------------------------
    const card = page.getByTestId("portfolio-startup-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Startup name on the card
    await expect(page.getByTestId("portfolio-startup-name")).toContainText(
      startupName
    );

    // Health badge — should be present (any valid state)
    const badge = page.getByTestId("portfolio-badge");
    await expect(badge).toBeVisible();

    // North-star value should exist
    const northStar = page.getByTestId("portfolio-north-star");
    await expect(northStar).toBeVisible();

    // Freshness indicator
    const freshness = page.getByTestId("portfolio-freshness");
    await expect(freshness).toBeVisible();

    // Top issue
    const topIssue = page.getByTestId("portfolio-top-issue");
    await expect(topIssue).toBeVisible();

    // ----------------------------------------------------------------
    // Step 6: Verify health detail drill-down still renders
    // ----------------------------------------------------------------
    await expect(page.getByText("Health detail")).toBeVisible();
    await page.getByRole("tab", { name: /Operations/ }).click();
    await expect(page.getByLabel("connector status")).toBeVisible();

    // ----------------------------------------------------------------
    // Step 7: Verify state survives page reload
    // ----------------------------------------------------------------
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("heading", { name: "Portfolio overview" })
    ).toBeVisible();

    // Portfolio card reappears after reload
    await expect(page.getByTestId("portfolio-startup-card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portfolio-badge")).toBeVisible();
    await expect(page.getByTestId("portfolio-freshness")).toBeVisible();
    await expect(page.getByTestId("portfolio-top-issue")).toBeVisible();

    // Health detail still available
    await page.getByRole("tab", { name: /Operations/ }).click();
    await expect(page.getByLabel("connector status")).toBeVisible();
  });
});
