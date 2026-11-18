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

  const marketResponse = await page.request.get(new URL("/api/markets", origin).toString());
  const marketBody = await marketResponse.text();
  expect(marketResponse.status(), `Market registry response: ${marketBody}`).toBe(200);
  const marketRegistry = JSON.parse(marketBody) as { markets: Array<{ symbol: string }> };
  expect(marketRegistry.markets.map((market) => market.symbol), "The isolated AAPL market fixture must be visible to the app.").toContain("AAPL");

  const coverageResponse = await page.request.get(new URL("/api/backtests/coverage?symbol=AAPL", origin).toString());
  const coverageBody = await coverageResponse.text();
  expect(coverageResponse.status(), `Backtest coverage response: ${coverageBody}`).toBe(200);
  const coverage = JSON.parse(coverageBody) as { ready: boolean; reason: string };
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

test("a custom Protective Put can be forged, backtested, launched, evaluated, and read from Tape", async ({ page, baseURL }) => {
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

  await page.goto("/forge");
  await expect(page.getByLabel("Virtual reference shares")).toHaveValue("10");
  await expect(page.getByLabel("Paper capital (USD)")).toHaveValue("100000");
  await expect(page.getByLabel("Put strike distance (% OTM)")).toHaveValue("7");
  await expect(page.getByLabel("Model expiry (calendar days)")).toHaveValue("30");
  await expect(page.getByLabel("Max premium (% of reference holding)")).toHaveValue("2");
  await expect(page.locator(".forge-hook input:not(:disabled):checked")).toHaveCount(15);
  await page.getByLabel("Agent name").fill("Custom AAPL Protection");
  await page.getByLabel("Put strike distance (% OTM)").fill("6.5");
  await page.getByLabel("Model expiry (calendar days)").fill("28");
  await page.getByLabel("Max premium (% of reference holding)").fill("1.5");
  await page.getByRole("button", { name: "Validate recipe", exact: true }).click();
  await expect(page.locator(".forge-validation")).toContainText("Recipe valid");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]+$/i);
  const agentId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  const savedAgentResponse = await page.request.get(new URL(`/api/agents/${encodeURIComponent(agentId)}`, origin).toString());
  expect(savedAgentResponse.status()).toBe(200);
  const savedAgent = await savedAgentResponse.json();
  expect(savedAgent).toMatchObject({
    templateId: "custom",
    recipe: {
      templateId: "custom",
      underlyingSymbol: "AAPL",
      parameters: {
        initialCapitalUsd: "100000",
        protectedShares: "10",
        percy: { otmPct: 6.5 },
        tenora: { targetDTE: 28 },
        capra: { maxPremiumPctHolding: 1.5 },
      },
    },
  });
  expect(savedAgent.recipe.hookIds).toHaveLength(15);

  await page.goto(`/lab?agent=${encodeURIComponent(agentId)}`);
  const lab = page.getByRole("region", { name: "Backtest and launch" });
  const backtestButton = lab.getByRole("button", { name: "Run paper backtest" });
  await expect(backtestButton).toBeEnabled({ timeout: 20_000 });
  await backtestButton.click();
  await expect(lab.getByRole("region", { name: "Backtest result" })).toContainText("Backtest complete", { timeout: 60_000 });
  await lab.getByRole("button", { name: "Launch paper agent" }).click();
  await expect(lab.getByRole("status")).toContainText("Paper agent running");
  await lab.getByRole("link", { name: "Open agent and run a tick" }).click();
  await page.getByRole("button", { name: "Run paper tick" }).click();
  await expect(page.getByRole("status", { name: "Paper tick result" })).toContainText("skip");
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
});
