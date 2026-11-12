import { describe, expect, it } from "vitest";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { createPaperHandlers } from "../../lib/paper/handlers";
import type { Session, AgentDecision, MarketSnapshot, RecipeV1, PaperPosition } from "../../lib/domain/contracts";
import type { StoredPaperAgent, PersistTickInput, PersistTickResult } from "../../lib/paper/drizzle-repository";

const recipe: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: ["unknown"], parameters: {} };
const now = "2026-11-12T03:31:00.000Z";
const snapshot: MarketSnapshot = {
  symbol: "AAPL", source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: now,
  underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: "1.001", tokenBidUsd: "356.16", tokenAskUsd: "356.38",
  currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
};
const session: Session = { user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z" };
const agent: StoredPaperAgent = {
  id: "123e4567-e89b-42d3-a456-426614174000", ownerId: session.user.id, name: "Preview", templateId: "custom", status: "running",
  recipeHash: canonicalRecipeHash(recipe), backtestRunId: null, createdAt: now, updatedAt: now, recipe,
};

function testHarness(owner: Session | null = session) {
  const decisions = new Map<string, AgentDecision>();
  let snapshotCalls = 0;
  const repository = {
    async getDecision(_ownerId: string, _agentId: string, tickId: string) { return decisions.get(tickId) ?? null; },
    async findAgent(ownerId: string, agentId: string) { return ownerId === session.user.id && agentId === agent.id ? agent : null; },
    async persistTick(input: PersistTickInput): Promise<PersistTickResult> {
      const existing = decisions.get(input.tickId);
      if (existing) return { decision: existing, duplicate: true };
      const execution = input.evaluate({ agent, account: null, position: null });
      decisions.set(input.tickId, execution.decision);
      return { decision: execution.decision, duplicate: false, orderCount: execution.orderIntents.length };
    },
    async listTape(ownerId: string, agentId: string) { return ownerId === session.user.id && agentId === agent.id ? [...decisions.values()] : []; },
    async listPositions(): Promise<PaperPosition[]> { return []; },
  };
  const handlers = createPaperHandlers({
    repository,
    readSession: async () => owner ?? Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required.", retryable: false } }, { status: 401 }),
    getSnapshot: async () => { snapshotCalls += 1; return snapshot; },
    now: () => new Date(now),
  });
  return { handlers, getSnapshotCalls: () => snapshotCalls };
}

describe("paper tick and Tape handlers", () => {
  it("rejects_an_unauthenticated_tick_before_market_or_database_access", async () => {
    const { handlers, getSnapshotCalls } = testHarness(null);
    const response = await handlers.tick(new Request("http://localhost/api/agents/id/tick", { method: "POST" }), agent.id);

    expect(response.status).toBe(401);
    expect(getSnapshotCalls()).toBe(0);
  });

  it("requires_an_idempotency_key_and_returns_only_paper_decisions", async () => {
    const { handlers, getSnapshotCalls } = testHarness();
    const missingKey = await handlers.tick(new Request("http://localhost", { method: "POST" }), agent.id);
    const request = () => new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "paper-tick-1" } });
    const first = await handlers.tick(request(), agent.id);
    const duplicate = await handlers.tick(request(), agent.id);

    expect(missingKey.status).toBe(400);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ executionMode: "PAPER", orderCount: 0, idempotentReplay: false, decision: { action: "skip" } });
    await expect(duplicate.json()).resolves.toMatchObject({ executionMode: "PAPER", orderCount: 0, idempotentReplay: true });
    expect(getSnapshotCalls()).toBe(1);
  });

  it("serves_owner_scoped_append_only_tape_and_positions_reads", async () => {
    const { handlers } = testHarness();
    const tick = await handlers.tick(new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "read-tick" } }), agent.id);
    const tape = await handlers.tape(new Request("http://localhost"), agent.id);
    const positions = await handlers.positions(new Request("http://localhost"), agent.id);
    const methodNotAllowed = await handlers.tape(new Request("http://localhost", { method: "DELETE" }), agent.id);

    expect(tick.status).toBe(200);
    await expect(tape.json()).resolves.toMatchObject({ executionMode: "PAPER", decisions: [{ tickId: "read-tick" }] });
    await expect(positions.json()).resolves.toEqual({ executionMode: "PAPER", positions: [] });
    expect(methodNotAllowed.status).toBe(405);
  });
});
