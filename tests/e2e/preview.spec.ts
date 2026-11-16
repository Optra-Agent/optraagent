import { expect, test } from "@playwright/test";

const preview = (page: import("@playwright/test").Page) => page.locator(".hero-card .preview-shell");

test("the hero preview is an interactive, read-only miniature of the real app", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(agents|backtests|recipes)/.test(path) && !path.startsWith("/api/agents/templates")) privateRequests.push(`${request.method()} ${path}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const shell = preview(page);
  await shell.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect(shell).toBeVisible();
  await expect(shell.getByRole("link", { name: /Open app/ })).toHaveAttribute("href", "/agents");
  await expect(shell.getByRole("banner").or(shell.locator(".topbar")).getByText("Agents", { exact: true })).toBeVisible();

  // Agents: picking a Preview agent explains why it is unavailable and never shows a create action.
  await shell.getByRole("button", { name: /Covered Call/ }).click();
  await expect(shell.getByText("Not yet available. No draft can be created for this agent.")).toBeVisible();
  await shell.getByRole("button", { name: /Protective Put/ }).click();
  await expect(shell.getByRole("link", { name: /Configure in the app/ })).toHaveAttribute("href", "/agents#configure");

  // Forge: toggling hooks changes the count but never claims a validation result.
  await shell.locator(".sidebar").getByRole("button", { name: "Forge" }).click();
  await expect(shell.getByText("15 of 15 selected")).toBeVisible();
  await shell.getByRole("button", { name: "Calmo" }).click();
  await expect(shell.getByText("14 of 15 selected")).toBeVisible();
  await expect(shell.getByText("Not run in preview")).toBeVisible();
  await expect(shell.getByRole("link", { name: /Open Forge/ }).last()).toHaveAttribute("href", "/forge");

  // Lab and Tape: labeled, no numbers, linked to the real routes.
  const labButton = shell.locator(".sidebar").getByRole("button", { name: "Lab" });
  await labButton.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await expect(labButton).toBeVisible();
  await labButton.click();
  await expect(shell.getByText("None are shown here.")).toBeVisible();
  await expect(shell.getByRole("link", { name: /Open Lab/ }).last()).toHaveAttribute("href", "/lab");
  await shell.locator(".sidebar").getByRole("button", { name: "Tape" }).click();
  await expect(shell.getByText("Illustrative only", { exact: true })).toBeVisible();
  await expect(shell.getByText("An example of the shape, not a recorded trade.", { exact: false })).toBeVisible();
  await expect(shell.getByRole("link", { name: /Open Tape/ }).last()).toHaveAttribute("href", "/tape");

  // The journey rail never claims progress.
  await expect(shell.locator(".journey-done")).toHaveCount(0);
  expect(privateRequests).toEqual([]);
});

test("on a phone the preview switches screens with tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const tabs = preview(page).getByRole("group", { name: "Preview screens" });
  await expect(tabs).toBeVisible();
  await tabs.getByRole("button", { name: "Lab" }).click();
  await expect(preview(page).getByText("Numbers appear only after a complete run in the app.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
