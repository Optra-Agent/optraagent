import { expect, test } from "@playwright/test";

const agentId = "123e4567-e89b-42d3-a456-426614174000";
const recipeHash = `sha256:${"a".repeat(64)}`;
const recipe = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: [], parameters: {} };
const agent = {
  id: agentId, ownerId: "owner-1", name: "Preview", templateId: "custom", status: "running", recipeHash,
  backtestRunId: "123e4567-e89b-42d3-a456-426614174009", createdAt: "2026-11-12T03:00:00.000Z", updatedAt: "2026-11-12T03:00:00.000Z", recipe,
};
const agentSummary = {
  id: agent.id, ownerId: agent.ownerId, name: agent.name, templateId: agent.templateId, status: agent.status,
  recipeHash: agent.recipeHash, backtestRunId: agent.backtestRunId, createdAt: agent.createdAt, updatedAt: agent.updatedAt,
};

async function signInPage(page: import("@playwright/test").Page) {
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z",
  } }));
}

test("agents screen shows real unauthenticated state and paper-only boundary", async ({ page }) => {
  await page.goto("/agents");

  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("PAPER ONLY", { exact: true })).toBeVisible();
  await expect(page.getByText("Connect a wallet to view your agents.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
});

test("wallet connection explains when no supported extension is available", async ({ page }) => {
  await page.goto("/agents");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "MetaMask", exact: true }).click();

  await expect(page.locator(".inline-error")).toContainText("No compatible EVM wallet was found.");
});

test("signed-in agent list and detail follow acknowledged lifecycle responses", async ({ page }) => {
  await signInPage(page);
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents: [agentSummary] } }));
  await page.route(`**/api/agents/${agentId}`, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: agent });
    return route.fallback();
  });
  await page.route(`**/api/agents/${agentId}/tape`, (route) => route.fulfill({ json: { decisions: [], executionMode: "PAPER" } }));
  await page.route(`**/api/agents/${agentId}/positions`, (route) => route.fulfill({ json: { positions: [], executionMode: "PAPER" } }));
  await page.route(`**/api/agents/${agentId}/lifecycle`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ json: { ...agent, status: "paused", updatedAt: "2026-11-12T03:31:00.000Z" } });
  });

  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open agent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await expect(page.locator(".agent-status-paused")).toHaveText("paused");
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
});
