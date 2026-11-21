import { expect, test } from "@playwright/test";

const agentId = "123e4567-e89b-42d3-a456-426614174000";

test("Tape screen shows persisted decision reasons and position empty state", async ({ page }) => {
  await page.route(`**/api/agents/${agentId}/tape`, (route) => route.fulfill({ json: {
    executionMode: "PAPER",
    decisions: [{
      id: `${agentId}:tick-1`, agentId, tickId: "tick-1", action: "skip", reason: "Hook catalog is unavailable.",
      hookResults: [{ hookId: "system.recipe_validator", status: "skip", reason: "Hook catalog is unavailable." }],
      snapshotSource: "robinhood_stock_token_api", recipeHash: `sha256:${"a".repeat(64)}`, createdAt: "2026-11-12T03:31:00.000Z",
    }],
  } }));
  await page.route(`**/api/agents/${agentId}/positions`, (route) => route.fulfill({ json: { executionMode: "PAPER", positions: [] } }));
  await page.goto(`/tape?agentId=${agentId}`);

  await expect(page.getByRole("heading", { name: "Optra Tape", exact: true })).toBeVisible();
  await expect(page.getByText("Hook catalog is unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("No paper positions.", { exact: true })).toBeVisible();
});
