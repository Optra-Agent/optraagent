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
  await expect(preview).toHaveAttribute("role", "group");
  await expect(preview.getByRole("link", { name: /Open app/ })).toHaveAttribute("href", "/agents");
  await expect(preview.locator(".sidebar-link", { hasText: "Agents" })).toHaveAttribute("aria-current", "page");
  await expect(preview.getByText("Protective Put", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Paper ready", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Preview", { exact: true })).toHaveCount(3);
  await expect(page.getByText("15 of 36 hooks implemented", { exact: true })).toBeVisible();
});

test("landing capability claims match the catalog and roadmap items are not presented as available", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("15 of 36 hooks run today.", { exact: true })).toBeVisible();
  const verify = page.locator("#verify");
  await expect(verify.getByRole("region", { name: "Safety boundaries" }).getByText("Live execution")).toBeVisible();
  await expect(verify.getByRole("region", { name: "Safety boundaries" }).getByText("Disabled", { exact: true })).toBeVisible();
  const roadmap = verify.getByRole("region", { name: "Roadmap" });
  await expect(roadmap.getByText("AI composition").locator("..")).toContainText("Coming soon");
  await expect(roadmap.getByText("Other House Agents").locator("..")).toContainText("Preview");
  await expect(roadmap.getByText("Session choices, Listing, Floor, MCP, x402").locator("..")).toContainText("Planned");
  await expect(page.locator("#agents .pn-agents").getByText("Preview", { exact: true })).toHaveCount(3);
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
    await page.evaluate((target) => { const el = document.getElementById(target)!; window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "instant" }); }, id);
  };

  for (const id of sectionIds) {
    await goTo(id);
    await expect.poll(() => headOpacity(id), { message: `${id} on the way down` }).toBeGreaterThanOrEqual(0.95);
  }
  await goTo("agents");
  await expect.poll(() => headOpacity("agents"), { message: "agents on the way back up" }).toBeGreaterThanOrEqual(0.95);
  const cards = await page.locator("#verify .ev-group:nth-of-type(1) ul > *").count();
  expect(cards).toBe(4);
  for (let index = 0; index < cards; index += 1) {
    const claim = page.locator("#verify .ev-group:nth-of-type(1) ul > *").nth(index);
    await claim.scrollIntoViewIfNeeded();
    await expect.poll(() => claim.evaluate((element) => parseFloat(getComputedStyle(element).opacity)), { message: `verify claim ${index} once in view` }).toBeGreaterThanOrEqual(0.95);
  }
});

test("reduced motion shows every section at full opacity without scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const opacities = await page.evaluate(() => [...document.querySelectorAll(".reveal, .reveal-lead, .reveal-stagger > *, .draw")].map((el) => parseFloat(getComputedStyle(el).opacity)));
  expect(opacities.length).toBeGreaterThan(10);
  expect(Math.min(...opacities)).toBe(1);
});

test("the hook explorer is pinned, keeps the true counts, and separates implemented from catalog-only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hook stages" });
  await expect(nav.getByRole("button", { name: /GATE.*3 of 10/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /BREAKER.*5 of 5/ })).toBeVisible();
  await expect(nav.getByText("Guards every stage, every tick")).toBeVisible();
  await expect(page.getByText("Catalog only, locked (21 hooks)")).toBeVisible();
  const hooks = page.locator("#hooks");
  const active = () => hooks.locator(".ps").getAttribute("data-step");
  const go = async (fraction: number) => {
    await page.evaluate((f) => {
      const track = document.querySelector("#hooks .ps") as HTMLElement;
      const pin = track.querySelector(".ps-pin") as HTMLElement;
      window.scrollTo(0, track.getBoundingClientRect().top + window.scrollY - 104 + (track.offsetHeight - pin.offsetHeight) * f);
    }, fraction);
    await page.waitForTimeout(450);
  };
  // Scrolling moves the active stage forward, and back.
  await go(0.3);
  await expect.poll(active).toBe("1");
  expect(await page.evaluate(() => Math.round(document.querySelector("#hooks .ps-pin")!.getBoundingClientRect().top))).toBe(104);
  await expect(hooks.getByRole("button", { name: /Percy/ })).toBeVisible();
  await go(0.97);
  await expect.poll(active).toBe("5");
  await expect(hooks.getByText("The five guards a Protective Put runs")).toBeVisible();
  await go(0.02);
  await expect.poll(active).toBe("0");
  // Clicking a stage scrolls and activates it without bouncing; clicking a hook opens its detail.
  await nav.getByRole("button", { name: /SIZE/ }).click();
  await page.waitForTimeout(1300);
  await expect.poll(active).toBe("2");
  await expect(hooks.getByRole("button", { name: /Capra/ })).toBeVisible();
  await nav.getByRole("button", { name: /GATE/ }).click();
  await page.waitForTimeout(1300);
  await expect.poll(active).toBe("0");
  const panel = hooks.locator('.ps-view[data-state="active"]');
  await panel.getByText(/7 catalog-only hooks in Gate/).click();
  await panel.getByRole("button", { name: /Volra/ }).click();
  const detail = panel.getByRole("region", { name: "Volra details" });
  await expect(detail.getByText("Catalog only, locked", { exact: true })).toBeVisible();
  await expect(detail.getByText("Why it is locked.")).toBeVisible();
});

test("on a phone the hook explorer is a stacked list that switches one stage at a time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("#hooks .ps-pin")!).position)).toBe("static");
  const nav = page.getByRole("navigation", { name: "Hook stages" });
  await nav.getByRole("button", { name: /STRIKE/ }).click();
  await expect(page.locator('#hooks .ps-view[data-state="active"]').getByRole("button", { name: /Percy/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
