import { expect, test } from "@playwright/test";

test("landing states the product within the first viewport and keeps the paper-first boundary", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Let agents trade the strike." })).toBeVisible();
  await expect(page.getByText("AI OPTIONS AGENTS · ROBINHOOD CHAIN", { exact: true })).toBeVisible();
  await expect(page.getByText("Paper first. Synthetic options on stock prices. Not shares. Not investment advice.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch a paper agent" }).first()).toHaveAttribute("href", "/agents");
  await expect(page.getByRole("link", { name: "Read the Tape" })).toHaveAttribute("href", "#tape");
  // The hero preview is the real Agents screen: same sidebar, journey rail and template cards, read-only.
  const preview = page.locator(".hero-card .preview-shell");
  await expect(preview).toHaveAttribute("aria-hidden", "true");
  await expect(preview).toHaveJSProperty("inert", true);
  await expect(preview.locator(".sidebar-link", { hasText: "Agents" })).toHaveAttribute("aria-current", "page");
  await expect(preview.getByText("Protective Put", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Paper ready", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Preview", { exact: true })).toHaveCount(3);
  await expect(page.getByText("15 of 36 hooks implemented", { exact: true })).toBeVisible();
});

test("landing capability claims match the catalog and roadmap items are not presented as available", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("15 of 36 hooks run today.", { exact: true })).toBeVisible();
  const status = page.getByRole("table", { name: "Capability status" });
  await expect(status.getByRole("row", { name: /Live execution/ })).toContainText("Disabled");
  await expect(status.getByRole("row", { name: /AI composition/ })).toContainText("Coming soon");
  await expect(status.getByRole("row", { name: /Other House Agents/ })).toContainText("Preview");
  await expect(status.getByRole("row", { name: /Session choices, Listing, Floor, MCP, x402/ })).toContainText("Planned");
  await expect(page.locator("#agents").getByText("Not yet available").first()).toBeVisible();
  await expect(page.locator("#agents").getByText("Preview", { exact: true })).toHaveCount(3);
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

  await page.getByRole("button", { name: "Open page sections" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("link", { name: "Tape" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
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
  await expect(page.locator(".hero-card").getByText("Protective Put", { exact: true }).first()).toBeVisible();
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

const sectionIds = ["agents", "forge", "hooks", "how", "tape", "lab", "sessions", "dual", "developers", "verify", "faq"];

test("hero copy is fully opaque at first paint and has no entrance animation", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const state = await page.evaluate(() => {
    const selectors = [".hero h1", ".hero-sub", ".hero-actions a", ".hero-proof", ".hero-card", ".m-header"];
    return selectors.map((selector) => {
      const element = document.querySelector(selector)!;
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) opacity *= parseFloat(getComputedStyle(node).opacity);
      const fades = element.getAnimations({ subtree: true }).filter((animation) => (animation.effect as KeyframeEffect).getKeyframes().some((frame) => frame.opacity !== undefined && frame.opacity !== "1")).length;
      return { selector, opacity, fades };
    });
  });
  for (const entry of state) {
    expect(entry.opacity, `${entry.selector} opacity`).toBe(1);
    expect(entry.fades, `${entry.selector} opacity animations`).toBe(0);
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the hero, the preview and every section are readable and the CSS beam is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Let agents trade the strike." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Launch a paper agent" }).first()).toBeVisible();
    await expect(page.locator(".hero-beam-fallback")).toBeAttached();
    await expect(page.locator(".hero-card .preview-shell")).toBeAttached();
    for (const id of sectionIds) await expect(page.locator(`#${id} h2`).first()).toBeAttached();
    await expect(page.getByText("Click rules together. The server checks every recipe.")).toBeVisible();
  });
});

test("scroll-driven reveals settle to full opacity, and revisiting a section replays them cleanly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  test.skip(!(await page.evaluate(() => CSS.supports("animation-timeline: view()"))), "scroll-driven animations are not supported in this browser; content stays static");

  const headOpacity = (id: string) => page.evaluate((target) => parseFloat(getComputedStyle(document.querySelector(`#${target} .section-head`)!).opacity), id);
  const goTo = async (id: string) => {
    await page.evaluate((target) => { const el = document.getElementById(target)!; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); }, id);
    await page.waitForTimeout(350);
  };

  for (const id of sectionIds) {
    await goTo(id);
    expect(await headOpacity(id), `${id} on the way down`).toBeGreaterThanOrEqual(0.95);
  }
  await goTo("agents");
  expect(await headOpacity("agents"), "agents on the way back up").toBeGreaterThanOrEqual(0.95);
  const cards = await page.locator("#agents .agent-board > *").count();
  for (let index = 0; index < cards; index += 1) {
    await page.locator("#agents .agent-board > *").nth(index).scrollIntoViewIfNeeded();
    await page.evaluate((i) => document.querySelectorAll("#agents .agent-board > *")[i].scrollIntoView({ block: "center" }), index);
    await page.waitForTimeout(300);
    const opacity = await page.evaluate((i) => parseFloat(getComputedStyle(document.querySelectorAll("#agents .agent-board > *")[i]).opacity), index);
    expect(opacity, `agent card ${index} once in view`).toBeGreaterThanOrEqual(0.95);
  }
});

test("reduced motion shows every section at full opacity without scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const opacities = await page.evaluate(() => [...document.querySelectorAll(".reveal, .reveal-lead, .reveal-stagger > *, .draw")].map((el) => parseFloat(getComputedStyle(el).opacity)));
  expect(opacities.length).toBeGreaterThan(10);
  expect(Math.min(...opacities)).toBe(1);
});

test("the hook stage visual keeps the true counts and separates implemented from catalog-only", async ({ page }) => {
  await page.goto("/");
  const stages = page.getByRole("group", { name: "Hook stages and coverage" });
  await expect(stages.getByText("3 of 10 implemented", { exact: true })).toBeVisible();
  await expect(stages.getByText("5 of 5 implemented", { exact: true })).toBeVisible();
  await expect(stages.getByText("Always on", { exact: true })).toBeVisible();
  await expect(page.getByText("Catalog only, locked (21 hooks)")).toBeVisible();
});
