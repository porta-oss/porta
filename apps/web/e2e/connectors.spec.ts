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

test.describe("connector setup and status flow", () => {
  test("founder connects PostHog and Stripe during onboarding, sees status on dashboard", async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `connector+${runId}@example.com`;
    const workspaceName = `Connector Ventures ${runId}`;
    const startupName = `Connector Analytics ${runId}`;

    // ----------------------------------------------------------------
    // Step 1: Sign in via dev magic link
    // ----------------------------------------------------------------
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await expect(
      page.getByRole("main", { name: "sign-in page" })
    ).toBeVisible();

    const signInResponse = await page.request.post(
      "http://localhost:3000/api/auth/sign-in/magic-link",
      {
        data: {
          email,
          name: "Founder",
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
      page.getByRole("main", { name: "dashboard shell" })
    ).toBeVisible();

    // ----------------------------------------------------------------
    // Step 2: Create workspace + startup via onboarding
    // ----------------------------------------------------------------
    await page.getByRole("link", { name: "Open workspace onboarding" }).click();
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

    // After creating a startup, onboarding should show the connector setup step
    await expect(page.getByText("Connect data sources")).toBeVisible();

    // ----------------------------------------------------------------
    // Step 3: Connect PostHog
    // ----------------------------------------------------------------
    const posthogForm = page.getByRole("form", { name: "PostHog setup form" });
    await expect(posthogForm).toBeVisible();

    await posthogForm.getByLabel("API key").fill("phx_e2e_test_key");
    await posthogForm.getByLabel("Project ID").fill("12345");
    // Host is optional, leave default

    await posthogForm.getByRole("button", { name: "Connect PostHog" }).click();

    // PostHog should now show as connected
    await expect(page.getByText("Connected").first()).toBeVisible({
      timeout: 10_000,
    });

    // ----------------------------------------------------------------
    // Step 4: Connect Stripe
    // ----------------------------------------------------------------
    const stripeForm = page.getByRole("form", { name: "Stripe setup form" });
    await expect(stripeForm).toBeVisible();

    await stripeForm.getByLabel("Secret key").fill("sk_test_e2e_key_abc");
    await stripeForm.getByRole("button", { name: "Connect Stripe" }).click();

    // Both should be connected now
    await expect(page.getByText("Connected").nth(1)).toBeVisible({
      timeout: 10_000,
    });

    // ----------------------------------------------------------------
    // Step 5: Finish onboarding → dashboard
    // ----------------------------------------------------------------
    await expect(page.getByText("Data sources configured")).toBeVisible();
    await page.getByRole("button", { name: "Continue to dashboard" }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("main", { name: "dashboard shell" })
    ).toBeVisible();
    await expect(page.getByText("Primary startup:")).toBeVisible();

    // ----------------------------------------------------------------
    // Step 6: Verify connector status panels on dashboard
    // ----------------------------------------------------------------
    const connectorSection = page.getByLabel("connector status");
    await expect(connectorSection).toBeVisible({ timeout: 10_000 });

    // Both providers should be visible
    await expect(connectorSection.getByText("PostHog")).toBeVisible();
    await expect(connectorSection.getByText("Stripe")).toBeVisible();

    // ----------------------------------------------------------------
    // Step 7: Verify state survives page reload
    // ----------------------------------------------------------------
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByLabel("connector status")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByLabel("connector status").getByText("PostHog")
    ).toBeVisible();
    await expect(
      page.getByLabel("connector status").getByText("Stripe")
    ).toBeVisible();
  });

  test("founder skips connectors during onboarding and adds them from dashboard", async ({
    page,
  }) => {
    const runId = Date.now() + 1;
    const email = `skip+${runId}@example.com`;
    const workspaceName = `Skip WS ${runId}`;
    const startupName = `Skip Startup ${runId}`;

    // Sign in
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    const signInResponse = await page.request.post(
      "http://localhost:3000/api/auth/sign-in/magic-link",
      {
        data: {
          email,
          name: "Skip Founder",
          callbackURL: "http://localhost:5173/app",
          errorCallbackURL: "http://localhost:5173/auth/sign-in",
        },
      }
    );
    expect(signInResponse.ok()).toBe(true);

    const magicLinkUrl = await fetchLatestMagicLink(page.request, email);
    await page.goto(magicLinkUrl);

    await expect(page).toHaveURL(/\/app$/);

    // Create workspace + startup
    await page.getByRole("link", { name: "Open workspace onboarding" }).click();
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

    // Skip both connectors
    await page.getByRole("button", { name: "Skip for now" }).first().click();
    await page.getByRole("button", { name: "Skip for now" }).first().click();

    // Connectors skipped message should appear
    await expect(page.getByText("Connectors skipped")).toBeVisible();
    await page.getByRole("button", { name: "Continue to dashboard" }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("main", { name: "dashboard shell" })
    ).toBeVisible();

    // Dashboard should show setup cards for missing connectors
    await expect(
      page.getByRole("form", { name: "PostHog setup form" })
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("form", { name: "Stripe setup form" })
    ).toBeVisible();

    // Connect PostHog from the dashboard
    const posthogForm = page.getByRole("form", { name: "PostHog setup form" });
    await posthogForm.getByLabel("API key").fill("phx_dashboard_key");
    await posthogForm.getByLabel("Project ID").fill("54321");
    await posthogForm.getByRole("button", { name: "Connect PostHog" }).click();

    // PostHog form should disappear and connector status should show
    await expect(
      page.getByLabel("connector status").getByText("PostHog")
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("client-side validation prevents blank PostHog API key submission", async ({
    page,
  }) => {
    const runId = Date.now() + 2;
    const email = `blank+${runId}@example.com`;
    const workspaceName = `Blank WS ${runId}`;
    const startupName = `Blank Startup ${runId}`;

    // Sign in
    await page.goto("/app");
    const signInResponse = await page.request.post(
      "http://localhost:3000/api/auth/sign-in/magic-link",
      {
        data: {
          email,
          name: "Blank Founder",
          callbackURL: "http://localhost:5173/app",
          errorCallbackURL: "http://localhost:5173/auth/sign-in",
        },
      }
    );
    expect(signInResponse.ok()).toBe(true);

    const magicLinkUrl = await fetchLatestMagicLink(page.request, email);
    await page.goto(magicLinkUrl);
    await expect(page).toHaveURL(/\/app$/);

    // Create workspace + startup
    await page.getByRole("link", { name: "Open workspace onboarding" }).click();
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

    // Try to connect PostHog with blank API key
    const posthogForm = page.getByRole("form", { name: "PostHog setup form" });
    await posthogForm.getByRole("button", { name: "Connect PostHog" }).click();

    // Should show a client-side validation error
    await expect(posthogForm.getByRole("alert")).toBeVisible();
    await expect(posthogForm.getByRole("alert")).toContainText(
      "cannot be blank"
    );
  });
});
