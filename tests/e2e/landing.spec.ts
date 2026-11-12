import { expect, test } from "@playwright/test";

test("landing states the product within the first viewport and keeps the paper-first boundary", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Let agents trade the strike." })).toBeVisible();
  await expect(page.getByText("AI OPTIONS AGENTS · ROBINHOOD CHAIN", { exact: true })).toBeVisible();
  await expect(page.getByText("Paper first. Synthetic options on stock prices. Not shares. Not investment advice.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch a paper agent" }).first()).toHaveAttribute("href", "/agents");
  await expect(page.getByRole("link", { name: "Read the Tape" })).toHaveAttribute("href", "#tape");
  // The hero preview is built from the real hook catalog, so the Protective Put recipe names real hooks.
  const card = page.locator(".hero-card");
  await expect(card.getByText("Protective Put", { exact: true })).toBeVisible();
  await expect(card.getByText("Paper ready", { exact: true })).toBeVisible();
  await expect(card.getByText("Modeled premiums", { exact: true })).toBeVisible();
  await expect(card.getByText("Calmo", { exact: true })).toBeVisible();
});

test("landing capability claims match the catalog and roadmap items are not presented as available", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("15 of 36 hooks run today.", { exact: true })).toBeVisible();
  const status = page.getByRole("table", { name: "Capability status" });
  await expect(status.getByRole("row", { name: /Live execution/ })).toContainText("Disabled");
  await expect(status.getByRole("row", { name: /AI composition/ })).toContainText("Coming soon");
  await expect(status.getByRole("row", { name: /Other House Agents/ })).toContainText("Preview");
  await expect(status.getByRole("row", { name: /Listing, Floor, Sessions, MCP, x402/ })).toContainText("Planned");
  await expect(page.getByRole("list", { name: "House Agents in Preview" }).getByText("Not yet available")).toHaveCount(3);
});

test("every landing navigation anchor resolves to a section that exists", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page.locator(".m-nav a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(3);
  for (const href of hrefs) {
    expect(href).toMatch(/^#/);
    await expect(page.locator(href as string)).toHaveCount(1);
  }
});

test("mobile landing has no horizontal overflow and the menu closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const toggle = page.getByRole("button", { name: "Menu" });
  await toggle.click();
  await expect(page.getByRole("navigation", { name: "Page sections" }).getByRole("link", { name: "Tape" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});

test("hero keeps a readable CSS beam and no canvas when WebGL2 is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2") return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");

  await expect(page.locator(".hero-stage")).toHaveAttribute("data-laser", "fallback");
  await expect(page.locator("canvas.laser-flow-canvas")).toHaveCount(0);
  await expect(page.locator(".hero-beam-fallback")).toBeAttached();
  await expect(page.getByRole("heading", { level: 1, name: "Let agents trade the strike." })).toBeVisible();
  await expect(page.locator(".hero-card").getByText("Protective Put", { exact: true })).toBeVisible();
});

test("reduced motion still renders the hero without an error", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Let agents trade the strike." })).toBeVisible();
  await expect(page.locator(".hero-stage")).not.toHaveAttribute("data-laser", "pending");
  expect(errors).toEqual([]);
});
