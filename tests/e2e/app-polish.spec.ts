import { expect, test } from "@playwright/test";

test("the app sidebar groups navigation with an icon per destination and a Paper mode card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.locator("a svg")).toHaveCount(7);
  await expect(nav.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(nav.getByText("Reference", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sidebar").getByText("PAPER MODE")).toBeVisible();
  const banner = page.getByRole("banner");
  await expect(banner.getByText("Agents", { exact: true })).toBeVisible();
  await expect(banner.getByText("Robinhood Chain")).toBeVisible();
  await expect(banner.getByRole("note")).toHaveAttribute("title", /Real-money execution is disabled/);
});

test("Agents leads with a connect card, a featured Protective Put and locked previews", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Sign in required.", retryable: false } } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents");
  await expect(page.getByRole("region", { name: "Wallet session" }).getByRole("button", { name: "Choose a wallet" })).toBeVisible();
  const templates = page.getByRole("region", { name: "House Agent templates" });
  await expect(templates.getByRole("link", { name: /Configure this agent below/ })).toHaveAttribute("href", "#configure");
  await expect(templates.getByText("Not yet available")).toHaveCount(3);
  await expect(templates.getByText("15", { exact: true })).toBeVisible();
  await expect(templates.getByText("7% OTM")).toBeVisible();
});

test("the configure form validates its inputs and summarizes the strategy", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z" } }));
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents: [] } }));
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1.001" }] } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents");
  const form = page.getByRole("region", { name: "Create Protective Put House Agent" });
  await expect(form.getByText(/Protect\s+10 AAPL with a put/)).toBeVisible();
  const submit = form.getByRole("button", { name: "Create paper draft" });
  await expect(submit).toBeEnabled();
  await form.getByLabel("Virtual reference shares").fill("0");
  await expect(form.getByText("Enter at least 1 share.")).toBeVisible();
  await expect(submit).toBeDisabled();
  await form.getByLabel("Virtual reference shares").fill("25");
  await expect(form.getByText(/Protect\s+25 AAPL/)).toBeVisible();
  await expect(submit).toBeEnabled();
});
