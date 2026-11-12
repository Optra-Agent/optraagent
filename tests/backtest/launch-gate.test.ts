import { describe, expect, it } from "vitest";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { evaluatePaperLaunch } from "../../lib/backtest/launch-gate";
import type { BacktestRun, RecipeV1 } from "../../lib/domain/contracts";

const recipe: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: ["unknown"], parameters: {} };
const recipeHash = canonicalRecipeHash(recipe);
const backtest: BacktestRun = {
  id: "backtest-1", recipeHash, dataSource: "robinhood_stock_token_api", startAt: "2026-10-13T12:00:00.000Z", endAt: "2026-11-12T12:00:00.000Z",
  sampleCount: 720, hourlyCoverageComplete: true, premiumSource: "recorded", pricingMethod: "recorded", status: "complete",
  metrics: { totalReturnPct: "0", maxDrawdownPct: "0", endingCashUsd: "10000" },
  reason: "Verified paper backtest.", createdAt: "2026-11-12T12:01:00.000Z",
};

describe("paper launch eligibility", () => {
  it("requires_a_complete_backtest_for_the_same_recipe_hash", () => {
    const sameHash = evaluatePaperLaunch({ recipe, recipeHash, backtest });
    const changedRecipe = evaluatePaperLaunch({ recipe, recipeHash: `sha256:${"b".repeat(64)}`, backtest });

    expect(sameHash.allowed).toBe(false);
    expect(sameHash.reasons).toContain("UNSUPPORTED_HOOK");
    expect(changedRecipe.reasons).toContain("RECIPE_HASH_MISMATCH");
  });

  it("rejects_missing_short_incomplete_and_unpriced_backtests", () => {
    const noRun = evaluatePaperLaunch({ recipe, recipeHash, backtest: null });
    const short = evaluatePaperLaunch({ recipe, recipeHash, backtest: { ...backtest, sampleCount: 719 } });
    const unavailable = evaluatePaperLaunch({ recipe, recipeHash, backtest: { ...backtest, pricingMethod: "unavailable" } });

    expect(noRun.reasons).toContain("BACKTEST_REQUIRED");
    expect(short.reasons).toContain("BACKTEST_REQUIRED");
    expect(unavailable.reasons).toContain("PRICING_UNAVAILABLE");
  });
});
