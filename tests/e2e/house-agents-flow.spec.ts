import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

/**
 * House Agent journeys against the real application backend (isolated Next.js, PGlite, recorded NVDA/TSLA/MSFT capture and
 * Robinhood's earnings calendar). Run with OPTRA_E2E_HOUSE=1. Every agent follows:
 * choose → configure → validate (server) → backtest → launch paper → evaluate ticks → inspect positions → read the Tape.
 * Ticks beyond the first use the owner-only historical replay (`asOf`) on recorded candle ends, because the capture is a
 * past day: replayed ticks run the same engine and persist the same rows as live ticks.
 */

test.describe.configure({ timeout: 300_000, mode: "serial" });

const JOURNEYS = [
  {
    key: "covered_call", name: "Covered Call", symbol: "NVDA", key0: "0x1111111111111111111111111111111111111111111111111111111111111111",
    fields: { "Virtual reference shares": "100", "Paper capital (USD)": "2000" }, positionSide: "short", optionType: "call", hookEvidence: ["coverix", "percy", "tenora", "earnex"],
  },
  {
    key: "cash_secured_put", name: "Cash-Secured Put", symbol: "TSLA", key0: "0x2222222222222222222222222222222222222222222222222222222222222222",
    fields: { "Paper capital (USD)": "10000" }, positionSide: "short", optionType: "put", hookEvidence: ["deltra", "premo", "capra", "trendix"],
  },
  {
    key: "earnings_straddle", name: "Earnings Straddle", symbol: "NVDA", key0: "0x3333333333333333333333333333333333333333333333333333333333333333",
    fields: { "Paper capital (USD)": "10000" }, positionSide: "long", optionType: "both", hookEvidence: ["earnex", "strangl", "kelvo", "capra"],
  },
] as const;

async function signIn(page: Page, privateKey: `0x${string}`, origin: string) {
  const account = privateKeyToAccount(privateKey);
  const challenge = await page.request.post(new URL("/api/auth/challenge", origin).toString(), { headers: { origin }, data: { address: account.address } });
  expect(challenge.status()).toBe(200);
  const { nonce, message } = await challenge.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message });
  const verified = await page.request.post(new URL("/api/auth/verify", origin).toString(), { headers: { origin }, data: { address: account.address, nonce, signature } });
  expect(verified.status()).toBe(200);
}

/** UTC hour ends on weekdays that fall in the regular US equity session (15:00–21:00Z in winter), oldest first. */
function sessionEnds(endAt: string, days: number): string[] {
  const end = Date.parse(endAt);
  const out: string[] = [];
  for (let at = end - days * 86_400_000; at <= end; at += 3_600_000) {
    const date = new Date(at);
    const day = date.getUTCDay();
    const hour = date.getUTCHours();
    if (day >= 1 && day <= 5 && hour >= 15 && hour <= 21 && date.getUTCMinutes() === 0) out.push(date.toISOString());
  }
  return out;
}

async function replayUntilOpen(request: APIRequestContext, origin: string, agentId: string, ends: string[]) {
  const actions: string[] = [];
  for (const at of ends) {
    const response = await request.post(new URL(`/api/agents/${agentId}/tick?asOf=${encodeURIComponent(at)}`, origin).toString(), { headers: { origin, "idempotency-key": `e2e-${at}` } });
    if (response.status() !== 200) { actions.push(`${at}:${response.status()}:${(await response.text()).slice(0, 90)}`); continue; }
    const body = await response.json() as { decision: { action: string } };
    actions.push(body.decision.action);
    if (body.decision.action === "open") return { openedAt: at, ticks: actions.length, actions };
  }
  return { openedAt: null, ticks: actions.length, actions };
}

for (const journey of JOURNEYS) {
  test(`${journey.name} on ${journey.symbol}: choose, configure, validate, backtest, launch, tick, position, Tape`, async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("baseURL is required.");
    const origin = new URL(baseURL).origin;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signIn(page, journey.key0, origin);

    // Choose: the card is paper ready and selecting it switches the configuration form.
    await page.goto("/agents");
    await expect(page.getByText("Signed in ·", { exact: false })).toBeVisible();
    const gallery = page.getByRole("region", { name: /House Agent templates/ });
    const card = gallery.locator(`article[data-kind="house"]`).filter({ has: page.getByRole("heading", { name: journey.name, exact: true }) });
    await expect(card.getByText("Paper ready", { exact: true })).toBeVisible();
    await card.getByRole("link", { name: /Configure this agent/ }).click();
    await expect(card.getByRole("link", { name: "Configuring below" })).toBeVisible();

    // Configure and validate: the server validates the closed-spec recipe when the draft is saved.
    const form = page.getByRole("region", { name: `Create ${journey.name} House Agent` });
    await expect(form).toBeVisible();
    await form.getByLabel("Underlying").click();
    await page.getByRole("option", { name: journey.symbol, exact: true }).click();
    for (const [label, value] of Object.entries(journey.fields)) await form.getByLabel(label).fill(value);
    await form.getByRole("button", { name: "Create paper draft" }).click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]+$/i);
    const agentId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    const draft = await (await page.request.get(new URL(`/api/agents/${agentId}`, origin).toString())).json() as { templateId: string; status: string; recipeHash: string; recipe: { underlyingSymbol: string; hookIds: string[] } };
    expect(draft).toMatchObject({ templateId: journey.key, status: "draft" });
    expect(draft.recipe.underlyingSymbol).toBe(journey.symbol);
    expect(draft.recipeHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // An out-of-spec recipe is refused by the server (closed specification), whatever the browser sends.
    const tampered = await page.request.post(new URL("/api/agents", origin).toString(), { headers: { origin }, data: { recipe: { ...draft.recipe, version: 1, name: "tampered", templateId: journey.key, parameters: { initialCapitalUsd: "1000" } } } });
    expect(tampered.status()).toBeGreaterThanOrEqual(400);
    expect(tampered.status()).toBeLessThan(500);

    // Backtest on real recorded candles, then launch exactly that run.
    await page.goto(`/lab?agent=${encodeURIComponent(agentId)}`);
    const lab = page.getByRole("region", { name: "Backtest and launch" });
    const runButton = lab.getByRole("button", { name: "Run paper backtest" });
    await expect(runButton).toBeEnabled({ timeout: 30_000 });
    await runButton.click();
    const result = lab.getByRole("region", { name: "Backtest result" });
    await expect(result).toContainText("Backtest complete", { timeout: 120_000 });
    await expect(lab.getByRole("region", { name: "Benchmark comparison" }).getByText(`Buy and hold ${journey.symbol}`, { exact: true })).toBeVisible();
    await expect(result.getByRole("list", { name: "Strategy counters" }).or(result.locator("dl[aria-label='Strategy counters']"))).toBeVisible();
    await lab.getByRole("button", { name: "Launch paper agent" }).click();
    await expect(lab.getByRole("status")).toContainText("Paper agent running");
    const launched = await (await page.request.get(new URL(`/api/agents/${agentId}`, origin).toString())).json() as { status: string; backtestRunId: string | null };
    expect(launched).toMatchObject({ status: "running" });
    expect(launched.backtestRunId).toBeTruthy();

    // Replay recorded candles through the owner-only historical tick until the strategy opens. This runs before any
    // wall-clock tick, because ticks are append-only in time.
    const coverage = await (await page.request.get(new URL(`/api/backtests/coverage?symbol=${journey.symbol}`, origin).toString())).json() as { endAt: string; ready: boolean };
    expect(coverage.ready).toBe(true);
    const replay = await replayUntilOpen(page.request, origin, agentId, sessionEnds(coverage.endAt, 29));
    expect(replay.openedAt, `no entry across ${replay.ticks} replayed ticks: ${[...new Set(replay.actions.map((entry) => entry.replace(/^[^:]*:\d{2}:\d{2}\.\d{3}Z:/, "")))].join(" | ")}`).not.toBeNull();

    // Idempotency: replaying the same candle returns the stored decision and creates nothing new.
    const again = await page.request.post(new URL(`/api/agents/${agentId}/tick?asOf=${encodeURIComponent(replay.openedAt!)}`, origin).toString(), { headers: { origin, "idempotency-key": "e2e-repeat" } });
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ idempotentReplay: true, decision: { action: "open" } });

    // Positions: real persisted rows with the right side, option type and collateral.
    const positions = await (await page.request.get(new URL(`/api/agents/${agentId}/positions`, origin).toString())).json() as { positions: Array<{ status: string; side: string; optionType: string; collateralUsd?: string; quantity: string; strikeUsd: string }>; executionMode: string };
    expect(positions.executionMode).toBe("PAPER");
    const open = positions.positions.filter((position) => position.status === "open");
    expect(open.length).toBeGreaterThanOrEqual(journey.optionType === "both" ? 2 : 1);
    if (journey.optionType === "both") {
      expect(open.map((position) => position.optionType).sort()).toEqual(["call", "put"]);
      expect(open.every((position) => position.side === "long")).toBe(true);
      expect(new Set(open.map((position) => position.strikeUsd)).size).toBe(1);
    } else {
      expect(open.every((position) => position.side === journey.positionSide && position.optionType === journey.optionType)).toBe(true);
    }
    if (journey.key === "cash_secured_put") {
      for (const position of open) expect(Number(position.collateralUsd)).toBeCloseTo(Number(position.strikeUsd) * Number(position.quantity), 2);
    }

    // The Tape: the open decision carries hook-level reasoning, and orders are modeled paper fills.
    const tape = await (await page.request.get(new URL(`/api/agents/${agentId}/tape`, origin).toString())).json() as {
      decisions: Array<{ action: string; reason: string; hookResults: Array<{ hookId: string; status: string; reason: string }>; recipeHash: string }>;
      orders: Array<{ executionMode: string; status: string; purpose: string | null }>;
    };
    const opening = tape.decisions.find((decision) => decision.action === "open")!;
    expect(opening.recipeHash).toBe(draft.recipeHash);
    const evaluated = new Set(opening.hookResults.map((hook) => hook.hookId));
    for (const hookId of journey.hookEvidence) expect(evaluated.has(hookId), `${hookId} must appear in the opening decision`).toBe(true);
    expect(opening.hookResults.every((hook) => hook.reason.length > 0)).toBe(true);
    expect(tape.decisions.some((decision) => decision.action === "skip")).toBe(true);
    expect(tape.orders.length).toBeGreaterThanOrEqual(1);
    expect(tape.orders.every((order) => order.executionMode === "PAPER" && order.status === "filled")).toBe(true);

    // Evaluate live: wall-clock time is later than the archived capture, so the engine fails closed and records a truthful
    // non-trading decision (skip), never an invented trade, and the open position is untouched.
    await page.goto(`/agents/${agentId}`);
    await page.getByRole("button", { name: "Run paper tick" }).click();
    const tick = page.getByRole("status", { name: "Paper tick result" });
    await expect(tick).toBeVisible();
    await expect(tick).toContainText(/skip|hold/);
    const afterLive = await (await page.request.get(new URL(`/api/agents/${agentId}/positions`, origin).toString())).json() as { positions: Array<{ status: string }> };
    expect(afterLive.positions.filter((position) => position.status === "open").length).toBe(open.length);

    // The UI shows the same data.
    await page.getByRole("tab", { name: /Positions/ }).click();
    await expect(page.getByText(journey.optionType === "both" ? /LONG .* CALL/ : new RegExp(`${journey.positionSide.toUpperCase()} .* ${journey.optionType.toUpperCase()}`)).first()).toBeVisible();
    await page.getByRole("tab", { name: /Tape/ }).click();
    await expect(page.getByRole("heading", { name: "Decision Tape" })).toBeVisible();
    await expect(page.getByText("open", { exact: true }).first()).toBeVisible();

    // Restart recovery: a fresh page load re-reads persisted state and the position is unchanged.
    await page.reload();
    const reread = await (await page.request.get(new URL(`/api/agents/${agentId}/positions`, origin).toString())).json() as { positions: unknown[] };
    expect(reread.positions.length).toBe(positions.positions.length);
    expect(pageErrors).toEqual([]);
  });
}

test("OPTRA's four House Agents are provisioned, public, read-only and separate from user agents", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is required.");
  const origin = new URL(baseURL).origin;
  const bearer = { authorization: "Bearer e2e-house-cron-secret-0123456789abcdef" };

  // The provisioning route is credentialed; without the secret it refuses.
  expect((await page.request.post(new URL("/api/cron/house-agents", origin).toString(), { headers: { origin } })).status()).toBe(401);
  const provisioned = await page.request.post(new URL("/api/cron/house-agents", origin).toString(), { headers: { ...bearer, origin } });
  expect(provisioned.status()).toBe(200);
  const outcomes = (await provisioned.json() as { agents: Array<{ key: string; status: string; underlyingSymbol: string | null }> }).agents;
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["launched", "launched", "launched", "launched"]);
  expect(outcomes.find((outcome) => outcome.key === "optra-earnings-straddle")?.underlyingSymbol).toBe("NVDA");
  const repeat = await (await page.request.post(new URL("/api/cron/house-agents", origin).toString(), { headers: { ...bearer, origin } })).json() as { agents: Array<{ status: string }> };
  expect(repeat.agents.every((agent) => agent.status === "running")).toBe(true);

  const listed = await (await page.request.get(new URL("/api/public/v1/agents", origin).toString())).json() as { agents: Array<{ id: string; by: string; templateId: string; name: string; status: string; backtest: unknown }> };
  expect(listed.agents.map((agent) => agent.templateId).sort()).toEqual(["cash_secured_put", "covered_call", "earnings_straddle", "protective_put"]);
  expect(listed.agents.every((agent) => agent.by === "Optra" && agent.status === "running" && agent.backtest !== null)).toBe(true);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/agents");
  const live = page.getByRole("region", { name: "OPTRA House Agents running on paper" });
  await expect(live.getByText("by Optra", { exact: true })).toHaveCount(4);
  await expect(live.getByRole("heading", { name: "Covered Call NVDA" })).toBeVisible();
  await live.locator("article", { has: page.getByRole("heading", { name: "Covered Call NVDA" }) }).getByRole("link", { name: "Read its Tape" }).click();
  await expect(page).toHaveURL(/\/house\/[0-9a-f-]+$/i);
  await expect(page.getByRole("heading", { name: "Covered Call NVDA", level: 1 })).toBeVisible();
  await expect(page.getByText("BY OPTRA · PAPER ONLY", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it decides" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision Tape" })).toBeVisible();
  await expect(page.getByText("Premiums are modeled, never recorded venue quotes.", { exact: false })).toBeVisible();
  // The detail page is read-only: it offers no way to tick, pause, stop or trade the agent.
  await expect(page.getByRole("button", { name: /run paper tick|pause|stop|fork/i })).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  // A user's agent id is never served by the public routes.
  const mine = await page.request.get(new URL("/api/public/v1/agents/00000000-0000-4000-8000-000000000000", origin).toString());
  expect(mine.status()).toBe(404);
});
