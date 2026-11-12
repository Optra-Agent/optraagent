import { describe, expect, it } from "vitest";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash, validateRecipe } from "../../lib/hooks/recipe-validator";

const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "5000" });

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
