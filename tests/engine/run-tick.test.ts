import { describe, expect, it } from "vitest";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { runTick } from "../../lib/engine/run-tick";
import type { MarketSnapshot, RecipeV1 } from "../../lib/domain/contracts";

const recipe: RecipeV1 = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
const recipeHash = canonicalRecipeHash(recipe);
const freshSnapshot: MarketSnapshot = {
  symbol: "AAPL", source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: "2026-11-12T03:31:00.000Z",
  underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: "1.001", tokenBidUsd: "356.16", tokenAskUsd: "356.38",
  currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
};

function input(snapshot: MarketSnapshot | null = freshSnapshot) {
  return {
    agentId: "agent-1",
    tickId: "tick-1",
    occurredAt: "2026-11-12T03:31:00.000Z",
    recipe,
    recipeHash,
    snapshot,
    state: { status: "running" as const },
  };
}

describe("deterministic paper tick", () => {
  it("returns_the_same_decision_and_no_order_intents_for_identical_input", () => {
    const first = runTick(input());
    const second = runTick(input());

    expect(first).toEqual(second);
    expect(first.decision.action).toBe("skip");
    expect(first.orderIntents).toEqual([]);
  });

  it("stale_data_skips_new_entry_even_when_snapshot_claims_fresh", () => {
    const stale = { ...freshSnapshot, observedAt: "2026-11-12T03:20:00.000Z", stale: false };

    const result = runTick(input(stale));

    expect(result.decision.action).toBe("skip");
    expect(result.decision.hookResults).toContainEqual(expect.objectContaining({ hookId: "haltr", status: "block" }));
    expect(result.orderIntents).toEqual([]);
  });

  it("missing_data_and_unverified_recipes_never_open_a_position", () => {
    const result = runTick(input(null));

    expect(result.decision.action).toBe("skip");
    expect(result.decision.reason).toContain("unavailable");
    expect(result.orderIntents).toEqual([]);
  });

  it("does_not_tick_paused_or_stopped_agents", () => {
    const result = runTick({ ...input(), state: { status: "paused" as const } });

    expect(result.decision.action).toBe("skip");
    expect(result.decision.reason).toContain("paused");
  });
});
