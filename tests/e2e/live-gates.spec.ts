import { expect, test, type Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Authenticated browser pass over G7 against the real backend of the isolated server.
 * The wallet is a scripted EIP-1193 provider holding a THROWAWAY key generated for this test run; it signs the sign-in
 * message only and rejects every transaction method. This is not the owner's wallet and not a MetaMask extension test.
 */
const account = privateKeyToAccount(generatePrivateKey());

async function installWallet(page: Page) {
  await page.exposeFunction("__signMessage", async (message: string) => account.signMessage({ message }));
  await page.addInitScript((address) => {
    const listeners: Record<string, Array<(value: unknown) => void>> = {};
    const calls: string[] = [];
    (window as unknown as { __walletCalls: string[] }).__walletCalls = calls;
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      on: (event: string, listener: (value: unknown) => void) => { (listeners[event] ??= []).push(listener); },
      removeListener: (event: string, listener: (value: unknown) => void) => { listeners[event] = (listeners[event] ?? []).filter((item) => item !== listener); },
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

test("G7: the shadcn checkboxes, clickable labels, persisted acknowledgement and the G7 gate flip, signed in against the real backend", async ({ page }) => {
  await installWallet(page);
  await page.goto("/tape");
  await page.getByRole("button", { name: "Sign in with MetaMask" }).click();

  const panel = page.locator('[aria-label="Enable live"]');
  await expect(panel.getByRole("list", { name: "Live gates" })).toBeVisible({ timeout: 30_000 });
  const g7 = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "G7 Risk acknowledgement" }) });
  await expect(g7).toContainText("Not met");
  await expect(panel.getByText(/of 7 gates pass/)).toBeVisible();

  const boxes = panel.getByRole("checkbox");
  await expect(boxes).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await expect(boxes.nth(index)).toHaveAttribute("aria-checked", "false");
  const record = panel.getByRole("button", { name: "Record acknowledgement" });
  await expect(record).toBeDisabled();

  // Nothing is ticked for the owner, and the exact copy is unchanged.
  await expect(panel.getByText("A long option can lose 100% of the premium paid.")).toBeVisible();
  await expect(panel.getByText("A covered call gives up the upside above its strike.")).toBeVisible();
  await expect(panel.getByText("A synthetic option is not the stock and carries no shareholder rights.")).toBeVisible();

  // 1. Clicking the label text, not the box, ticks it.
  await panel.getByText("A long option can lose 100% of the premium paid.").click();
  await expect(boxes.nth(0)).toHaveAttribute("aria-checked", "true");
  // 2. Keyboard: focus the second box and press Space.
  await boxes.nth(1).focus();
  await expect(boxes.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(record).toBeDisabled();
  await expect(panel.getByText("2 of 3 ticked")).toBeVisible();
  // 3. The box itself.
  await boxes.nth(2).click();
  await expect(boxes.nth(2)).toHaveAttribute("aria-checked", "true");
  await expect(record).toBeEnabled();
  // Unticking one disables recording again.
  await panel.getByText("A covered call gives up the upside above its strike.").click();
  await expect(boxes.nth(1)).toHaveAttribute("aria-checked", "false");
  await expect(record).toBeDisabled();
  await boxes.nth(1).click();
  await expect(record).toBeEnabled();

  // Layout: no horizontal overflow at desktop and phone widths, with the box inside its row.
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const row = panel.locator(".ack-row").first();
    const rowBox = await row.boundingBox();
    const boxBox = await boxes.nth(0).boundingBox();
    expect(rowBox && boxBox && boxBox.x >= rowBox.x && boxBox.x + boxBox.width <= rowBox.x + rowBox.width).toBe(true);
    await panel.screenshot({ path: `.local/optra-e2e-results/g7-ack-${size.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Record: success feedback, G7 flips, the form goes away.
  await record.click();
  await expect(panel.getByRole("status").filter({ hasText: "Acknowledgement recorded" })).toBeVisible();
  await expect(g7).toContainText("Pass");
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await expect(g7).toContainText(/Acknowledgement version .* recorded 20\d\d-/);

  const beforeReload = await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls);
  expect(beforeReload).toContain("personal_sign");

  // Persists across a reload, still signed in, and no other gate was changed by it.
  await page.reload();
  const again = page.locator('[aria-label="Enable live"]');
  await expect(again.getByRole("list", { name: "Live gates" })).toBeVisible({ timeout: 30_000 });
  await expect(again.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "G7 Risk acknowledgement" }) })).toContainText("Pass");
  await expect(again.getByRole("checkbox")).toHaveCount(0);
  await expect(again.getByText("Risk acknowledgement on record.")).toBeVisible();
  for (const title of ["G1 Venue verified", "G2 Custody ready", "G3 Global kill switch", "G4 Wallet allowlist", "G5 Jurisdiction"]) {
    await expect(again.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) })).toContainText("Not met");
  }
  await expect(again.getByRole("button", { name: /Enable live \(every gate must pass\)/ })).toBeDisabled();

  // The provider script runs again on reload, so this is the post-reload call list; the session itself survived it.
  const methods = [...beforeReload, ...(await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls))];
  expect(methods).not.toContain("eth_sendTransaction");
  expect(methods).not.toContain("eth_sendRawTransaction");
});
