import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const net = (page: Page) => page.locator("#agents .pn");
const svg = (page: Page) => net(page).locator(".pn-svg");
const shown = (page: Page, kind: string) => svg(page).locator(`.pn-n[data-kind="${kind}"][data-show="1"]`);
const state = (page: Page, n: number) => net(page).locator(".pn-caption").first().getByRole("button", { name: new RegExp(`^State ${n}:`) });
const card = (page: Page) => net(page).locator(".pn-float");

test.describe("Optra Agent Network (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("starts with one agent and the other three House Agents in a compact selector", async ({ page }) => {
    await page.goto("/");
    await expect(net(page)).toHaveAttribute("data-phase", "0");
    await expect(svg(page).getByRole("button", { name: /^Protective Put\. Paper agent/ })).toBeAttached();
    await expect(shown(page, "stage")).toHaveCount(0);
    await expect(shown(page, "hook")).toHaveCount(0);
    const agents = net(page).locator(".pn-agents");
    await expect(agents.getByRole("button")).toHaveCount(4);
    await expect(agents.getByText("Paper ready", { exact: true })).toHaveCount(1);
    await expect(agents.getByText("Preview", { exact: true })).toHaveCount(3);
    await expect(net(page).getByRole("button", { name: "Explore agent" }).first()).toBeAttached();
  });

  test("grows outward through five states and children start at their parent", async ({ page }) => {
    await page.goto("/");
    // Before it grows, a hook sits on top of its stage, not at its final place.
    const origin = await page.evaluate(() => {
      const get = (el: Element | null, name: string) => (el as SVGGElement).style.getPropertyValue(name);
      const hook = [...document.querySelectorAll('.pn-svg .pn-n[data-kind="hook"]')].find((el) => el.getAttribute("aria-label")?.startsWith("Calmo"))!;
      const stage = [...document.querySelectorAll('.pn-svg .pn-n[data-kind="stage"]')].find((el) => el.getAttribute("aria-label")?.startsWith("Gate"))!;
      return { hookFrom: [get(hook, "--cx"), get(hook, "--cy")], stageOwn: [get(stage, "--ox"), get(stage, "--oy")], hookOwn: [get(hook, "--ox"), get(hook, "--oy")] };
    });
    expect(origin.hookFrom).toEqual(origin.stageOwn);
    expect(origin.hookFrom).not.toEqual(origin.hookOwn);

    await state(page, 2).click();
    await expect(shown(page, "stage")).toHaveCount(3);
    await state(page, 3).click();
    await expect(shown(page, "stage")).toHaveCount(5);
    await expect(svg(page).locator('.pn-ring[data-show="1"]')).toHaveCount(1);
    await expect(shown(page, "hook")).toHaveCount(0);
    await state(page, 4).click();
    await expect(shown(page, "hook")).toHaveCount(10);
    await expect(shown(page, "risk")).toHaveCount(5);
    await expect(shown(page, "locked")).toHaveCount(5);
    await expect(shown(page, "decision")).toHaveCount(0);
    await state(page, 5).click();
    await expect(shown(page, "decision")).toHaveCount(1);
    await expect(shown(page, "tape")).toHaveCount(1);
    await expect(svg(page).getByText("ILLUSTRATIVE ONLY · NO RECORDED TRADE")).toBeAttached();
    await state(page, 1).click();
    await expect(shown(page, "stage")).toHaveCount(0);
  });

  test("a growing network is wider and denser than the first state", async ({ page }) => {
    await page.goto("/");
    await state(page, 1).scrollIntoViewIfNeeded();
    const spread = () => page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.pn-svg .pn-n[data-show="1"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const left = Math.min(...nodes.map((r) => r.left));
      const right = Math.max(...nodes.map((r) => r.right));
      return { count: nodes.length, width: right - left };
    });
    await state(page, 1).click();
    await page.waitForTimeout(1700);
    const first = await spread();
    await state(page, 4).click();
    await page.waitForTimeout(2200);
    const grown = await spread();
    expect(first.count).toBe(1);
    expect(grown.count).toBeGreaterThan(25);
    expect(grown.width).toBeGreaterThan(first.width * 2.5);
  });

  test("selecting a hook shows its rule, labeled output and recipe parameters, and Escape closes it", async ({ page }) => {
    await page.goto("/");
    await state(page, 4).click();
    await svg(page).getByRole("button", { name: /^Calmo,/ }).click();
    await expect(card(page).getByRole("heading", { name: "Calmo" })).toBeVisible();
    await expect(card(page).getByText("Implemented", { exact: true })).toBeVisible();
    await expect(card(page).getByText("rvRatioMax")).toBeVisible();
    await expect(card(page).getByText("Illustrative only.")).toBeVisible();
    await expect(svg(page).getByRole("button", { name: /^Calmo,/ })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
  });

  test("catalog-only hooks stay locked and are explained, never operational", async ({ page }) => {
    await page.goto("/");
    await state(page, 4).click();
    await svg(page).getByRole("button", { name: /^7 catalog-only Gate hooks/ }).click();
    await expect(card(page).getByRole("heading", { name: "7 catalog-only hooks" })).toBeVisible();
    await expect(card(page).getByText("Volra", { exact: true })).toBeVisible();
    await expect(card(page).getByText("cannot take part in an evaluation")).toBeVisible();
    await expect(svg(page).locator('.pn-n[data-kind="locked"] .pn-dot')).toHaveCount(0);
  });

  test("a stage's hooks can be hidden and shown again", async ({ page }) => {
    await page.goto("/");
    await state(page, 4).click();
    await svg(page).getByRole("button", { name: /^Gate stage/ }).click();
    await card(page).getByRole("button", { name: "Hide its hooks" }).click();
    await expect(shown(page, "hook")).toHaveCount(7);
    await card(page).getByRole("button", { name: "Show its hooks" }).click();
    await expect(shown(page, "hook")).toHaveCount(10);
  });

  test("the decision flow is labeled illustrative and ends in a decision", async ({ page }) => {
    await page.goto("/");
    await state(page, 5).click();
    await net(page).getByRole("button", { name: "View decision flow" }).first().click();
    await expect(card(page).getByText("Illustrative only", { exact: true }).first()).toBeVisible();
    await expect(card(page).getByText("Entry blocked by calmo.")).toBeVisible({ timeout: 15_000 });
    await card(page).getByRole("button", { name: "Entry opens" }).click();
    await expect(card(page).getByText("Opened modeled one-share Protective Put units for paper execution.")).toBeVisible({ timeout: 15_000 });
    await expect(svg(page).getByText("ILLUSTRATIVE ONLY · NO RECORDED TRADE")).toBeAttached();
  });

  test("the network grows by itself once, Pause stops it, Back to start returns to one agent, Explore agent plays it again", async ({ page }) => {
    await page.goto("/");
    const controls = net(page).locator(".pn-head .pn-controls");
    await controls.scrollIntoViewIfNeeded();
    // Scrolling the network into view starts one automatic growth.
    await expect(net(page)).toHaveAttribute("data-playing", "1");
    await expect.poll(async () => Number(await net(page).getAttribute("data-phase")), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await controls.getByRole("button", { name: "Pause" }).click();
    await expect(net(page)).toHaveAttribute("data-playing", "0");
    const frozen = await net(page).getAttribute("data-phase");
    await page.waitForTimeout(4500);
    expect(await net(page).getAttribute("data-phase")).toBe(frozen);
    await controls.getByRole("button", { name: "Back to start" }).click();
    await expect(net(page)).toHaveAttribute("data-phase", "0");
    await controls.getByRole("button", { name: "Explore agent" }).click();
    await expect(net(page)).toHaveAttribute("data-playing", "1");
    await expect(shown(page, "stage").first()).toBeAttached();
  });

  test("a Preview agent never grows and never appears paper ready", async ({ page }) => {
    await page.goto("/");
    await net(page).locator(".pn-agents").getByRole("button", { name: /Covered Call/ }).click();
    await expect(card(page).getByRole("heading", { name: "Covered Call" })).toBeVisible();
    await expect(card(page).getByText("Not yet available", { exact: true })).toBeVisible();
    await expect(card(page).getByText("Paper ready")).toHaveCount(0);
    await expect(svg(page).getByText("PREVIEW", { exact: true })).toBeAttached();
    await expect(net(page).locator(".pn-head .pn-controls")).toHaveCount(0);
    await expect(shown(page, "stage")).toHaveCount(0);
    await net(page).locator(".pn-agents").getByRole("button", { name: /Protective Put/ }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(svg(page).getByText("PAPER AGENT", { exact: true })).toBeAttached();
  });

  test("the root and every node work from the keyboard", async ({ page }) => {
    await page.goto("/");
    const root = svg(page).getByRole("button", { name: /^Protective Put\. Paper agent/ });
    await root.focus();
    await expect(root).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(net(page)).not.toHaveAttribute("data-phase", "0");
    await state(page, 4).click();
    const gate = svg(page).getByRole("button", { name: /^Gate stage/ });
    await gate.focus();
    await page.keyboard.press("Space");
    await expect(card(page).getByRole("heading", { name: "Gate" })).toBeVisible();
    await expect(gate).toHaveAttribute("aria-pressed", "true");
    const calmo = svg(page).getByRole("button", { name: /^Calmo,/ });
    await calmo.focus();
    await page.keyboard.press("Enter");
    await expect(card(page).getByRole("heading", { name: "Calmo" })).toBeVisible();
    // Nodes that have not grown yet are not in the tab order.
    await state(page, 1).click();
    await expect(svg(page).locator('.pn-n[data-kind="hook"]').first()).toHaveCSS("visibility", "hidden");
  });
});

test.describe("Optra Agent Network (compact)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("grows as a vertical branching sequence instead of a shrunken canvas", async ({ page }) => {
    await page.goto("/");
    await expect(net(page).locator(".pn-stage")).toBeHidden();
    const pm = net(page).locator(".pm");
    await expect(pm).toBeVisible();
    await expect(pm.getByRole("button", { name: /Protective Put/ })).toBeVisible();
    await pm.getByRole("button", { name: "Explore agent" }).click();
    await pm.getByRole("button", { name: /^State 4:/ }).click();
    const tree = pm.getByRole("list", { name: "Protective Put hook stages" });
    await expect(tree.locator(".pm-stage[data-show='1']")).toHaveCount(6);
    await tree.getByRole("button", { name: "Calmo" }).click();
    await expect(pm.locator(".pm-card").getByRole("heading", { name: "Calmo" })).toBeVisible();
    await tree.getByRole("button", { name: /7 locked/ }).click();
    await expect(pm.locator(".pm-card").getByText("cannot take part in an evaluation")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test("with reduced motion the complete network is shown without growth, and nothing pulses", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(net(page)).toHaveAttribute("data-phase", "0");
  const visible = await page.evaluate(() => [...document.querySelectorAll(".pn-svg .pn-n")].filter((el) => getComputedStyle(el).visibility === "visible").length);
  expect(visible).toBe(1 + 5 + 10 + 5 + 5 + 2);
  expect(await page.evaluate(() => [...document.querySelectorAll(".pn .pn-pulse, .pn .pn-ring-scan")].filter((el) => getComputedStyle(el).display !== "none").length)).toBe(0);
  await expect(net(page).getByText("COMPLETE NETWORK").first()).toBeVisible();
  // Selection still works, and the flow shows its result immediately.
  await svg(page).getByRole("button", { name: /^Calmo,/ }).click();
  await expect(card(page).getByRole("heading", { name: "Calmo" })).toBeVisible();
  await page.keyboard.press("Escape");
  await svg(page).getByRole("button", { name: /^Protective Put\. Paper agent/ }).click();
  await card(page).getByRole("button", { name: "View decision flow" }).click();
  await expect(card(page).getByText("Entry blocked by calmo.")).toBeVisible({ timeout: 1500 });
});

test("without JavaScript the full network is in the page", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  const visible = await page.evaluate(() => [...document.querySelectorAll(".pn-svg .pn-n")].filter((el) => getComputedStyle(el).visibility === "visible").length);
  expect(visible).toBe(28);
  await expect(svg(page).getByText("Protective Put").first()).toBeVisible();
  await expect(svg(page).getByText("BREAKER · ALWAYS ON")).toBeVisible();
  await context.close();
});

test.describe("section visuals", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Forge shows the real validator's message when a required hook is removed", async ({ page }) => {
    await page.goto("/");
    const forge = page.locator("#forge");
    await expect(forge.getByText("Valid", { exact: true })).toBeVisible();
    await expect(forge.getByLabel("Recipe hash")).toContainText("sha256:");
    await forge.getByRole("button", { name: "Calmo" }).click();
    await expect(forge.getByText("Blocked", { exact: true })).toBeVisible();
    await expect(forge.getByText("Protective Put requires calmo.")).toBeVisible();
    await forge.getByRole("button", { name: "Haltr" }).click();
    await expect(forge.getByText("Recipe exceeds a PM stage limit or omits a mandatory Breaker.")).toBeVisible();
    await forge.getByRole("button", { name: "Restore recipe" }).click();
    await expect(forge.getByText("Valid", { exact: true })).toBeVisible();
    await forge.getByRole("button", { name: /Volra/ }).click();
    await expect(forge.getByText("Volra is locked.")).toBeVisible();
  });

  test("Tape expands an illustrative tick and labels it", async ({ page }) => {
    await page.goto("/");
    const tape = page.locator("#tape");
    await expect(tape.getByText("Illustrative paper example. Not a recorded trade.")).toBeVisible();
    await tape.getByRole("button", { name: /Tick 3/ }).click();
    await expect(tape.getByRole("button", { name: /Tick 3/ })).toHaveAttribute("aria-expanded", "true");
    await expect(tape.getByText("Opened modeled one-share Protective Put units for paper execution.").first()).toBeVisible();
    await expect(tape.getByRole("button", { name: /Tick 1/ })).toHaveAttribute("aria-expanded", "false");
  });

  test("Risk rails show the recipe defaults and Lab shows no performance numbers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Stops entries at 7%")).toBeVisible();
    await expect(page.getByText("Stops entries at 3%")).toBeVisible();
    await expect(page.getByText("Stops entries at 20%")).toBeVisible();
    await expect(page.getByText("Stops entries at 25%")).toBeVisible();
    const lab = page.locator("#lab");
    await expect(lab.getByText("Not yet available")).toBeVisible();
    expect(await lab.innerText()).not.toMatch(/\$\s?\d|[+\-−]\s?\d+(\.\d+)?\s?%/);
  });
});
