import { describe, expect, it } from "vitest";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { createBacktestHandlers } from "../../lib/backtest/handlers";
import type { Session, BacktestRun, RecipeV1 } from "../../lib/domain/contracts";
import type { StoredPaperAgent } from "../../lib/paper/drizzle-repository";

const OWNER: Session = { user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z" };
const RECIPE: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: ["unknown"], parameters: {} };
const AGENT: StoredPaperAgent = {
  id: "123e4567-e89b-42d3-a456-426614174000", ownerId: OWNER.user.id, name: "Preview", templateId: "custom", status: "draft",
  recipeHash: canonicalRecipeHash(RECIPE), backtestRunId: null, createdAt: "2026-11-12T03:00:00.000Z", updatedAt: "2026-11-12T03:00:00.000Z", recipe: RECIPE,
};

function setup(session: Session | null = OWNER) {
  let launched = false;
  let persistedOwner = "";
  const repository = {
    async listHourlySnapshots() { return []; },
    async createBacktestRun(ownerId: string, _recipe: RecipeV1, run: BacktestRun) { persistedOwner = ownerId; return run; },
    async getBacktestRun() { return null; },
    async launchAgent() { launched = true; return true; },
  };
  const handlers = createBacktestHandlers({
    repository,
    agents: { findAgent: async (ownerId, agentId) => ownerId === OWNER.user.id && agentId === AGENT.id ? AGENT : null },
    readSession: async () => session ?? Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required.", retryable: false } }, { status: 401 }),
    listMarkets: async () => [{ symbol: "AAPL", name: "Apple", currentMultiplier: "1.001" }],
    now: () => new Date("2026-11-12T03:31:00.000Z"),
    newRunId: () => "123e4567-e89b-42d3-a456-426614174001",
  });
  return { handlers, didLaunch: () => launched, getPersistedOwner: () => persistedOwner };
}

describe("backtest API and launch gate", () => {
  it("returns_real_hourly_coverage_without_a_session", async () => {
    const { handlers } = setup();
    const response = await handlers.coverage(new Request("http://localhost/api/backtests/coverage?symbol=AAPL"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ symbol: "AAPL", availableSamples: 0, requiredSamples: 720, ready: false });
  });

  it("persists_an_insufficient_backtest_under_the_session_owner", async () => {
    const { handlers, getPersistedOwner } = setup();
    const response = await handlers.create(new Request("http://localhost/api/backtests", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipe: RECIPE, ownerId: "attacker" }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ status: "insufficient_data", sampleCount: 0, metrics: null, premiumSource: "unavailable" });
    expect(getPersistedOwner()).toBe(OWNER.user.id);
  });

  it("keeps_launch_closed_when_no_matching_complete_backtest_exists", async () => {
    const { handlers, didLaunch } = setup();
    const response = await handlers.launch(new Request("http://localhost/api/agents/id/launch", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ backtestRunId: "123e4567-e89b-42d3-a456-426614174001" }),
    }), AGENT.id);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "BACKTEST_REQUIRED", details: { reasons: expect.arrayContaining(["BACKTEST_REQUIRED"]) } } });
    expect(didLaunch()).toBe(false);
  });

  it("requires_authentication_for_backtest_writes", async () => {
    const { handlers } = setup(null);
    const response = await handlers.create(new Request("http://localhost/api/backtests", { method: "POST", body: "{}" }));

    expect(response.status).toBe(401);
  });
});
