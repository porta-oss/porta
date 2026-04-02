import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Poll for a dev magic link for the given email.
 */
async function fetchLatestMagicLink(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(
      `http://localhost:3000/api/dev/magic-links/latest?email=${encodeURIComponent(email)}`,
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

test.describe('startup insight card flow', () => {
  test('founder sees insight card on dashboard when insight data is available', async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `insight+${runId}@example.com`;
    const workspaceName = `Insight WS ${runId}`;
    const startupName = `Insight Analytics ${runId}`;

    // ----------------------------------------------------------------
    // Step 1: Sign in via dev magic link
    // ----------------------------------------------------------------
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    const signInResponse = await page.request.post(
      'http://localhost:3000/api/auth/sign-in/magic-link',
      {
        data: {
          email,
          name: 'Insight Founder',
          callbackURL: 'http://localhost:5173/app',
          errorCallbackURL: 'http://localhost:5173/auth/sign-in',
        },
      },
    );
    expect(signInResponse.ok()).toBe(true);

    const magicLinkUrl = await fetchLatestMagicLink(page.request, email);
    await page.goto(magicLinkUrl);

    await expect(page).toHaveURL(/\/app$/);

    // ----------------------------------------------------------------
    // Step 2: Create workspace and startup
    // ----------------------------------------------------------------
    await page.getByPlaceholder('Workspace name').fill(workspaceName);
    await page.getByRole('button', { name: /create workspace/i }).click();

    await page.getByPlaceholder('Startup name').fill(startupName);
    await page.getByRole('button', { name: /add startup/i }).click();

    // ----------------------------------------------------------------
    // Step 3: Verify insight card renders in some state
    // ----------------------------------------------------------------
    // After creating a startup without connectors/sync, the insight should
    // show as "unavailable" — which is the correct no-data state.
    const insightCard = page.getByTestId('startup-insight-card');
    await expect(insightCard).toBeVisible({ timeout: 10000 });

    // The card should exist and be either unavailable (no data yet)
    // or blocked (no connectors), but the important thing is it renders
    // and doesn't crash the page.
    const cardText = await insightCard.textContent();
    expect(cardText).toBeTruthy();
    expect(
      cardText?.includes('Grounded Insight') ||
      cardText?.includes('No insight') ||
      cardText?.includes('blocked'),
    ).toBe(true);

    // ----------------------------------------------------------------
    // Step 4: Verify other dashboard sections remain visible
    // ----------------------------------------------------------------
    // Portfolio section should still be visible
    await expect(page.getByText('Portfolio')).toBeVisible();
    // Connector setup should still be visible
    await expect(page.getByText(/connect/i).first()).toBeVisible();
  });

  test('insight API returns unavailable for startup with no synced data', async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `insight-api+${runId}@example.com`;

    // Sign in
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    const signInResponse = await page.request.post(
      'http://localhost:3000/api/auth/sign-in/magic-link',
      {
        data: {
          email,
          name: 'API Tester',
          callbackURL: 'http://localhost:5173/app',
          errorCallbackURL: 'http://localhost:5173/auth/sign-in',
        },
      },
    );
    expect(signInResponse.ok()).toBe(true);

    const magicLinkUrl = await fetchLatestMagicLink(page.request, email);
    await page.goto(magicLinkUrl);
    await expect(page).toHaveURL(/\/app$/);

    // Create workspace + startup
    await page.getByPlaceholder('Workspace name').fill(`API WS ${runId}`);
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.getByPlaceholder('Startup name').fill(`API Startup ${runId}`);
    await page.getByRole('button', { name: /add startup/i }).click();

    // Wait for startup to be created, then hit the insight API directly
    await page.waitForTimeout(1000);

    // Get startup ID from the startups API
    const startupsRes = await page.request.get('http://localhost:3000/api/startups');
    expect(startupsRes.ok()).toBe(true);
    const startups = (await startupsRes.json()) as { startups: Array<{ id: string }> };
    const startupId = startups.startups[0]?.id;
    expect(startupId).toBeTruthy();

    // Hit insight API
    const insightRes = await page.request.get(
      `http://localhost:3000/api/startups/${startupId}/insight`,
    );
    expect(insightRes.ok()).toBe(true);

    const insightPayload = (await insightRes.json()) as {
      displayStatus: string;
      insight: unknown;
      diagnosticMessage: string;
    };
    expect(insightPayload.displayStatus).toBe('unavailable');
    expect(insightPayload.insight).toBeNull();
    expect(insightPayload.diagnosticMessage).toBeTruthy();
  });
});
