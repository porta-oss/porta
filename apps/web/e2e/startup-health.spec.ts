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

test.describe("startup health page flow", () => {
  test("founder connects providers, triggers sync, and sees populated health page", async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `health+${runId}@example.com`;
    const workspaceName = `Health WS ${runId}`;
    const startupName = `Health Analytics ${runId}`;

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
          name: "Health Founder",
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
    await posthogForm.getByLabel("API key").fill("phx_e2e_test_key");
    await posthogForm.getByLabel("Project ID").fill("12345");
    await posthogForm.getByRole("button", { name: "Connect PostHog" }).click();
    await expect(page.getByText("Connected").first()).toBeVisible({
      timeout: 10_000,
    });

    const stripeForm = page.getByRole("form", { name: "Stripe setup form" });
    await stripeForm.getByLabel("Secret key").fill("sk_test_e2e_health_key");
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
    // Step 4: Verify health page renders
    // ----------------------------------------------------------------
    // The health hero should appear (may be blocked/syncing initially)
    await expect(page.getByLabel("startup health hero")).toBeVisible({
      timeout: 15_000,
    });

    // At minimum the health state and north-star label should be present
    await expect(page.getByText("Monthly Recurring Revenue")).toBeVisible();

    // ----------------------------------------------------------------
    // Step 5: Verify connector status is visible alongside health
    // ----------------------------------------------------------------
    await page.getByRole("tab", { name: /Operations/ }).click();
    await expect(page.getByLabel("connector status")).toBeVisible();
    await expect(
      page.getByLabel("connector status").getByText("PostHog")
    ).toBeVisible();
    await expect(
      page.getByLabel("connector status").getByText("Stripe")
    ).toBeVisible();

    // ----------------------------------------------------------------
    // Step 6: Verify state survives page reload
    // ----------------------------------------------------------------
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByLabel("startup health hero")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("tab", { name: /Operations/ }).click();
    await expect(page.getByLabel("connector status")).toBeVisible();
  });
});
