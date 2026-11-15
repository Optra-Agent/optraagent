import { expect, test } from "@playwright/test";

test("Forge reads the PM catalog and blocks unsupported generic recipes without AI claims", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z",
  } }));
  await page.route("**/api/markets", (route) => route.fulfill({ json: { markets: [{ symbol: "AAPL", name: "Apple Inc.", currentMultiplier: "1.001" }] } }));

  await page.goto("/forge");

  await expect(page.getByRole("heading", { name: "Forge", exact: true })).toBeVisible();
  await expect(page.getByText("AI composition is planned", { exact: true })).toBeVisible();
  await expect(page.getByText("Registered hooks: 36 / 36", { exact: true })).toBeVisible();
  await expect(page.getByText("Calmo", { exact: true })).toBeVisible();
  const validate = page.getByRole("button", { name: "Validate recipe", exact: true });
  await validate.click();
  await expect(page.locator(".forge-validation")).toContainText("Recipe blocked");
  await expect(page.locator(".forge-validation")).toContainText("Only the PM Protective Put has a supported paper evaluator in this release.");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /compose|generate with ai/i })).toHaveCount(0);
});

test("the Forge Intelligence Core morphs through five catalog-derived states without running a trade", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tradeWrites: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(agents|paper|ticks)(\/|\?|$)/.test(request.url()) && !["GET", "HEAD"].includes(request.method())) {
      tradeWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto("/");
  const core = page.locator("#forge .fs-core");
  await core.scrollIntoViewIfNeeded();
  await expect(core.locator(".fs-core-fallback")).toHaveAttribute("role", "img");
  await expect(core).toHaveAttribute("data-hook-total", "36");
  await expect(core).toHaveAttribute("data-hook-live", "15");
  await expect(core).toHaveAttribute("data-hook-catalog-only", "21");
  await expect(core).toHaveAttribute("data-breaker-count", "5");
  await expect(core).toHaveAttribute("data-reduced-motion", "1");
  await expect(core).toHaveAttribute("data-renderer", "canvas");
  await expect(core.getByRole("group", { name: "Intelligence Core stages" }).getByRole("button")).toHaveCount(5);
  const reducedFrameCount = await core.locator("canvas").getAttribute("data-frame-count");
  await page.waitForTimeout(160);
  await expect(core.locator("canvas")).toHaveAttribute("data-frame-count", reducedFrameCount ?? "0");

  const states = ["Agent Core", "Strategy Formation", "Hook Evaluation", "Risk Protection", "Decision & Evidence"];
  for (const [index, state] of states.entries()) {
    const button = core.getByRole("button", { name: state, exact: false });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(core).toHaveAttribute("data-core-state", String(index));
    const center = (index + 0.5) / states.length;
    await expect.poll(async () => Number(await core.locator("canvas").getAttribute("data-progress"))).toBeGreaterThan(center - 0.02);
    await expect.poll(async () => Number(await core.locator("canvas").getAttribute("data-progress"))).toBeLessThan(center + 0.02);
    await page.screenshot({ path: testInfo.outputPath(`forge-core-${index + 1}.png`), animations: "disabled" });
  }

  await page.locator("#forge .fs-rules").getByRole("button", { name: "Calmo", exact: true }).click();
  await expect(page.locator("#forge .fs-preview")).toHaveAttribute("data-valid", "0");
  expect(tradeWrites).toEqual([]);
});

test("Forge Intelligence Core fits phone, tablet and desktop and keeps its controls keyboard reachable", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [[390, 844], [820, 900], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const core = page.locator("#forge .fs-core");
    await core.scrollIntoViewIfNeeded();
    const controls = core.getByRole("group", { name: "Intelligence Core stages" });
    const buttons = controls.getByRole("button");
    await expect(buttons).toHaveCount(5);
    await buttons.first().focus();
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(buttons.nth(1)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px viewport`).toBe(0);
    const bounds = await core.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`forge-core-${width}.png`), animations: "disabled" });
  }
});

test("the pinned Core tracks continuous scroll forward and backward", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|uncaught|react.*error/i.test(message.text())) pageErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const core = page.locator("#forge .fs-core");
  const canvas = core.locator("canvas");
  await core.scrollIntoViewIfNeeded();
  await expect(core).toHaveAttribute("data-active", "1");
  const geometry = await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("#forge .fs-story");
    const pin = track?.querySelector<HTMLElement>(".ps-pin");
    if (!track || !pin) throw new Error("Forge Core track was not rendered.");
    return {
      trackTop: track.getBoundingClientRect().top + window.scrollY,
      pinTop: Number.parseFloat(getComputedStyle(pin).top) || 0,
      range: Math.max(1, track.offsetHeight - pin.offsetHeight),
      pinHeight: pin.offsetHeight,
    };
  });
  expect(geometry.pinHeight).toBeLessThan(900 - geometry.pinTop);

  const seek = (progress: number) => page.evaluate(({ progress, trackTop, pinTop, range }) => {
    window.scrollTo({ top: trackTop - pinTop + progress * range, behavior: "auto" });
  }, { progress, ...geometry });
  await seek(0.72);
  await expect.poll(async () => Number(await canvas.getAttribute("data-progress"))).toBeGreaterThan(0.69);
  await expect(core).toHaveAttribute("data-core-state", "3");
  await seek(0.18);
  await expect.poll(async () => Number(await canvas.getAttribute("data-progress"))).toBeLessThan(0.21);
  await expect(core).toHaveAttribute("data-core-state", "0");
  expect(pageErrors).toEqual([]);
});

test("the server SVG remains interactive when Canvas 2D is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (type: string, ...args: unknown[]) {
        if (type === "2d" && this.classList.contains("fs-core-canvas")) return null;
        return Reflect.apply(getContext, this, [type, ...args]);
      },
    });
  });
  await page.goto("/");
  const core = page.locator("#forge .fs-core");
  await core.scrollIntoViewIfNeeded();
  await expect(core).toHaveAttribute("data-renderer", "svg");
  const fallback = core.locator(".fs-core-fallback");
  await expect(fallback).toBeVisible();
  await core.getByRole("button", { name: /Risk Protection/ }).click();
  await expect(core).toHaveAttribute("data-core-state", "3");
  await expect(fallback).toHaveAttribute("aria-label", /Risk Protection/);
});

test("ambient Core motion runs only while visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const core = page.locator("#forge .fs-core");
  const canvas = core.locator("canvas");
  await core.scrollIntoViewIfNeeded();
  await expect(core).toHaveAttribute("data-active", "1");
  const firstCount = Number(await canvas.getAttribute("data-frame-count"));
  await page.waitForTimeout(180);
  const secondCount = Number(await canvas.getAttribute("data-frame-count"));
  expect(secondCount).toBeGreaterThan(firstCount);

  const trackEnd = await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("#forge .fs-story");
    if (!track) throw new Error("Forge Core track was not rendered.");
    return track.getBoundingClientRect().top + window.scrollY + track.offsetHeight + 400;
  });
  await page.evaluate((top) => window.scrollTo({ top, behavior: "auto" }), trackEnd);
  await expect(core).toHaveAttribute("data-active", "0");
  const pausedCount = Number(await canvas.getAttribute("data-frame-count"));
  await page.waitForTimeout(180);
  expect(Number(await canvas.getAttribute("data-frame-count"))).toBe(pausedCount);
});

test("the Core keeps scroll updates but suppresses ambient motion when Save-Data is enabled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, addEventListener() {}, removeEventListener() {} },
    });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const core = page.locator("#forge .fs-core");
  const canvas = core.locator("canvas");
  await core.scrollIntoViewIfNeeded();
  await expect(core).toHaveAttribute("data-save-data", "1");
  const firstCount = Number(await canvas.getAttribute("data-frame-count"));
  await page.waitForTimeout(160);
  await expect(canvas).toHaveAttribute("data-frame-count", String(firstCount));
  const initialProgress = Number(await canvas.getAttribute("data-progress"));
  await core.getByRole("button", { name: /Strategy Formation/ }).click();
  await expect.poll(async () => Number(await canvas.getAttribute("data-progress"))).not.toBe(initialProgress);
});

test("the rejected isometric Forge board is no longer shipped", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#forge .fs-anatomy")).toHaveCount(0);
  await expect(page.locator("#forge .fs-core-canvas")).toHaveCount(1);
  await expect(page.locator("#forge .fs-core-controls button")).toHaveCount(5);
});
