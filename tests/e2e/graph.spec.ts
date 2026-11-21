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
    await expect(svg(page).getByRole("button", { name: /^Protective Put\. Agent/ })).toBeAttached();
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
    await net(page).scrollIntoViewIfNeeded();
    await expect(net(page)).toBeInViewport({ ratio: 0.12 });
    await expect(net(page)).toHaveAttribute("data-playing", "1");
    await state(page, 6).click();
    await expect(net(page)).toHaveAttribute("data-phase", "5");
    await expect(net(page)).toHaveAttribute("data-playing", "0");
    await page.waitForTimeout(2200);
    await expect(net(page)).toHaveAttribute("data-phase", "5");
    // Let the decision flow reach its decision stage, then use reduced motion when
    // switching scenarios so the asserted explanation does not depend on autoplay.
    await net(page).getByRole("button", { name: "View decision flow" }).first().click();
    await expect(card(page).getByText("Illustrative only", { exact: true }).first()).toBeVisible();
    const decision = card(page).getByRole("button", { name: /Paper decision The verdicts become one action/ });
    await expect(decision).toBeEnabled({ timeout: 15_000 });
    await decision.click();
    await expect(card(page).getByText("Entry blocked by calmo.", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await card(page).getByRole("button", { name: "Entry opens" }).click();
    await expect(card(page).locator(".pn-result-text")).toHaveText("Opened modeled one-share Protective Put units for paper execution.", { timeout: 15_000 });
    await expect(svg(page).getByText("ILLUSTRATIVE ONLY · NO RECORDED TRADE")).toBeAttached();
  });

  test("the network grows by itself once, Pause stops it, Back to start returns to one agent, Explore agent plays it again", async ({ page }) => {
    await page.goto("/");
    const controls = net(page).locator(".pn-head .pn-controls");
    await net(page).scrollIntoViewIfNeeded();
    await expect(net(page)).toBeInViewport({ ratio: 0.12 });
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
    await expect(card(page).getByText("Strategy overview", { exact: true }).first()).toBeVisible();
    await expect(card(page).getByText("Paper ready")).toHaveCount(0);
    await expect(svg(page).getByText("PREVIEW", { exact: true })).toBeAttached();
    await expect(net(page).locator(".pn-head .pn-controls")).toHaveCount(0);
    await expect(shown(page, "stage")).toHaveCount(0);
    const paperAgent = net(page).locator(".pn-agents").getByRole("button", { name: /Protective Put/ });
    await paperAgent.click();
    await expect(card(page)).toHaveCount(0);
    await expect(svg(page).getByText("AGENT", { exact: true })).toBeAttached();
  });

  test("the root and every node work from the keyboard", async ({ page }) => {
    await page.goto("/");
    const root = svg(page).getByRole("button", { name: /^Protective Put\. Agent/ });
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
  await svg(page).getByRole("button", { name: /^Protective Put\. Agent/ }).click();
  await card(page).getByRole("button", { name: "View decision flow" }).click();
  await expect(card(page).getByText("Entry blocked by calmo.")).toBeVisible({ timeout: 1500 });
});

test("network autoplay pauses offscreen and resumes when the story returns", async ({ page }) => {
  await page.goto("/");
  await net(page).scrollIntoViewIfNeeded();
  await expect(net(page)).toBeInViewport({ ratio: 0.12 });
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

test("Save-Data leaves the network still, while keeping controls available", async ({ page }) => {
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

  test("the story walks four steps, in both directions, and links to the real screens", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const section = page.locator("#story");
    await section.scrollIntoViewIfNeeded();
    const steps = section.locator(".ps-nav li button");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
    await expect(section.getByRole("link", { name: "Open Forge" })).toHaveAttribute("href", "/forge");
    await steps.nth(1).click();
    await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
    await expect(section.getByText("721 warm-up candles")).toBeVisible();
    await expect(section.getByText("720 decisions")).toBeVisible();
    await expect(section.getByText("no numbers are shown here", { exact: false })).toBeVisible();
    await expect(section.getByRole("link", { name: "Open the Lab" })).toHaveAttribute("href", "/lab");
    await steps.nth(2).click();
    await expect(section.getByText("Regular hours", { exact: true }).first()).toBeVisible();
    await expect(section.getByText("New entries allowed")).toHaveCount(1);
    await expect(section.getByText("Five breakers watch every tick.")).toBeVisible();
    await expect(section.getByRole("link", { name: "Open Agents" })).toHaveAttribute("href", "/agents");
    await steps.nth(3).click();
    await expect(section.getByText("Not a recorded trade", { exact: false })).toBeVisible();
    await section.getByRole("button", { name: /Opened a modeled put/ }).click();
    await expect(section.getByText("Every rule agreed, so the agent bought a modeled put on paper.")).toBeVisible();
    await expect(section.getByRole("link", { name: "Open the Tape" })).toHaveAttribute("href", "/tape");
    await steps.nth(0).click();
    await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
    await expect(section.getByText("May the agent enter now?")).toBeVisible();
  });

  test("the story becomes tabs on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const section = page.locator("#story");
    await section.scrollIntoViewIfNeeded();
    const steps = section.locator(".ps-nav li button");
    await steps.nth(2).click();
    await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
    await expect(section.getByText("Five breakers watch every tick.")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Proof lists the server's claims with evidence and keeps MCP and x402 planned", async ({ page }) => {
    await page.goto("/");
    const proof = page.locator("#proof");
    await proof.scrollIntoViewIfNeeded();
    await expect(proof.getByRole("list", { name: "Claims from the server" }).getByRole("listitem")).toHaveCount(6);
    await expect(proof.getByRole("link", { name: /Evidence: \/api\/public\/v1\/hooks/ })).toBeVisible();
    await expect(proof.getByText('curl -s "$OPTRA_URL/api/public/v1/hooks"')).toBeVisible();
    await expect(proof.getByText("An MCP server and pay-per-call endpoints are planned, not built.", { exact: false })).toBeVisible();
    await expect(proof.getByRole("link", { name: "Open the Verify page" })).toHaveAttribute("href", "/verify");
  });

  test("the closing section keeps its call to action and the footer readable", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const final = page.locator(".m-final");
    await expect(final.getByRole("link", { name: "Launch an agent" })).toBeVisible();
    await expect(final.getByRole("link", { name: "See what is verified" })).toHaveAttribute("href", "/verify");
    await expect(page.locator(".m-footer")).toBeVisible();
  });


});
