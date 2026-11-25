import { expect, test } from "@playwright/test";

test("runtime smoke hydrates the app and resolves the wallet session", async ({ page }) => {
  const sessionRequests: string[] = [];
  const sessionStatuses: number[] = [];
  const templateStatuses: number[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const hmrErrors: string[] = [];
  const failedRequests: string[] = [];
  const scriptResponses: Array<{ url: string; status: number }> = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/me") sessionRequests.push(request.method());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/me") sessionStatuses.push(response.status());
    if (url.pathname === "/api/agents/templates") templateStatuses.push(response.status());
    if (response.request().resourceType() === "script") {
      scriptResponses.push({ url: response.url(), status: response.status() });
    }
  });
  page.on("requestfailed", (request) => failedRequests.push(
    `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`,
  ));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("/_next/hmr") || /websocket|web socket/i.test(message.text())) hmrErrors.push(message.text());
    else consoleErrors.push(message.text());
  });
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/_next/hmr")) return;
    socket.on("socketerror", (error) => hmrErrors.push(`${socket.url()}: ${error}`));
  });

  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Agents · Optra Agent");
  await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
  await expect(page.getByText("Checking wallet session…", { exact: true })).toHaveCount(0);
  expect(sessionRequests).toContain("GET");
  expect(sessionStatuses).toContain(401);
  expect(templateStatuses).toContain(200);
  expect(scriptResponses.length).toBeGreaterThan(0);
  expect(scriptResponses.filter((response) => response.status >= 400)).toEqual([]);
  const expectedStrictModeCancellations = failedRequests.filter((request) =>
    /^GET https?:\/\/[^/]+\/api\/(agents\/templates|public\/v1\/(agents|house-backtests)): net::ERR_ABORTED$/.test(request),
  );
  expect(failedRequests).toEqual(expectedStrictModeCancellations);
  expect(pageErrors).toEqual([]);

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Choose an EVM wallet" })).toBeVisible();
  expect(consoleErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
  expect(hmrErrors).toEqual([]);
  console.info(`[runtime-smoke] ${scriptResponses.length} script responses; ${sessionRequests.length} session request(s); HMR socket errors: ${hmrErrors.length}; failed requests: ${failedRequests.length}`);

  test.info().annotations.push({
    type: "hmr",
    description: hmrErrors.length === 0 ? "No HMR handshake errors." : `${hmrErrors.length} HMR handshake error(s); app hydration and session resolution succeeded.`,
  });
});
