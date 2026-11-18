import { describe, expect, it } from "vitest";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash, validateRecipe } from "../../lib/hooks/recipe-validator";

const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "5000" });
const relaxedControls = [
  { hookId: "capra", key: "maxPremiumPctHolding", value: 2.01 },
  { hookId: "haltr", key: "maxMove1hPct", value: 7.01 },
  { hookId: "daylo", key: "maxDailyLossPct", value: 3.01 },
  { hookId: "drawra", key: "maxDrawdownPct", value: 20.01 },
  { hookId: "exposa", key: "maxUnderlyingPct", value: 25.01 },
  { hookId: "corpax", key: "pauseHoursBefore", value: 23 },
  { hookId: "corpax", key: "pauseHoursAfter", value: 23 },
  { hookId: "corpax", key: "flagOpenPositions", value: false },
  { hookId: "coverix", key: "lockTokens", value: true },
  { hookId: "trailo", key: "activateAtGainPct", value: 101 },
  { hookId: "trailo", key: "trailPct", value: 31 },
  { hookId: "lastra", key: "hoursBefore", value: 23 },
] as const;

describe("recipe validation", () => {
  it("hashes_equivalent_recipes_deterministically", () => {
    const first = canonicalRecipeHash(recipe);
    const parameters = recipe.parameters;
    const second = canonicalRecipeHash({
      ...recipe,
      parameters: Object.fromEntries(Object.entries(parameters).reverse()),
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("accepts_custom_agents_that_use_the_supported_protective_put_composition", () => {
    const customRecipe = { ...recipe, name: "Custom AAPL protection", templateId: "custom" as const };
    const result = validateRecipe(customRecipe);

    expect(result.valid).toBe(true);
    expect(result.recipeHash).toBe(canonicalRecipeHash(customRecipe));
    expect(result.issues).toEqual([]);
  });

  it.each(relaxedControls)("rejects recipes that relax $hookId.$key", ({ hookId, key, value }) => {
    const customRecipe = {
      ...recipe,
      templateId: "custom" as const,
      parameters: {
        ...recipe.parameters,
        [hookId]: { ...(recipe.parameters[hookId] as Record<string, unknown>), [key]: value },
      },
    };

    const result = validateRecipe(customRecipe);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_PARAMETER", hookId }));
  });

  it("prevents_unverified_hooks_from_being_saved_or_launched", () => {
    const input = { ...recipe, hookIds: [...recipe.hookIds, "unregistered.test"] };
    const result = validateRecipe(input);

    expect(result.valid).toBe(false);
    expect(result.recipeHash).toBe(canonicalRecipeHash(input));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_HOOK", hookId: "unregistered.test" }));
  });

  it("rejects_duplicate_hook_ids_and_missing_mandatory_breakers", () => {
    const result = validateRecipe({ ...recipe, hookIds: [...recipe.hookIds.filter((id) => id !== "venux"), "calmo"] });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "DUPLICATE_HOOK_ID" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_HOOK", hookId: "venux" }));
  });

  it("reports_invalid_recipe_shapes_without_throwing", () => {
    const result = validateRecipe({ ...recipe, templateId: "not_a_template" });

    expect(result.valid).toBe(false);
    expect(result.recipeHash).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_RECIPE" }));
  });
});
