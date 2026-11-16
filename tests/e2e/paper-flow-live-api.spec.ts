import { expect, test } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

test("test-signed session completes the paper journey through browser routes and persists Tape", async ({ page, baseURL }) => {
  // This signer exercises the server challenge; it does not stand in for a MetaMask or Phantom extension prompt.
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  if (!baseURL) throw new Error("Playwright baseURL is required.");
  const origin = new URL(baseURL).origin;
  const challengeResponse = await page.request.post(new URL("/api/auth/challenge", origin).toString(), {
    headers: { origin },
    data: { address: account.address },
  });
  expect(challengeResponse.status()).toBe(200);

  const challenge = await challengeResponse.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  const verifyResponse = await page.request.post(new URL("/api/auth/verify", origin).toString(), {
    headers: { origin },
    data: { address: account.address, nonce: challenge.nonce, signature },
  });
  expect(verifyResponse.status()).toBe(200);

  const coverageResponse = await page.request.get(new URL("/api/backtests/coverage?symbol=AAPL", origin).toString());
  expect(coverageResponse.status()).toBe(200);
  const coverage = await coverageResponse.json() as { ready: boolean; reason: string };
  expect(coverage.ready, `E2E market fixture is not backtest-ready: ${coverage.reason}`).toBe(true);

  await page.goto("/agents");
  await expect(page.getByText("Signed in ·", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No saved agents", exact: true })).toBeVisible();
  const creator = page.getByRole("region", { name: "Create Protective Put House Agent" });
  await expect(creator.getByRole("button", { name: "Create paper draft" })).toBeEnabled();
  await creator.getByRole("button", { name: "Create paper draft" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]+$/i);
  const agentPath = new URL(page.url()).pathname;
  const agentId = decodeURIComponent(agentPath.split("/").at(-1)!);

  await page.goto(`/lab?agent=${encodeURIComponent(agentId)}`);
  const lab = page.getByRole("region", { name: "Backtest and launch" });
  const backtestButton = lab.getByRole("button", { name: "Run paper backtest" });
  await expect(backtestButton).toBeEnabled({ timeout: 20_000 });
  await backtestButton.click();
  await expect(lab.getByRole("region", { name: "Backtest result" })).toContainText("Backtest complete", { timeout: 60_000 });
  await expect(lab.getByRole("region", { name: "Benchmark comparison" }).getByText("Buy and hold AAPL", { exact: true })).toBeVisible();
  await lab.getByRole("button", { name: "Launch paper agent" }).click();
  await expect(lab.getByRole("status")).toContainText("Paper agent running");
  await lab.getByRole("link", { name: "Open agent and run a tick" }).click();

  await page.getByRole("button", { name: "Run paper tick" }).click();
  const tickResult = page.getByRole("status", { name: "Paper tick result" });
  await expect(tickResult).toBeVisible();
  await expect(tickResult).toContainText("skip");
  await page.reload();
  await page.getByRole("tab", { name: /Tape/ }).click();
  await expect(page.getByRole("heading", { name: "Decision Tape" })).toBeVisible();
  await expect(page.getByText("skip", { exact: true })).toBeVisible();

  const tapeResponse = await page.request.get(new URL(`/api/agents/${encodeURIComponent(agentId)}/tape`, origin).toString());
  expect(tapeResponse.status()).toBe(200);
  await expect(tapeResponse.json()).resolves.toMatchObject({
    decisions: [expect.objectContaining({ action: "skip" })],
    orders: [],
  });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
