import { expect, test } from "@playwright/test";

test("landing states the product within the first viewport and keeps the paper-first boundary", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "No-Code Options Trading Agents." })).toBeVisible();
  await expect(page.locator("#intro").getByText("BUILD · DEPLOY · CONTROL", { exact: true })).toBeVisible();
  await expect(page.getByText("No deposit needed. Options are synthetic and modeled from Robinhood Chain stock-token prices. Not shares, not investment advice.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch an agent" }).first()).toHaveAttribute("href", "/agents");
  await expect(page.getByRole("link", { name: "See the protective floor" })).toHaveAttribute("href", "#floor");
  // The hero preview is the real Agents screen: same sidebar, journey rail and template cards, read-only.
  const preview = page.locator(".hero-card .preview-shell");
  await expect(preview).toHaveAttribute("role", "group");
  await expect(preview.getByRole("link", { name: /Open app/ })).toHaveAttribute("href", "/agents");
  await expect(preview.locator(".sidebar-link", { hasText: "Agents" })).toHaveAttribute("aria-current", "page");
  await expect(preview.getByText("Protective Put", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Paper ready", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Preview", { exact: true })).toHaveCount(0);
  await expect(page.getByText("26 of 36 hooks implemented", { exact: true })).toBeVisible();
});

test("landing capability claims match the catalog and roadmap items are not presented as available", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("26 of 36 hooks implemented", { exact: true })).toBeVisible();
  const proof = page.locator("#proof");
  await expect(proof.getByText("Live execution")).toBeVisible();
  await expect(proof.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(proof.getByText("An MCP server and pay-per-call endpoints are planned, not built.", { exact: false })).toBeVisible();
  await expect(proof.locator('.xm-card[data-mode="live"]').getByText("Wallet-signed", { exact: true })).toBeVisible();
  await expect(proof.locator('.xm-card[data-mode="live"]').getByText("Planned", { exact: true })).toHaveCount(0);
  await expect(page.locator("#agents .pn-agents").getByText("Paper ready", { exact: true })).toHaveCount(4);
  await expect(page.locator("#agents .pn-agents").getByText("Preview", { exact: true })).toHaveCount(0);
});

test("every landing navigation anchor resolves to a section that exists", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page.locator(".m-nav a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(3);
  for (const href of hrefs) {
    // Sections on this page are anchors; the Hooks and Lab entries open their own app screens.
    if (href?.startsWith("/")) continue;
    expect(href).toMatch(/^#/);
    await expect(page.locator(href as string)).toHaveCount(1);
  }
});

test("mobile landing has no horizontal overflow and the menu closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const menuButton = page.getByRole("button", { name: "Open page sections" });
  await expect(menuButton.locator("svg")).toHaveCount(1);
  await expect(menuButton).toHaveText("");
  const menuButtonSize = await menuButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(menuButtonSize.width).toBeGreaterThanOrEqual(44);
  expect(menuButtonSize.height).toBeGreaterThanOrEqual(44);
  await menuButton.click();
  const drawer = page.getByRole("dialog");
  const floorLink = drawer.getByRole("link", { name: "Floor", exact: true });
  await expect(floorLink).toBeVisible();
  await expect(drawer.getByRole("link", { name: "How it works" })).toBeVisible();
  const layers = await page.evaluate(() => {
    const zIndex = (selector: string) => Number.parseInt(getComputedStyle(document.querySelector(selector)!).zIndex, 10);
    return {
      header: zIndex(".m-header"),
      panel: zIndex('[data-slot="sheet-content"]'),
      overlay: zIndex('[data-slot="sheet-overlay"]'),
    };
  });
  expect(layers.panel, "menu panel must paint above the sticky header").toBeGreaterThan(layers.header);
  expect(layers.overlay, "menu backdrop must paint above the sticky header").toBeGreaterThan(layers.header);
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
  await expect(page.getByRole("heading", { level: 1, name: "No-Code Options Trading Agents." })).toBeVisible();
  await expect(page.locator(".hero-card").getByText("Protective Put", { exact: true }).first()).toBeVisible();
});

test("reduced motion still renders the hero without an error", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "No-Code Options Trading Agents." })).toBeVisible();
  await expect(page.locator(".hero-stage")).not.toHaveAttribute("data-laser", "pending");
  expect(errors).toEqual([]);
});

const sectionIds = ["agents", "studio", "story", "proof", "faq"];

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
    await expect(page.getByRole("heading", { level: 1, name: "No-Code Options Trading Agents." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Launch an agent" }).first()).toBeVisible();
    await expect(page.locator(".hero-beam-fallback")).toBeAttached();
    await expect(page.locator(".hero-card .preview-shell")).toBeAttached();
    for (const id of [...sectionIds, "floor"]) await expect(page.locator(`#${id} h2`).first()).toBeAttached();
    await expect(page.getByText("From rules to a reasoned decision.")).toBeVisible();
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
});

test("reduced motion shows every section at full opacity without scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const opacities = await page.evaluate(() => [...document.querySelectorAll(".reveal, .reveal-lead, .reveal-stagger > *, .draw")].map((el) => parseFloat(getComputedStyle(el).opacity)));
  expect(opacities.length).toBeGreaterThan(3);
  expect(Math.min(...opacities)).toBe(1);
});

test("the opening plays on every page load, can be skipped, never blocks the page, and does not replay on in-site navigation", async ({ page }) => {
  // The assertion timeouts below add up to more than the default 30 s cap; software-rendered runners that starve
  // animation frames use most of them (14 s on a fast run, about 32 s on a slow one).
  test.setTimeout(90_000);
  await page.goto("/");
  const splash = page.locator(".splash");
  await expect(splash).toHaveAttribute("data-state", /boot|form|cast/, { timeout: 15000 });
  // The loader names what it is doing and counts along its own timeline.
  await expect(splash.locator(".splash-status-line")).toHaveText(/AGENT CAST|RULE STAGES|ROUTES|READY TO LAUNCH/);
  await expect(splash.locator(".splash-count")).toContainText("%");
  // The page underneath stays operable while the opening plays.
  await expect(page.getByRole("link", { name: "Launch an agent" }).first()).toBeVisible();
  await page.keyboard.press("Space");
  await expect(splash).toHaveAttribute("data-state", "gone", { timeout: 4000 });
  await expect(page.locator("html")).toHaveAttribute("data-splash", "done");

  // A reload is a new page load: the opening plays again.
  await page.reload();
  const reloadedSplash = page.locator(".splash");
  // Starved animation frames (software WebGL on CI) make the opening's own fallback timer skip "cast", so any playing state proves it replayed.
  await expect(reloadedSplash).toHaveAttribute("data-state", /boot|form|cast/, { timeout: 15000 });
  await page.keyboard.press("Space");
  await expect(reloadedSplash).toHaveAttribute("data-state", /lift|gone/, { timeout: 1000 });
  await expect(reloadedSplash).toHaveAttribute("data-state", "gone", { timeout: 4000 });

  // Moving inside the site is not a page load: going to the app and back does not replay it.
  await page.locator(".m-header").getByRole("link", { name: "Launch app" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await page.getByRole("link", { name: "Optra home" }).first().click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.locator(".splash")).toHaveAttribute("data-state", "gone");
});

test("each House Agent is its own character, and every one is awake", async ({ page }) => {
  await page.goto("/?splash=off");
  const graph = page.locator("#agents .pn");
  await graph.scrollIntoViewIfNeeded();
  const shapes: [RegExp, string, number][] = [
    [/Protective Put/, "square", 2],
    [/Covered Call/, "triangle", 1],
    [/Cash-Secured Put/, "hexagon", 2],
    [/Earnings Straddle/, "diamond", 2],
  ];
  for (const [name, shape, eyes] of shapes) {
    await graph.locator(".pn-agents").getByRole("button", { name }).click();
    const character = graph.locator(".pn-root .ch");
    await expect(character).toHaveAttribute("data-shape", shape);
    await expect(character.locator(".ch-eye")).toHaveCount(eyes);
    // Every agent is awake and blinks, whether it is paper ready or a preview.
    await expect(character).toHaveAttribute("data-live", "1");
  }
});

test("the right-hand progress rail names the current section and links to every stop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?splash=off");
  const rail = page.getByRole("navigation", { name: "Page progress" });
  // The rail is driven by requestAnimationFrame, which software-rendered WebGL can starve on CI.
  await expect(rail.getByRole("link", { name: "Intro" })).toHaveAttribute("aria-current", "location", { timeout: 20_000 });
  await rail.getByRole("link", { name: "How", exact: true }).click();
  await expect(page).toHaveURL(/#story$/);
  await expect(rail.getByRole("link", { name: "How", exact: true })).toHaveAttribute("aria-current", "location", { timeout: 20_000 });
  const hrefs = await rail.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const href of hrefs) await expect(page.locator(href as string)).toHaveCount(1);
});

test("the brand is locked: headline, tagline, supporting line, official logo and favicon", async ({ page }) => {
  await page.goto("/?splash=off");
  await expect(page).toHaveTitle("Optra Agent | No-Code Options Trading Agents");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("No-Code Options Trading Agents.");
  await expect(page.locator("#intro").getByText("BUILD · DEPLOY · CONTROL", { exact: true })).toBeVisible();
  await expect(page.getByText("Build custom options agents with modular rules. Backtest strategies, control risk, and understand every decision.")).toBeVisible();
  await expect(page.getByText("Hooked agents. Every strike explained.", { exact: true })).toBeVisible();
  // The official artwork is served as shipped, with its own aspect ratio, in the header.
  const logo = page.locator(".m-header img.brand-mark");
  await expect(logo).toBeVisible();
  expect(decodeURIComponent((await logo.getAttribute("src")) ?? "")).toContain("/logo.png");
  const box = await logo.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(1312 / 1199, 1);
  await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute("href", /icon/);
});

test("the hero cast: each stage is its own character, and selecting one runs its route", async ({ page }) => {
  await page.goto("/?splash=off");
  const cast = page.getByRole("group", { name: /The agent and its rule stages/ });
  await expect(cast).toBeVisible();
  for (const name of ["Protective Put", "Gate", "Strike", "Size", "Pulse", "Expiry", "Covered Call", "Cash-Secured Put", "Earnings Straddle"]) {
    await expect(cast.getByRole("button", { name: new RegExp(`^${name}\\.`) })).toHaveCount(1);
  }
  await cast.getByRole("button", { name: /^Gate\./ }).click();
  await expect(cast.getByRole("button", { name: /^Gate\./ })).toHaveAttribute("aria-pressed", "true");
  await expect(cast.locator(".ens-bubble")).toContainText("May the agent enter now?");
  // At this width the wide set of routes is the visible one (the narrow set is for phones).
  const hot = cast.locator('.ens-lines[data-set="wide"] .ens-line[data-hot="1"]');
  await expect(hot).toHaveCount(1);
  // The centre agent lights every route.
  await cast.getByRole("button", { name: /^Protective Put\./ }).click();
  await expect(hot).toHaveCount(8);
  // Every character has painted eyes that blink.
  await expect(cast.locator(".ch[data-live='1'] .ch-eye").first()).toBeAttached();
});

test.describe("pinned Protective Floor", () => {
  test.use({ viewport: { width: 1470, height: 956 } });
  test("scrolling the pinned stage turns the camera through the three views", async ({ page }) => {
    await page.goto("/?splash=off");
    await page.locator("#floor").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".fl-pin")!).position)).toBe("sticky");
    const pressed = () => page.locator('.fl-views [aria-pressed="true"]').innerText();
    const at = async (fraction: number) => {
      await page.evaluate((f) => {
        const track = document.querySelector<HTMLElement>(".fl-track")!;
        const top = track.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top + (track.offsetHeight - window.innerHeight) * f);
      }, fraction);
    };
    await at(0.12);
    await expect.poll(pressed, { timeout: 20_000 }).toContain("Whole payoff");
    await at(0.5);
    await expect.poll(pressed, { timeout: 20_000 }).toContain("The floor");
    await at(0.88);
    await expect.poll(pressed, { timeout: 20_000 }).toContain("The cost");
    // The pinned panel fits inside the screen: nothing spills into the next section.
    await at(0.5);
    const fits = await page.evaluate(() => { const pin = document.querySelector(".fl-pin")!.getBoundingClientRect(); const actions = document.querySelector(".fl-actions")!.getBoundingClientRect(); return actions.bottom <= pin.bottom + 1; });
    expect(fits).toBe(true);
  });

  test("scroll keeps the accessible view in sync when WebGL is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = function () { return null; };
    });
    await page.goto("/?splash=off");
    await expect(page.locator(".fl-stage")).toHaveAttribute("data-gl", "off");
    await page.locator("#floor").scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>(".fl-track")!;
      const top = track.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + (track.offsetHeight - window.innerHeight) * 0.5);
    });
    await expect(page.getByRole("button", { name: "The floor" })).toHaveAttribute("aria-pressed", "true");
  });
});

test("Paper, manual CallPut, and autonomous execution are represented truthfully", async ({ page }) => {
  await page.goto("/?splash=off");
  const modes = page.getByRole("group", { name: "Execution modes" });
  await modes.scrollIntoViewIfNeeded();
  await expect(modes.getByRole("heading", { name: "Paper Trading" })).toBeVisible();
  await expect(modes.getByText("Working today")).toBeVisible();
  await expect(modes.getByRole("link", { name: "Launch an agent" })).toHaveAttribute("href", "/agents");
  const restricted = modes.locator('[data-mode="live"]');
  await expect(restricted.getByRole("heading", { name: "Manual CallPut" })).toBeVisible();
  await expect(restricted.getByText("Wallet-signed", { exact: true })).toBeVisible();
  await expect(restricted.getByText(/CallPut spread orders are quoted, reviewed and signed in your own wallet/i)).toBeVisible();
  await expect(restricted.getByText(/Close and settle are available on the same terms/i)).toBeVisible();
  await expect(restricted.getByText(/has not yet verified a live open, close or settle/i)).toBeVisible();
  await expect(restricted.getByText("Autonomous agents", { exact: true })).toBeVisible();
  await expect(restricted.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(restricted.getByText(/agents do not submit CallPut requests/i)).toBeVisible();
  await expect(restricted.getByText("Live Trading", { exact: true })).toHaveCount(0);
  await expect(restricted.getByText("Planned", { exact: true })).toHaveCount(0);
  await expect(restricted.getByText("Owner account grant and confirmed signer model", { exact: true })).toBeVisible();
  await expect(restricted.getByRole("button")).toHaveCount(0);
  await expect(restricted.getByRole("link", { name: /What autonomous trading still needs/ })).toHaveAttribute("href", "/verify");
});

test("the opening causes no hydration mismatch on a first load or a reload", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && !/401|Unauthorized/.test(message.text())) problems.push(message.text()); });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto("/");
  await expect(page.locator(".splash")).toHaveAttribute("data-state", /boot|form|cast|lift|gone/, { timeout: 15000 });
  await page.keyboard.press("Space");
  await expect(page.locator(".splash")).toHaveAttribute("data-state", "gone", { timeout: 5000 });
  await page.reload();
  await expect(page.locator(".splash")).toHaveAttribute("data-state", /boot|form|cast|lift|gone/, { timeout: 15000 });
  await page.waitForTimeout(800);
  expect(problems.filter((text) => /hydrat|did not match|didn't match|script tag/i.test(text))).toEqual([]);
});
