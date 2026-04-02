import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants — must match the demo credentials in T01/T02 proof validators
// ---------------------------------------------------------------------------

export const POSTHOG_DEMO_API_KEY = "phx_founder_proof_demo_key";
export const POSTHOG_DEMO_PROJECT_ID = "proof-project-1";
export const POSTHOG_DEMO_HOST = "https://proof.posthog.local";
export const STRIPE_DEMO_SECRET_KEY = "sk_test_founder_proof_demo_key";

export const API_URL = "http://localhost:3000";
export const WEB_URL = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Magic-link helper — polls the dev endpoint for a magic link delivery
// ---------------------------------------------------------------------------

export async function fetchLatestMagicLink(
  request: APIRequestContext,
  email: string,
  opts?: { maxAttempts?: number; intervalMs?: number }
): Promise<string> {
  const maxAttempts = opts?.maxAttempts ?? 20;
  const intervalMs = opts?.intervalMs ?? 250;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await request.get(
      `${API_URL}/api/dev/magic-links/latest?email=${encodeURIComponent(email)}`
    );

    if (response.ok()) {
      const payload = (await response.json()) as {
        delivery?: { url?: string };
      };

      if (payload.delivery?.url) {
        return payload.delivery.url;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `No dev magic link was observed for ${email} after ${maxAttempts} attempts.`
  );
}

// ---------------------------------------------------------------------------
// Sign-in helper — posts magic link request then navigates
// ---------------------------------------------------------------------------

export async function signInFounder(
  page: Page,
  email: string,
  name = "Founder"
): Promise<void> {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.getByRole("main", { name: "sign-in page" })).toBeVisible();

  const signInResponse = await page.request.post(
    `${API_URL}/api/auth/sign-in/magic-link`,
    {
      data: {
        email,
        name,
        callbackURL: `${WEB_URL}/app`,
        errorCallbackURL: `${WEB_URL}/auth/sign-in`,
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
}

// ---------------------------------------------------------------------------
// Onboarding helper — creates workspace + startup
// ---------------------------------------------------------------------------

export async function completeOnboarding(
  page: Page,
  workspaceName: string,
  startupName: string
): Promise<void> {
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);

  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByText(`The first startup will be created inside ${workspaceName}.`)
  ).toBeVisible();

  await page.getByLabel("Startup name").fill(startupName);
  await page.getByRole("button", { name: "Create startup" }).click();
  await expect(page.getByText("Connect data sources")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Connector helper — fills in founder-proof demo credentials
// ---------------------------------------------------------------------------

export async function connectFounderProofProviders(page: Page): Promise<void> {
  // Connect PostHog with demo credentials
  const posthogForm = page.getByRole("form", { name: "PostHog setup form" });
  await expect(posthogForm).toBeVisible();
  await posthogForm.getByLabel("API key").fill(POSTHOG_DEMO_API_KEY);
  await posthogForm.getByLabel("Project ID").fill(POSTHOG_DEMO_PROJECT_ID);
  // Host field defaults to empty (resolves to us.posthog.com) — proof mode needs the demo host
  await posthogForm.getByLabel("Host (optional)").fill(POSTHOG_DEMO_HOST);
  await posthogForm.getByRole("button", { name: "Connect PostHog" }).click();
  // After connecting, the setup form disappears and the status panel shows PostHog
  // Status may be 'Syncing…' (pending) or 'Connected' depending on worker timing
  await expect(
    page.getByLabel("connector status").getByText("PostHog")
  ).toBeVisible({ timeout: 10_000 });

  // Connect Stripe with demo credentials
  const stripeForm = page.getByRole("form", { name: "Stripe setup form" });
  await expect(stripeForm).toBeVisible();
  await stripeForm.getByLabel("Secret key").fill(STRIPE_DEMO_SECRET_KEY);
  await stripeForm.getByRole("button", { name: "Connect Stripe" }).click();
  // Both connectors should now be visible in the status panel
  await expect(
    page.getByLabel("connector status").getByText("Stripe")
  ).toBeVisible({ timeout: 10_000 });

  // Finish onboarding → dashboard
  await expect(page.getByText("Data sources configured")).toBeVisible();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("main", { name: "portfolio dashboard" })
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// Polling helpers — wait for async dashboard surfaces to reach ready state
// ---------------------------------------------------------------------------

export async function waitForHealthReady(
  page: Page,
  timeoutMs = 30_000
): Promise<void> {
  await expect(page.getByLabel("startup health hero")).toBeVisible({
    timeout: timeoutMs,
  });
  await expect(page.getByText("Monthly Recurring Revenue")).toBeVisible({
    timeout: timeoutMs,
  });
}

export async function waitForInsightReady(
  page: Page,
  timeoutMs = 30_000
): Promise<void> {
  const card = page.getByTestId("startup-insight-card");
  await expect(card).toBeVisible({ timeout: timeoutMs });

  // On first run, there's no previous MRR data so the condition detector returns
  // 'no_condition_detected'. The insight card renders in the 'unavailable' state
  // with the diagnostic text. This is the correct first-run behavior.
  // Accept either a condition code (subsequent runs) or the unavailable state (first run).
  const conditionOrUnavailable = page
    .getByTestId("insight-condition")
    .or(page.getByTestId("insight-unavailable"));
  await expect(conditionOrUnavailable.first()).toBeVisible({
    timeout: timeoutMs,
  });
}

export async function waitForConnectorStatus(
  page: Page,
  timeoutMs = 10_000
): Promise<void> {
  const section = page.getByLabel("connector status");
  await expect(section).toBeVisible({ timeout: timeoutMs });
  await expect(section.getByText("PostHog")).toBeVisible();
  await expect(section.getByText("Stripe")).toBeVisible();
}
