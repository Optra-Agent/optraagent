import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Page-level horizontal overflow acceptance at every supported width, signed out and signed in.
 * The signed-in wallet is a scripted EIP-1193 provider holding a THROWAWAY key; it signs the sign-in message only and
 * rejects every transaction method. It is not the owner's wallet and not a MetaMask extension test.
 */
const WIDTHS = [320, 390, 768, 1280, 1440] as const;
const ROUTES = ["/", "/market", "/agents", "/tape", "/verify", "/lab", "/forge", "/hooks"] as const;
const account = privateKeyToAccount(generatePrivateKey());

async function installWallet(page: Page) {
  await page.exposeFunction("__signMessage", async (message: string) => account.signMessage({ message }));
  await page.addInitScript((address) => {
    const calls: string[] = [];
    (window as unknown as { __walletCalls: string[] }).__walletCalls = calls;
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      on: () => undefined,
      removeListener: () => undefined,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push(method);
        switch (method) {
          case "eth_chainId": return "0x1237";
          case "net_version": return "4663";
          case "eth_accounts":
          case "eth_requestAccounts": return [address];
          case "wallet_requestPermissions": return [{ parentCapability: "eth_accounts" }];
          case "personal_sign": {
            const hex = String(params?.[0] ?? "");
            const bytes = hex.startsWith("0x") ? hex.slice(2).match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [] : [];
            const message = hex.startsWith("0x") ? new TextDecoder().decode(new Uint8Array(bytes)) : hex;
            return (window as unknown as { __signMessage: (message: string) => Promise<string> }).__signMessage(message);
          }
          default: throw Object.assign(new Error(`Unsupported method ${method}`), { code: -32601 });
        }
      },
    };
  }, account.address);
}

/** Elements whose box reaches past the viewport and that no scroll container or clip is hiding. These are the real causes. */
async function offenders(page: Page) {
  return page.evaluate(() => {
    const limit = window.innerWidth;
    const clipped = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
      }
      return false;
    };
    const rows: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit + 0.5) continue;
      if (getComputedStyle(element).position === "fixed" || clipped(element)) continue;
      const name = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""}`;
      rows.push(`${name} right=${Math.round(rect.right)} width=${Math.round(rect.width)} text="${(element.textContent ?? "").trim().slice(0, 50)}"`);
    }
    // Chain from the first culprit up to <body>: the ancestor where right-edge stops growing is the element that must shrink.
    const chain: string[] = [];
    const first = Array.from(document.body.querySelectorAll("*")).find((element) => element.getBoundingClientRect().right > limit + 0.5 && getComputedStyle(element).position !== "fixed" && !clipped(element));
    for (let node: Element | null = first ?? null; node && node !== document.documentElement; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      chain.push(`  ^ ${node.tagName.toLowerCase()}.${typeof node.className === "string" ? node.className.trim().split(/\s+/).slice(0, 4).join(".") : ""} left=${Math.round(rect.left)} right=${Math.round(rect.right)} display=${style.display} minW=${style.minWidth} overflowX=${style.overflowX} pad=${style.paddingLeft}/${style.paddingRight}`);
    }
    const leaves: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (element.children.length > 0 || getComputedStyle(element).position === "fixed" || clipped(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.right > limit + 0.5) leaves.push(`  leaf ${element.tagName.toLowerCase()}.${typeof element.className === "string" ? element.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} right=${Math.round(rect.right)} text="${(element.textContent ?? "").trim().slice(0, 70)}"`);
    }
    return [...rows.slice(0, 4), ...chain.slice(0, 10), ...leaves.slice(0, 8)];
  });
}

async function assertNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, bodyScroll: document.body.scrollWidth }));
  const culprits = metrics.scrollWidth > metrics.innerWidth ? await offenders(page) : [];
  expect(metrics.scrollWidth, `${label}: scrollWidth ${metrics.scrollWidth} > innerWidth ${metrics.innerWidth}\n${culprits.join("\n")}`).toBeLessThanOrEqual(metrics.innerWidth);
}

for (const route of ROUTES) {
  test(`no horizontal overflow on ${route} at 320, 390, 768, 1280 and 1440 (signed out)`, async ({ page }) => {
    test.setTimeout(120_000);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1200);
      await assertNoOverflow(page, `${route} @${width}`);
    }
  });
}

test("no horizontal overflow on Tape signed in with a connected wallet, with every panel opened, at all five widths", async ({ page }) => {
  test.setTimeout(180_000);
  await installWallet(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tape", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in with MetaMask" }).click();
  const panel = page.locator('[aria-label="Enable live"]');
  await expect(panel.getByRole("list", { name: "Live gates" })).toBeVisible({ timeout: 30_000 });
  const readiness = page.locator('[aria-label="Wallet readiness"]');
  await expect(readiness.getByText(/Account address for THIS wallet: 0x[0-9a-fA-F]{40}/)).toBeVisible({ timeout: 45_000 });
  await page.getByText("Close or settle a position", { exact: true }).click();
  await page.getByRole("button", { name: "Load market" }).click().catch(() => undefined);
  await page.waitForTimeout(2500);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    await assertNoOverflow(page, `/tape signed in @${width}`);
    await expect(readiness.getByTestId("connected-address")).toBeVisible();
  }
  for (const route of ["/agents", "/market", "/verify"]) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await assertNoOverflow(page, `${route} signed in @${width}`);
    }
  }
});

/** The recorded CallPut venue feed with a future expiry baked into the option ids, so the order panel can prepare a real plan offline. */
function marketFeed() {
  const golden = JSON.parse(readFileSync("tests/options/fixtures/callput-robinhood-venue-prepared-open.json", "utf8")) as {
    feed: { spot: number; long: { mark: number; rpBuy: number }; short: { mark: number; rpBuy: number } };
    request: { longOptionId: string; shortOptionId: string };
  };
  const expiry = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const withExpiry = (id: string) => `0x${id.slice(2, 6)}${expiry.toString(16).padStart(10, "0")}${id.slice(16)}`;
  const row = (id: string, strike: number, mark: number, rp: number) => ({
    underlyingSymbol: "AAPL", side: "put", instrument: `AAPL-${strike}-P`, optionId: id, expiryTimestamp: expiry, strikePriceRaw: strike, markPriceRaw: mark,
    markIvRaw: 0.3, riskPremiumRateForBuy: rp, riskPremiumRateForSell: rp, delta: 0, gamma: 0, vega: 0, theta: 0, marketAvailable: true, quoteType: "indicative",
  });
  return {
    venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
    timestampMs: Date.now() - 2_000, lastUpdatedAt: new Date().toISOString(), feedVersion: 1, spotIndexRaw: { AAPL: golden.feed.spot }, futuresIndexRaw: {},
    options: [row(withExpiry(golden.request.longOptionId), 340, golden.feed.long.mark, golden.feed.long.rpBuy), row(withExpiry(golden.request.shortOptionId), 335, golden.feed.short.mark, golden.feed.short.rpBuy)],
  };
}

/** A control the owner must be able to reach: inside the viewport horizontally, with a real box. */
async function expectReachable(page: Page, locator: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(box, label).not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(width + 0.5);
}

test("Order review with a funding shortfall: exact shortfalls, destinations and amounts, Sign disabled, and no horizontal overflow at all five widths", async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page);
  await page.route("**/api/venue/callput/market**", (route) => route.fulfill({ json: marketFeed() }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tape", { waitUntil: "domcontentloaded" });
  const panel = page.locator('[aria-label="CallPut Live options order"]');
  await expect(panel.getByTestId("wallet-network-status")).toHaveAttribute("data-network", "ok", { timeout: 45_000 });
  await panel.getByRole("button", { name: "Load market" }).click();
  const expiry = panel.getByLabel("Expiry");
  await expect(expiry).toBeVisible();
  await expiry.selectOption({ index: 1 });
  const long = panel.getByLabel("Long leg");
  const options = await long.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  await long.selectOption(options[2]!);
  await panel.getByLabel("Short leg").selectOption(options[1]!);
  await panel.getByRole("button", { name: "Prepare order" }).click();

  const preflight = panel.getByLabel("Funding preflight");
  await expect(preflight).toBeVisible({ timeout: 60_000 });
  await expect(preflight).toHaveAttribute("data-preflight", "fail");
  // A fresh throwaway wallet holds nothing: both shortfalls are exact, nothing is offered for signing, and nothing was sent.
  await expect(preflight.locator('[data-preflight-line="eth"]')).toContainText(/short by 0\.\d+ ETH/);
  await expect(preflight.locator('[data-preflight-line="usdg"]')).toContainText(/short by \d+\.\d{6} USDG/);
  await expect(preflight.getByTestId("allowance-explainer")).toContainText("separate approval transaction for exactly");
  await expect(panel.getByText(/to 0x[0-9a-fA-F]{40} · value 0 wei/)).toBeVisible();
  await expect(panel.getByText(/approves exactly \d+\.\d{6} USDG · spender \(CallPut Controller\) 0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B/)).toBeVisible();
  const sign = panel.getByRole("button", { name: "Sign in wallet" });
  await panel.getByRole("checkbox").first().check();
  await expect(sign).toBeDisabled();
  await expect(panel.getByText(/Signing is disabled until the funding preflight passes/)).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    await assertNoOverflow(page, `order review @${width}`);
    await expectReachable(page, panel.getByRole("button", { name: "Prepare order" }), `Prepare order @${width}`);
    await expectReachable(page, panel.getByRole("button", { name: "Re-check funding" }), `Re-check funding @${width}`);
    await expectReachable(page, sign, `Sign in wallet @${width}`);
    await expectReachable(page, panel.getByLabel("Size (underlying units)"), `Size field @${width}`);
    await expectReachable(page, panel.getByLabel("Max collateral (USDG)"), `Max collateral field @${width}`);
    await expectReachable(page, page.getByTestId("connected-address"), `connected address @${width}`);
    await expect(page.getByTestId("connected-address")).toHaveText(account.address);
    if (process.env.OPTRA_SHOTS) await panel.screenshot({ path: `.local/optra-shots/order-review-${width}.png` });
  }
  const methods = await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls);
  expect(methods).not.toContain("eth_sendTransaction");
});

test("no horizontal overflow on every app page with a wallet connected but not signed in (two topbar buttons), at all five widths", async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page);
  for (const route of ["/market", "/agents", "/tape", "/verify", "/lab", "/forge", "/hooks"]) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Sign in with MetaMask" })).toBeVisible({ timeout: 30_000 });
      await expectReachable(page, page.getByRole("button", { name: "Sign in with MetaMask" }), `${route} Sign in @${width}`);
      await expectReachable(page, page.getByRole("button", { name: "Choose another wallet" }), `${route} Choose another wallet @${width}`);
      await assertNoOverflow(page, `${route} connected, signed out @${width}`);
    }
  }
});
