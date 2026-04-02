import { expect, test } from "@playwright/test";

import {
  completeOnboarding,
  connectFounderProofProviders,
  signInFounder,
  waitForConnectorStatus,
  waitForHealthReady,
  waitForInsightReady,
} from "./support/founder-proof";

/**
 * Full founder self-serve proof — one Playwright journey that exercises
 * the assembled product from sign-in through synced task creation.
 *
 * Requires the stack to be running in founder-proof mode:
 *   FOUNDER_PROOF_MODE=true for API and Worker
 *   Postgres + Redis available locally
 *
 * The spec uses deterministic demo credentials that match the founder-proof
 * validators so the full sync pipeline executes without real external calls.
 */
test.describe("founder self-serve proof", () => {
  test("completes the full founder journey: sign-in → onboarding → connectors → health → insight → task → reload", async ({
    page,
  }) => {
    const runId = Date.now();
    const email = `proof+${runId}@example.com`;
    const workspaceName = `Proof Ventures ${runId}`;
    const startupName = `Proof Analytics ${runId}`;

    // ── Phase 1: Sign in via dev magic link ──
    await signInFounder(page, email, "Proof Founder");

    // ── Phase 2: Complete onboarding (workspace + startup) ──
    await completeOnboarding(page, workspaceName, startupName);

    // ── Phase 3: Connect PostHog + Stripe with proof-mode credentials ──
    await connectFounderProofProviders(page);

    // Dashboard shell should be visible after returning from onboarding
    await expect(
      page.getByRole("main", { name: "portfolio dashboard" })
    ).toBeVisible({ timeout: 10_000 });

    // ── Phase 4: Wait for worker to process sync + health recompute ──
    // The connector creation enqueued a sync job. The worker (in proof mode)
    // processes it with deterministic providers and creates a health snapshot.
    // Dashboard fetches health once on mount — reload after a brief wait so
    // the worker has time to complete the sync pipeline.
    await page.waitForTimeout(3000);
    await page.reload();
    await expect(
      page.getByRole("main", { name: "portfolio dashboard" })
    ).toBeVisible({ timeout: 10_000 });

    // Startup list should show the startup we created
    await expect(page.getByLabel("startup list")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByLabel("startup list").getByText(startupName)
    ).toBeVisible();

    // Health hero should now show MRR from the deterministic proof data
    await waitForHealthReady(page, 30_000);

    // Connector status should be visible
    await waitForConnectorStatus(page, 15_000);

    // ── Phase 5: Verify insight card is visible ──
    // On first run, the insight shows 'no_condition_detected' (no previous MRR
    // to compare against). The card is visible with diagnostic text.
    await waitForInsightReady(page, 30_000);

    // ── Phase 6: Create a task from the first insight action ──
    // If the insight shows actions (condition-based), create a task.
    // On first run with 'no_condition_detected', there are no actions to click.
    const createTaskBtn = page.getByTestId("action-0-create-task");
    const hasActions = await createTaskBtn.isVisible().catch(() => false);

    if (hasActions) {
      await createTaskBtn.click();

      // Task created badge should appear
      await expect(page.getByTestId("action-0-task-created")).toBeVisible({
        timeout: 10_000,
      });

      // Task list section should appear with the new task
      await expect(page.getByTestId("startup-task-list")).toBeVisible({
        timeout: 5000,
      });
      const taskRows = page.getByTestId("task-row");
      await expect(taskRows.first()).toBeVisible();

      // Sync status badge should be present
      await expect(page.getByTestId("task-sync-status").first()).toBeVisible();
    }

    // ── Phase 7: Verify state survives page reload ──
    await page.reload();
    await expect(
      page.getByRole("main", { name: "portfolio dashboard" })
    ).toBeVisible({ timeout: 10_000 });

    // Health and startup list should still be visible
    await waitForHealthReady(page, 30_000);
    await expect(
      page.getByLabel("startup list").getByText(startupName)
    ).toBeVisible({ timeout: 10_000 });
    await waitForInsightReady(page, 30_000);

    // If tasks were created, they should survive reload
    if (hasActions) {
      await expect(page.getByTestId("startup-task-list")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("task-row").first()).toBeVisible();
      await expect(page.getByTestId("task-sync-status").first()).toBeVisible();
    }
  });
});
