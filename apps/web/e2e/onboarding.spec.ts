import { expect, test, type APIRequestContext } from '@playwright/test';

async function fetchLatestMagicLink(request: APIRequestContext, email: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`http://localhost:3000/api/dev/magic-links/latest?email=${encodeURIComponent(email)}`);

    if (response.ok()) {
      const payload = (await response.json()) as {
        delivery?: {
          url?: string;
        };
      };

      if (payload.delivery?.url) {
        return payload.delivery.url;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No dev magic link was observed for ${email}.`);
}

test.describe('founder onboarding flow', () => {
  test('signs in with a dev magic link, finishes onboarding, and lands in the authenticated shell', async ({ page }) => {
    const runId = Date.now();
    const email = `founder+${runId}@example.com`;
    const workspaceName = `Acme Ventures ${runId}`;
    const startupName = `Acme Analytics ${runId}`;

    await page.goto('/app');

    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await expect(page.getByRole('main', { name: 'sign-in page' })).toBeVisible();

    const signInResponse = await page.request.post('http://localhost:3000/api/auth/sign-in/magic-link', {
      data: {
        email,
        name: 'Founder',
        callbackURL: 'http://localhost:5173/app',
        errorCallbackURL: 'http://localhost:5173/auth/sign-in'
      }
    });
    expect(signInResponse.ok()).toBe(true);

    const magicLinkUrl = await fetchLatestMagicLink(page.request, email);
    await page.goto(magicLinkUrl);

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('main', { name: 'dashboard shell' })).toBeVisible();
    await expect(page.getByText('Create or select a workspace before the dashboard can load scoped product data.')).toBeVisible();
    await expect(page.getByText('The dashboard shell is ready, but startup navigation stays locked until a workspace becomes active.')).toBeVisible();

    await page.getByRole('link', { name: 'Open workspace onboarding' }).click();

    await expect(page).toHaveURL(/\/app\/onboarding$/);
    await page.getByLabel('Workspace name').fill(workspaceName);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByText(`The first startup will be created inside ${workspaceName}.`)).toBeVisible();

    await page.getByLabel('Startup name').fill(startupName);
    await page.getByRole('button', { name: 'Create startup' }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(`Workspace ${workspaceName} is mounted inside the authenticated shell.`)).toBeVisible();
    await expect(page.getByLabel('startup list').getByText(startupName)).toBeVisible();
    await expect(page.getByText(/Primary startup:/)).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(`Workspace ${workspaceName} is mounted inside the authenticated shell.`)).toBeVisible();
    await expect(page.getByLabel('startup list').getByText(startupName)).toBeVisible();
  });
});
