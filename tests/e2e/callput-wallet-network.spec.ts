import { expect, test } from "@playwright/test";

const ACCOUNT = "0x00000000000000000000000000000000000dE4d1";

/**
 * A real-browser pass over the unsigned wallet flow with a scripted EIP-1193 provider that identifies as MetaMask.
 * It proves OPTRA's connector, network validation, network switch and sign-in rejection handling. It is not a
 * MetaMask or Phantom extension test: the extension UI, network prompts and fee display need the owner's browser
 * (docs/CallPut-Wallet-Acceptance.md).
 */
test("a connected wallet on the wrong network is blocked, switched through the wallet, and a rejected signature creates nothing", async ({ page }) => {
  await page.addInitScript((account) => {
    const calls: Array<{ method: string; params?: unknown }> = [];
    const listeners: Record<string, Array<(value: unknown) => void>> = {};
    let chainId = "0x1";
    const emit = (event: string, value: unknown) => (listeners[event] ?? []).forEach((listener) => listener(value));
    (window as unknown as { __walletCalls: typeof calls }).__walletCalls = calls;
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      on: (event: string, listener: (value: unknown) => void) => { (listeners[event] ??= []).push(listener); },
      removeListener: (event: string, listener: (value: unknown) => void) => { listeners[event] = (listeners[event] ?? []).filter((item) => item !== listener); },
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        calls.push({ method, params });
        switch (method) {
          case "eth_chainId": return chainId;
          case "net_version": return String(parseInt(chainId, 16));
          case "eth_accounts":
          case "eth_requestAccounts": return [account];
          case "wallet_requestPermissions": return [{ parentCapability: "eth_accounts" }];
          case "wallet_switchEthereumChain": throw Object.assign(new Error("Unrecognized chain ID. Try adding the chain first."), { code: 4902 });
          case "wallet_addEthereumChain": chainId = "0x1237"; emit("chainChanged", chainId); return null;
          case "personal_sign": throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          default: throw Object.assign(new Error(`Unsupported method ${method}`), { code: -32601 });
        }
      },
    };
  }, ACCOUNT);

  // The provider already authorizes this site, so wagmi restores the connection on load, as it does for a returning MetaMask user,
  // while the wallet sits on Ethereum mainnet.
  await page.goto("/tape");
  const status = page.getByTestId("wallet-network-status");
  await expect(status).toHaveAttribute("data-network", "wrong");
  await expect(status).toContainText("Wrong network · chain 1");
  await expect(status).toContainText("Signing is blocked until the wallet is on that network");

  // Switch through the wallet: the chain is unknown to it, so the app adds Robinhood Mainnet.
  await page.getByRole("button", { name: "Switch to Robinhood Mainnet" }).click();
  await expect(status).toHaveAttribute("data-network", "ok");
  await expect(status).toContainText("Robinhood Mainnet · 4663");

  const methods = await page.evaluate(() => (window as unknown as { __walletCalls: Array<{ method: string }> }).__walletCalls.map((call) => call.method));
  expect(methods).toContain("wallet_switchEthereumChain");
  expect(methods).toContain("wallet_addEthereumChain");
  const added = await page.evaluate(() => (window as unknown as { __walletCalls: Array<{ method: string; params?: Array<{ chainId: string; rpcUrls: string[] }> }> }).__walletCalls.find((call) => call.method === "wallet_addEthereumChain")?.params?.[0]);
  expect(added?.chainId).toBe("0x1237");
  expect(added?.rpcUrls[0]).toBe("https://rpc.mainnet.chain.robinhood.com");

  // Sign-in is a message signature, never a transaction. Rejecting it leaves no session.
  await page.getByRole("button", { name: "Sign in with MetaMask" }).click();
  await expect(page.getByText(/wallet request was rejected\. No session was created/i).first()).toBeVisible();
  const after = await page.evaluate(() => (window as unknown as { __walletCalls: Array<{ method: string }> }).__walletCalls.map((call) => call.method));
  expect(after).toContain("personal_sign");
  expect(after).not.toContain("eth_sendTransaction");
  expect(after).not.toContain("eth_sendRawTransaction");
  await expect(page.getByText("Preview only", { exact: true })).toBeVisible();
});
