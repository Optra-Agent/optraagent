import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 }, video: "on" });

const net = (page: Page) => page.locator("#agents .pn");
const svg = (page: Page) => net(page).locator(".pn-svg");
const shown = (page: Page, kind: string) => svg(page).locator(`.pn-n[data-kind="${kind}"][data-show="1"]`);

test("captures the real six-state autoplay as frames and a browser video", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    const network = document.querySelector<HTMLElement>("#agents .pn");
    if (!network) throw new Error("The Protective Put network is missing from the landing page.");
    const top = network.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 96), behavior: "instant" });
  });
  await expect(net(page)).toHaveAttribute("data-live", "1");
  // The network may already have advanced while the page hydrates and scrolls into view.
  // Reset deliberately, capture the initial composition, then verify the actual autoplay sequence.
  await net(page).getByRole("button", { name: "Back to start" }).click();
  await expect(net(page)).toHaveAttribute("data-phase", "0", { timeout: 3000 });
  await page.screenshot({ path: testInfo.outputPath("agent-state-0-awakens.png") });

  await net(page).getByRole("toolbar", { name: "Network playback" }).getByRole("button", { name: "Explore agent" }).click();
  await expect(net(page)).toHaveAttribute("data-phase", "1", { timeout: 5000 });
  await expect(shown(page, "stage")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("agent-state-1-strategy.png") });

  await expect(net(page)).toHaveAttribute("data-phase", "2", { timeout: 5000 });
  await expect(shown(page, "hook")).toHaveCount(10);
  await page.screenshot({ path: testInfo.outputPath("agent-state-2-hooks.png") });

  await expect(net(page)).toHaveAttribute("data-phase", "3", { timeout: 6000 });
  await expect(svg(page).locator('.pn-ring[data-show="1"]')).toHaveCount(1);
  await expect(shown(page, "risk")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("agent-state-3-breaker.png") });

  await expect(net(page)).toHaveAttribute("data-phase", "4", { timeout: 5000 });
  const decision = shown(page, "decision");
  await expect(decision).toHaveCount(1);
  await expect(shown(page, "tape")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("agent-state-4-paper-decision.png") });

  await expect(net(page)).toHaveAttribute("data-phase", "5", { timeout: 5000 });
  await net(page).getByRole("button", { name: "Pause" }).click();
  await expect(net(page)).toHaveAttribute("data-playing", "0");
  const tape = shown(page, "tape");
  await expect(decision).toBeInViewport();
  await expect(tape).toBeInViewport();
  await expect.poll(() => tape.locator(".pn-in").evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("agent-state-5-tape.png") });
});
