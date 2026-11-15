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

test("Forge shows the supported recipe through five authentic workflow screens without writing a trade", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(agents|paper|ticks|backtests)(\/|\?|$)/.test(request.url()) && !["GET", "HEAD"].includes(request.method())) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto("/");
  const walkthrough = page.locator("#forge .fww");
  await walkthrough.scrollIntoViewIfNeeded();
  const tabs = walkthrough.getByRole("tablist", { name: "Protective Put workflow" });
  const labels = ["Agent selection", "Rule composition", "Recipe validation", "Backtest readiness", "Decision & Tape"];
  await expect(tabs.getByRole("tab")).toHaveCount(labels.length);
  const panel = walkthrough.locator("[data-workflow-panel]");

  for (const [index, label] of labels.entries()) {
    const tab = tabs.getByRole("tab", { name: new RegExp(label) });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(walkthrough).toHaveAttribute("data-active-stage", String(index));
    await page.screenshot({ path: testInfo.outputPath(`forge-workflow-${index + 1}.png`), animations: "disabled" });
    if (index === 0) {
      await expect(panel).toContainText("Protective Put");
      await expect(panel).toContainText("Paper ready");
    }
    if (index === 1) {
      await expect(panel).toContainText("15 of 15 required rules selected");
      await expect(panel).toContainText("21 catalog-only hooks stay locked");
      await expect(panel.getByRole("button", { name: "Calmo", exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    if (index === 2) {
      await expect(panel).toContainText("Recipe valid");
      await expect(panel.getByText("CANONICAL RECIPE HASH")).toBeVisible();
    }
    if (index === 3) {
      await expect(panel).toContainText("Historical candle coverage");
      await expect(panel).toContainText("No backtest runs from this demo.");
    }
    if (index === 4) {
      await expect(panel).toContainText("US session closed");
      await expect(panel).toContainText("Skip · 0 orders");
      await expect(panel).toContainText("ILLUSTRATIVE BEHAVIOR · NOT EXECUTED HERE");
      await expect(panel).toContainText("This marketing view makes no request and creates no record.");
    }
  }

  await tabs.getByRole("tab", { name: /Rule composition/ }).click();
  await panel.getByRole("button", { name: "Calmo", exact: true }).click();
  await expect(walkthrough).toHaveAttribute("data-valid", "0");
  await tabs.getByRole("tab", { name: /Recipe validation/ }).click();
  await expect(panel).toContainText("Recipe blocked");
  await expect(panel).toContainText("requires calmo.");
  expect(writes).toEqual([]);
});

test("Forge workflow fits mobile, tablet and desktop and supports keyboard stage selection", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [[390, 844], [820, 900], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const walkthrough = page.locator("#forge .fww");
    await walkthrough.scrollIntoViewIfNeeded();
    const tabs = walkthrough.getByRole("tablist", { name: "Protective Put workflow" });
    const buttons = tabs.getByRole("tab");
    await expect(buttons).toHaveCount(5);
    await buttons.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(buttons.nth(1)).toBeFocused();
    await expect(buttons.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px viewport`).toBe(0);
    const bounds = await walkthrough.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(width);
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`forge-workflow-${width}.png`), animations: "disabled" });
  }
});

test("Forge autoplay advances the walkthrough and direct selection pauses it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const walkthrough = page.locator("#forge .fww");
  await walkthrough.scrollIntoViewIfNeeded();
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "1");
  await expect(walkthrough).toHaveAttribute("data-active-stage", "1", { timeout: 6000 });

  const tabs = walkthrough.getByRole("tablist", { name: "Protective Put workflow" });
  await tabs.getByRole("tab", { name: /Recipe validation/ }).click();
  await expect(walkthrough).toHaveAttribute("data-active-stage", "2");
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "0");
  await expect(page.locator("#forge .fs-demo-controls").getByRole("button", { name: "Resume" })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(walkthrough).toHaveAttribute("data-active-stage", "2");
});

test("Forge completes its five-stage demonstration within 15 seconds and supports pause, resume and replay", async ({ page }) => {
  test.setTimeout(25_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const walkthrough = page.locator("#forge .fww");
  await walkthrough.scrollIntoViewIfNeeded();
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "1");
  await expect(walkthrough).toHaveAttribute("data-active-stage", "4", { timeout: 15_000 });
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "0");

  const controls = page.locator("#forge .fs-demo-controls");
  const replay = controls.getByRole("button", { name: "Replay" });
  await replay.click();
  await expect(walkthrough).toHaveAttribute("data-active-stage", "0");
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "1");
  await controls.getByRole("button", { name: "Pause" }).click();
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "0");
  await expect(controls.getByRole("button", { name: "Resume" })).toBeVisible();
  await controls.getByRole("button", { name: "Resume" }).click();
  await expect(walkthrough).toHaveAttribute("data-active-stage", "1", { timeout: 3_000 });
  await expect(walkthrough).toHaveAttribute("data-auto-playing", "1");
});

test("the pinned Forge story follows scroll forward and backward without a drawn node network", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|uncaught|react.*error/i.test(message.text())) pageErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const walkthrough = page.locator("#forge .fww");
  await walkthrough.scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("#forge .fs-story");
    const pin = track?.querySelector<HTMLElement>(".ps-pin");
    if (!track || !pin) throw new Error("Forge workflow track was not rendered.");
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
  await expect(walkthrough).toHaveAttribute("data-active-stage", "3");
  await seek(0.18);
  await expect(walkthrough).toHaveAttribute("data-active-stage", "0");
  await expect(page.locator("#forge canvas, #forge svg.fs-core-fallback, #forge .fs-anatomy")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
