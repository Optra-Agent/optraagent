import { expect, test } from "@playwright/test";

test("desktop app shell shows one sidebar with every section and marks the current page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/hooks");

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const label of ["Agents", "Forge", "Lab", "Tape", "Hooks", "Market", "Verify"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Hooks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("banner").getByText("PAPER", { exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
});

test("mobile shell hides the sidebar, opens a drawer, navigates, and does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");

  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("link", { name: "Forge", exact: true })).toBeVisible();
  await drawer.getByRole("link", { name: "Forge", exact: true }).click();
  await expect(page).toHaveURL(/\/forge$/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Forge", exact: true })).toBeVisible();
});

test("wallet dialog opens from the topbar, closes with Escape, and is reachable from the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents");

  await page.getByRole("banner").getByRole("button", { name: "Connect wallet", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose an EVM wallet" });
  await expect(dialog.getByRole("button", { name: "MetaMask", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Phantom EVM", exact: true })).toBeVisible();
  const walletMarks = dialog.locator(".wallet-mark img");
  await expect(walletMarks).toHaveCount(2);
  await expect(walletMarks.nth(0)).toHaveAttribute("src", "/wallets/metamask.svg");
  await expect(walletMarks.nth(1)).toHaveAttribute("src", "/wallets/phantom.svg");
  await expect.poll(() => walletMarks.evaluateAll((images) => images.every((image) => {
    const logo = image as HTMLImageElement;
    return logo.complete && logo.naturalWidth > 0;
  }))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Choose a wallet", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose an EVM wallet" })).toBeVisible();
});
