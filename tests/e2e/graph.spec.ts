import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Scroll to a fraction of a pinned story's travel and report its pin offset and active step. */
async function story(page: Page, section: string, fraction: number) {
  await page.evaluate(([sel, f]) => {
    const track = document.querySelector(`${sel} .ps`) as HTMLElement;
    const pin = track.querySelector(".ps-pin") as HTMLElement;
    const top = track.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - 104 + (track.offsetHeight - pin.offsetHeight) * (f as number));
  }, [section, fraction] as [string, number]);
  await page.waitForTimeout(450);
  return page.evaluate((sel) => ({ step: Number((document.querySelector(`${sel} .ps`) as HTMLElement).dataset.step), pin: Math.round((document.querySelector(`${sel} .ps-pin`) as HTMLElement).getBoundingClientRect().top) }), section);
}

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

  test("grows outward through six states and every branch ends on its node", async ({ page }) => {
    await page.goto("/");
    // A node blooms at the end of the branch that reaches it, so it is always attached: the Calmo branch ends exactly on Calmo.
    const attached = await page.evaluate(() => {
      const get = (el: Element | null, name: string) => parseFloat((el as SVGGElement).style.getPropertyValue(name));
      const hook = [...document.querySelectorAll('.pn-svg .pn-n[data-kind="hook"]')].find((el) => el.getAttribute("aria-label")?.startsWith("Calmo"))!;
      const own = [get(hook, "--ox"), get(hook, "--oy")];
      const current = [get(hook, "--cx"), get(hook, "--cy")];
      const ends = [...document.querySelectorAll('.pn-svg .pn-edge[data-kind="hook"] .pn-line')].map((path) => (path.getAttribute("d") ?? "").trim().split(/[\s,]+/).slice(-2).map(Number));
      return { own, current, hasBranch: ends.some((end) => Math.abs(end[0]! - own[0]!) < 0.2 && Math.abs(end[1]! - own[1]!) < 0.2) };
    });
    expect(attached.current).toEqual(attached.own);
    expect(attached.hasBranch).toBe(true);

    await state(page, 2).click();
    await expect(shown(page, "stage")).toHaveCount(5);
    await state(page, 3).click();
    await expect(shown(page, "hook")).toHaveCount(10);
    await expect(shown(page, "locked")).toHaveCount(5);
    await expect(shown(page, "risk")).toHaveCount(0);
    await state(page, 4).click();
    await expect(svg(page).locator('.pn-ring[data-show="1"]')).toHaveCount(1);
    await expect(shown(page, "risk")).toHaveCount(5);
    await expect(net(page).locator(".pn-eval-note").first()).toContainText("Illustrative evaluation");
    await expect(shown(page, "decision")).toHaveCount(0);
    await state(page, 5).click();
    // Tape follows the paper decision, so the decision node remains as its connected origin.
    await expect(shown(page, "decision")).toHaveCount(1);
    await expect(shown(page, "tape")).toHaveCount(0);
    await state(page, 6).click();
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
    await state(page, 3).click();
    await page.waitForTimeout(2200);
    const grown = await spread();
    expect(first.count).toBe(1);
    // Root + five stages + ten implemented hooks + five catalog groups.
    expect(grown.count).toBe(21);
    expect(grown.width).toBeGreaterThan(first.width * 2.5);
  });

  test("selecting a hook shows its rule, labeled output and recipe parameters, and Escape closes it", async ({ page }) => {
    await page.goto("/");
    await state(page, 3).click();
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
    await state(page, 3).click();
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
    await state(page, 6).click();
    await net(page).getByRole("button", { name: "View decision flow" }).first().click();
    await expect(card(page).getByText("Illustrative only", { exact: true }).first()).toBeVisible();
    const decision = card(page).getByRole("button", { name: /Paper decision The verdicts become one action/ });
    await expect(decision).toBeEnabled({ timeout: 15_000 });
    await decision.click();
    await expect(card(page).getByText("Entry blocked by calmo.", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await card(page).getByRole("button", { name: "Entry opens" }).click();
    await expect(card(page).getByText("Opened modeled one-share Protective Put units for paper execution.")).toBeVisible({ timeout: 15_000 });
    await expect(svg(page).getByText("ILLUSTRATIVE ONLY · NO RECORDED TRADE")).toBeAttached();
  });

  test("the network grows by itself once, Pause stops it, Back to start returns to one agent, Explore agent plays it again", async ({ page }) => {
    await page.goto("/");
    const controls = net(page).locator(".pn-head .pn-controls");
    await page.evaluate(() => document.querySelector("#agents .pn")!.scrollIntoView({ block: "start" }));
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const previewAgent = net(page).locator(".pn-agents").getByRole("button", { name: /Covered Call/ });
    await previewAgent.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(previewAgent).toBeVisible();
    await previewAgent.click();
    await expect(card(page).getByRole("heading", { name: "Covered Call" })).toBeVisible();
    await expect(card(page).getByText("Not yet available", { exact: true })).toBeVisible();
    await expect(card(page).getByText("Paper ready")).toHaveCount(0);
    await expect(svg(page).getByText("PREVIEW", { exact: true })).toBeAttached();
    await expect(net(page).locator(".pn-head .pn-controls")).toHaveCount(0);
    await expect(shown(page, "stage")).toHaveCount(0);
    const paperAgent = net(page).locator(".pn-agents").getByRole("button", { name: /Protective Put/ });
    await paperAgent.click();
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
    await state(page, 3).click();
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

test("network autoplay pauses offscreen and resumes when the story returns", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.querySelector("#agents .pn")!.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(net(page)).toHaveAttribute("data-live", "1");
  await expect(net(page)).toHaveAttribute("data-playing", "1");
  await expect.poll(async () => Number(await net(page).getAttribute("data-phase"))).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(net(page)).toHaveAttribute("data-live", "0");
  await expect(net(page)).toHaveAttribute("data-playing", "0");
  const frozen = await net(page).getAttribute("data-phase");
  await page.waitForTimeout(2100);
  await expect(net(page)).toHaveAttribute("data-phase", frozen!);

  await page.evaluate(() => document.querySelector("#agents .pn")!.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(net(page)).toHaveAttribute("data-live", "1");
  await expect.poll(async () => Number(await net(page).getAttribute("data-phase"))).toBeGreaterThan(Number(frozen));
});

test("Save-Data leaves the network and Forge demo still, while keeping controls available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true, addEventListener() {}, removeEventListener() {} },
    });
  });
  await page.goto("/");

  const network = net(page);
  await page.evaluate(() => document.querySelector("#agents .pn")!.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(network).toHaveAttribute("data-save-data", "1");
  await expect(network).toHaveAttribute("data-playing", "0");
  await expect(network.getByRole("button", { name: "Explore agent" }).first()).toBeEnabled();

  const forge = page.locator("#forge .fs");
  await page.evaluate(() => document.querySelector("#forge .fs")!.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(forge).toHaveAttribute("data-save-data", "1");
  await expect(forge.getByText("Demonstration running")).toHaveCount(0);
  await expect(forge.getByRole("button", { name: "Replay" })).toBeEnabled();
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

  test("Forge studio shows the real validator's message when a required rule is removed", async ({ page }) => {
    await page.goto("/");
    const forge = page.locator("#forge");
    await expect(forge.getByText("Valid", { exact: true })).toBeVisible();
    await expect(forge.getByText(/Realized volatility ratio at most 1\.2/)).toBeVisible();
    // The technical hash is one disclosure away, not the headline.
    await forge.getByText("Technical details").click();
    await expect(forge.getByLabel("Recipe hash")).toContainText("sha256:");
    await forge.getByRole("button", { name: "Calmo" }).click();
    await expect(forge.getByText("Blocked", { exact: true })).toBeVisible();
    await expect(forge.getByText("Protective Put requires calmo.")).toBeVisible();
    await expect(forge.getByText(/Realized volatility ratio at most 1\.2/)).toBeHidden();
    await forge.getByRole("button", { name: "Haltr" }).click();
    await expect(forge.getByText("Recipe exceeds a PM stage limit or omits a mandatory Breaker.")).toBeVisible();
    await forge.getByRole("button", { name: "Restore recipe" }).click();
    // Restoring hands the studio back to scroll; the last step is the validated recipe.
    await expect.poll(async () => (await story(page, "#forge", 0.95)).step).toBe(4);
    const workflow = forge.getByRole("tablist", { name: "Protective Put workflow" });
    await expect(workflow.getByRole("tab")).toHaveCount(5);
    await expect(workflow.getByRole("tab", { name: /Decision & Tape/ })).toHaveAttribute("aria-selected", "true");
    await expect(forge.getByText("Valid", { exact: true })).toBeVisible();
    // Only the 15 rules that run are shown by default; the 21 locked ones sit behind one disclosure.
    await expect(forge.getByRole("button", { name: /Volra/ })).toBeHidden();
    await forge.getByText("Show the 21 locked rules").click();
    await forge.getByRole("button", { name: /Volra/ }).click();
    await expect(forge.getByText("Volra is locked.")).toBeVisible();
    await forge.locator(".fs-agents").scrollIntoViewIfNeeded();
    await forge.locator(".fs-agent").filter({ hasText: "Covered Call" }).click();
    await expect(forge.locator(".fs-note")).toContainText("Covered Call is not available.");
  });

  test("the Tape replay is pinned, follows scroll, names the blocking hook, and never changes the picked tick by itself", async ({ page }) => {
    await page.goto("/");
    const tape = page.locator("#tape");
    await expect(tape.getByText("Illustrative example", { exact: true })).toBeVisible();
    await expect(tape.getByRole("button", { name: /Tick 1/ })).toHaveAttribute("aria-pressed", "true");
    // Forward: input, hooks, guard, decision, record.
    await expect.poll(async () => (await story(page, "#tape", 0.05)).step).toBe(0);
    await expect(tape.getByText("Latest closed hourly candle and the current quote")).toBeVisible();
    const mid = await story(page, "#tape", 0.3);
    expect(mid.pin).toBe(104);
    await expect.poll(async () => (await story(page, "#tape", 0.3)).step).toBe(1);
    await expect(tape.getByText("Sessia blocked").first()).toBeVisible();
    await expect.poll(async () => (await story(page, "#tape", 0.5)).step).toBe(2);
    await expect(tape.getByText("All five Breakers passed on this tick.")).toBeVisible();
    await expect.poll(async () => (await story(page, "#tape", 0.7)).step).toBe(3);
    await expect(tape.locator('.ps-view[data-state="active"]').getByText("The market was closed. Entries are only allowed in regular US trading hours.")).toBeVisible();
    await expect.poll(async () => (await story(page, "#tape", 0.95)).step).toBe(4);
    await expect(tape.getByRole("link", { name: /Open the Tape/ })).toHaveAttribute("href", "/tape");
    await expect(tape.getByRole("button", { name: /Tick 1/ })).toHaveAttribute("aria-pressed", "true");
    // Reverse
    await expect.poll(async () => (await story(page, "#tape", 0.05)).step).toBe(0);
    // Picking another tick changes the evidence and nothing else moves it.
    await tape.getByRole("button", { name: /Tick 2/ }).click();
    await tape.getByRole("button", { name: /Hook evaluations/ }).click();
    await expect(tape.getByText("Calmo blocked").first()).toBeVisible();
    await tape.getByRole("button", { name: /Tick 3/ }).click();
    await tape.getByRole("button", { name: /Paper decision/ }).click();
    await expect(tape.locator('.ps-view[data-state="active"]').getByText("Every rule agreed, so the agent opened a modeled put on paper.")).toBeVisible();
    await tape.getByRole("button", { name: /Tape record/ }).click();
    await tape.getByText("Show every rule and the engine's wording").click();
    await expect(tape.getByText("Opened modeled one-share Protective Put units for paper execution.")).toBeVisible();
    await expect(tape.getByText("Venux pass")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(tape.getByRole("button", { name: /Tick 3/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("the how-it-works story is pinned, follows scroll in both directions, releases, and links to the real routes", async ({ page }) => {
    await page.goto("/");
    const how = page.locator("#how");
    await expect(how.getByRole("button", { name: /Configure a strategy/ })).toHaveAttribute("aria-current", "step");
    await expect(how.getByRole("link", { name: /Configure in Agents/ })).toHaveAttribute("href", "/agents#configure");
    const first = await story(page, "#how", 0.3);
    expect(first.pin).toBe(104);
    await expect.poll(async () => (await story(page, "#how", 0.3)).step).toBe(1);
    await expect(how.getByRole("link", { name: /Open the Lab/ })).toHaveAttribute("href", "/lab");
    await expect(how.getByText("Results appear only after a complete run in the app. No numbers are shown here.")).toBeVisible();
    expect((await story(page, "#how", 0.55)).pin).toBe(104);
    await expect.poll(async () => (await story(page, "#how", 0.55)).step).toBe(2);
    await expect(how.getByRole("link", { name: /Open Agents/ })).toHaveAttribute("href", "/agents");
    await expect.poll(async () => (await story(page, "#how", 0.95)).step).toBe(3);
    await expect(how.getByText("Illustrative example. Not a recorded trade.")).toBeVisible();
    await expect(how.getByRole("link", { name: /Open the Tape/ })).toHaveAttribute("href", "/tape");
    // Reverse
    await expect.poll(async () => (await story(page, "#how", 0.3)).step).toBe(1);
    // Release: past the end the pin scrolls away with the section instead of sticking.
    await page.evaluate(() => { const t = document.querySelector("#how .ps") as HTMLElement; window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY + t.offsetHeight + 120); });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => Math.round(document.querySelector("#how .ps-pin")!.getBoundingClientRect().top))).toBeLessThan(0);
    // Click and keyboard: a step button moves the story and the scroll position together, and the story does not bounce back.
    await how.getByRole("button", { name: /Run on paper/ }).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1300);
    await expect.poll(async () => (await story(page, "#how", 0.55)).step, { timeout: 5000 }).toBe(2);
    await expect(how.getByRole("button", { name: /Run on paper/ })).toHaveAttribute("aria-current", "step");
  });

  test("the how-it-works story becomes tabs of illustrated screens on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const how = page.locator("#how");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#how .ps-pin")!).position)).toBe("static");
    await how.getByRole("button", { name: /Inspect every decision/ }).click();
    await expect(how.getByText("Illustrative example. Not a recorded trade.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("the pinned stories fall back to scrollable steps at tablet width without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/");
    const hooks = page.locator("#hooks");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#hooks .ps-pin")!).position)).toBe("static");
    await hooks.getByRole("navigation", { name: "Hook stages" }).getByRole("button", { name: /^EXPIRY\b/i }).click();
    await expect(hooks.locator('.ps-view[data-state="active"] h3')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test("the pinned story keeps its stages visible without motion and disables the evaluation pulse", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const hooks = page.locator("#hooks");
    await expect(hooks.getByRole("button", { name: /Gate/i })).toBeVisible();
    await expect(hooks.getByRole("button", { name: /Breaker/i })).toBeVisible();
    expect(await hooks.locator(".fp-pulse").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    await hooks.getByRole("button", { name: /Breaker/i }).click();
    await expect(hooks.locator('.ps-view[data-state="active"] h3')).toBeVisible();
  });

  test("the Forge demonstration stops when users interact with the studio", async ({ page }) => {
    await page.goto("/");
    const forge = page.locator("#forge");
    await story(page, "#forge", 0.01);
    await expect(forge.getByText("Demonstration running")).toBeVisible({ timeout: 4000 });
    await expect(forge.getByText(/runs no backtest and no paper tick/)).toBeVisible();
    await forge.getByRole("button", { name: "Pause" }).click();
    await expect(forge.getByText("Demonstration", { exact: true })).toBeVisible();
    await forge.getByRole("button", { name: "Replay" }).click();
    await expect(forge.getByText("Demonstration running")).toBeVisible();
    await forge.getByRole("button", { name: "Calmo" }).click();
    await expect(forge.getByText("Demonstration", { exact: true })).toBeVisible();
    await expect(forge.getByText("Blocked", { exact: true })).toBeVisible();
    await forge.getByRole("button", { name: "Restore recipe" }).click();
    await expect(forge.getByText("Valid", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(forge.getByRole("link", { name: /Backtest in Lab/ })).toHaveAttribute("href", "/lab");
  });

  test("the Forge studio is pinned and scroll drives it: select, configure, validate, continue to Lab", async ({ page }) => {
    await page.goto("/");
    const forge = page.locator("#forge");
    const at = async (f: number) => story(page, "#forge", f);
    expect((await at(0.3)).pin).toBe(104);
    await expect.poll(async () => (await at(0.3)).step).toBe(1);
    await expect(forge.getByText("Building")).toBeVisible();
    await expect.poll(async () => (await at(0.55)).step).toBe(2);
    await expect(forge.getByText("Validating…")).toBeVisible();
    await expect.poll(async () => (await at(0.95)).step).toBe(4);
    const workflow = forge.getByRole("tablist", { name: "Protective Put workflow" });
    await expect(workflow.getByRole("tab")).toHaveCount(5);
    await expect(workflow.getByRole("tab", { name: /Decision & Tape/ })).toHaveAttribute("aria-selected", "true");
    await expect(forge.getByText("Valid", { exact: true })).toBeVisible();
    await expect(forge.getByText("Demonstration running")).toHaveCount(0);
    // Reverse
    await expect.poll(async () => (await at(0.3)).step).toBe(1);
    await expect(forge.getByText("Building")).toBeVisible();
    // The rail is clickable and the real validator still answers when a rule is removed.
    await workflow.getByRole("tab", { name: /Recipe validation/ }).click();
    await expect(forge.locator(".fww")).toHaveAttribute("data-active-stage", "2");
    await page.waitForTimeout(1200);
    await forge.getByRole("button", { name: "Calmo" }).click();
    await expect(forge.getByText("Protective Put requires calmo.")).toBeVisible();
  });

  test("Lab is a pinned four-stage story, stays in step with clicks, and promises no numbers it does not have", async ({ page }) => {
    await page.goto("/");
    const lab = page.locator("#lab");
    await expect(lab.getByRole("heading", { name: "Test the strategy before you run it." })).toBeVisible();
    expect((await story(page, "#lab", 0.1)).pin).toBe(104);
    await expect.poll(async () => (await story(page, "#lab", 0.4)).step).toBe(1);
    await expect(lab.getByText(/Black–Scholes/).first()).toBeVisible();
    await expect.poll(async () => (await story(page, "#lab", 0.95)).step).toBe(3);
    await expect(lab.getByText("Process illustration · no market prices are plotted.")).toBeVisible();
    await expect(lab.getByRole("link", { name: /Test a strategy in the Lab/ })).toHaveAttribute("href", "/lab");
    await expect.poll(async () => (await story(page, "#lab", 0.05)).step).toBe(0);
    await lab.getByRole("button", { name: /Strategy replay/ }).click();
    await page.waitForTimeout(1300);
    await expect(lab.getByRole("button", { name: /Strategy replay/ })).toHaveAttribute("aria-current", "step");
    expect(await lab.innerText()).not.toMatch(/\$\s?\d|[+\-−]\s?\d+(\.\d+)?\s?%/);
  });

  test("Sessions marks only regular hours as allowed and never claims the market is open now", async ({ page }) => {
    await page.goto("/");
    const sessions = page.locator("#sessions");
    const bar = sessions.getByRole("group", { name: /24 hour US trading day/ });
    await expect(bar.getByText("Entries allowed")).toHaveCount(1);
    await expect(bar.getByText("Entries blocked")).toHaveCount(4);
    await bar.getByRole("button", { name: /Pre-market/ }).click();
    await expect(sessions.getByText("New entries blocked")).toBeVisible();
    await expect(sessions.getByText(/does not show whether the market is open right now/)).toBeVisible();
    await expect(sessions.getByText("Opening Bell and Closing Bell choices are Planned.")).toBeVisible();
  });

  test("the Breaker panel shows real limits and its demo slider changes nothing real", async ({ page }) => {
    await page.goto("/");
    const risk = page.locator("#sessions .bp");
    await expect(risk.getByText("Stops new entries at 7%")).toBeVisible();
    await risk.getByRole("button", { name: "Daylo" }).click();
    await expect(risk.getByText("Stops new entries at 3%")).toBeVisible();
    await expect(risk.getByText("ILLUSTRATION ONLY", { exact: false })).toBeVisible();
    await risk.getByRole("slider").fill("8");
    await expect(risk.getByRole("status")).toContainText("blocked");
    await risk.getByRole("slider").fill("1");
    await expect(risk.getByRole("status")).toContainText("allowed");
    await risk.getByRole("button", { name: "Drawra" }).click();
    await expect(risk.getByText("Stops new entries at 20%")).toBeVisible();
    await risk.getByRole("button", { name: "Exposa" }).click();
    await expect(risk.getByText("Stops new entries at 25%")).toBeVisible();
    await risk.getByRole("button", { name: "Venux" }).click();
    await expect(risk.getByText("Venue spread and error-rate checks are unavailable")).toBeVisible();
  });

  test("Dual Mode shows Agent mode as working and Manual mode as planned without a control", async ({ page }) => {
    await page.goto("/");
    const dual = page.locator("#dual");
    await expect(dual.getByText("Working on paper")).toBeVisible();
    await expect(dual.getByText("Not available. No route or service exists yet.")).toBeVisible();
    await expect(dual.getByRole("button")).toHaveCount(0);
    await expect(dual.getByRole("link", { name: "Launch a paper agent" })).toHaveAttribute("href", "/agents");
  });

  test("Developers shows real responses, copies them, and keeps MCP and x402 planned", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const dev = page.locator("#developers");
    await expect(dev.getByText("/api/public/v1/hooks").first()).toBeVisible();
    await expect(dev.getByText('"expectedCount"')).toBeVisible();
    await dev.getByRole("button", { name: /Public Tape/ }).click();
    await expect(dev.getByText('"executionMode"')).toBeVisible();
    await expect(dev.getByText("Always empty today")).toBeVisible();
    await dev.getByRole("button", { name: "Copy request" }).click();
    await expect(dev.getByText("Copied").first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('curl -s "$OPTRA_URL/api/public/v1/tape"');
    await expect(dev.locator(".dd-nav").getByText("MCP server")).toBeVisible();
    await expect(dev.locator('[aria-disabled="true"]')).toHaveCount(2);
  });

  test("Verify groups the server's claims and opens evidence on demand", async ({ page }) => {
    await page.goto("/");
    const verify = page.locator("#verify");
    await expect(verify.getByText("claims from the server")).toBeVisible();
    await expect(verify.getByRole("region", { name: "Safety boundaries" })).toBeVisible();
    const row = verify.locator(".ev-row", { hasText: "Hook catalog" });
    await expect(row.getByRole("link")).toBeHidden();
    await row.locator("summary").click();
    await expect(row.getByRole("link", { name: /\/api\/public\/v1\/hooks/ })).toBeVisible();
  });

  test("the closing section keeps its call to action and the footer readable", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const final = page.locator(".m-final");
    await expect(final.getByRole("link", { name: "Launch app" })).toBeVisible();
    await expect(final.getByRole("link", { name: "Inspect what is verified" })).toHaveAttribute("href", "/verify");
    await expect(page.locator(".m-footer")).toBeVisible();
  });


});
