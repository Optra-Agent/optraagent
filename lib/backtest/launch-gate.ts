import type { BacktestRun, RecipeV1 } from "../domain/contracts";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";
import { REQUIRED_HOURLY_SAMPLES } from "./run";

export type PaperLaunchEligibility = {
  allowed: boolean;
  reasons: string[];
};

export function evaluatePaperLaunch(input: {
  recipe: RecipeV1;
  recipeHash: string;
  backtest: BacktestRun | null;
}): PaperLaunchEligibility {
  const reasons = new Set<string>();
  const canonicalHash = canonicalRecipeHash(input.recipe);
  if (canonicalHash !== input.recipeHash) reasons.add("RECIPE_HASH_MISMATCH");

  const validation = validateRecipe(input.recipe);
  for (const issue of validation.issues) reasons.add(issue.code);

  const backtest = input.backtest;
  if (
    !backtest ||
    backtest.status !== "complete" ||
    backtest.sampleCount < REQUIRED_HOURLY_SAMPLES ||
    !backtest.hourlyCoverageComplete ||
    backtest.metrics === null
  ) {
    reasons.add("BACKTEST_REQUIRED");
  }
  if (backtest && (
    !backtest.historyDataHash ||
    !backtest.historyProvenance ||
    !backtest.pricingAssumptions ||
    (backtest.entryOrderCount ?? 0) < 1
  )) reasons.add("BACKTEST_PROVENANCE_REQUIRED");
  if (backtest && backtest.recipeHash !== input.recipeHash) reasons.add("RECIPE_HASH_MISMATCH");
  if (backtest && (backtest.premiumSource === "unavailable" || backtest.pricingMethod === "unavailable")) {
    reasons.add("PRICING_UNAVAILABLE");
  }

  return { allowed: reasons.size === 0, reasons: [...reasons] };
}
