import { describe, expect, it } from "vitest";
import { buildProtectivePutRecipe, getHookCatalog } from "../../lib/hooks/catalog";
import { validateRecipe } from "../../lib/hooks/recipe-validator";

const expected = {
  gate: ["volra", "trendix", "earnex", "gapro", "rangel", "momira", "skewr", "calmo", "corpax", "sessia"],
  strike: ["deltra", "percy", "tenora", "premo", "spreadix", "strangl", "collara"],
  size: ["capra", "kelvo", "laddr", "coverix"],
  pulse: ["profira", "stopra", "trailo", "rolla", "thetix", "hedgra", "rescu"],
  expiry: ["settla", "nextra", "lastra"],
  breaker: ["haltr", "daylo", "drawra", "exposa", "venux"],
} as const;

describe("PM hook catalog and Protective Put recipe", () => {
  it("registers all 36 PM names and stages without claiming unsupported evaluators", () => {
    const catalog = getHookCatalog();
    expect(catalog.coverage).toMatchObject({ sourceStatus: "available", expectedCount: 36, registeredCount: 36 });
    expect(catalog.coverage.expectedByStage).toEqual({ gate: 10, strike: 7, size: 4, pulse: 7, expiry: 3, breaker: 5 });
    for (const [stage, ids] of Object.entries(expected)) {
      expect(catalog.definitions.filter((hook) => hook.stage === stage).map((hook) => hook.id)).toEqual(ids);
    }
    expect(catalog.definitions.filter((hook) => hook.availability === "implemented").map((hook) => hook.id).sort()).toEqual([
      "calmo", "capra", "corpax", "coverix", "daylo", "deltra", "drawra", "earnex", "exposa", "haltr", "kelvo", "lastra", "nextra", "percy", "premo",
      "profira", "rescu", "sessia", "settla", "stopra", "strangl", "tenora", "trailo", "trendix", "venux", "volra",
    ]);
    expect(catalog.definitions.filter((hook) => hook.availability === "catalog_only").map((hook) => hook.id).sort()).toEqual([
      "collara", "gapro", "hedgra", "laddr", "momira", "rangel", "rolla", "skewr", "spreadix", "thetix",
    ]);
  });

  it("builds and validates the exact modeled paper Protective Put composition", () => {
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "5000" });
    expect(recipe.hookIds).toEqual([
      "calmo", "corpax", "sessia", "percy", "tenora", "coverix", "capra", "trailo", "lastra", "nextra",
      "haltr", "daylo", "drawra", "exposa", "venux",
    ]);
    expect(validateRecipe(recipe)).toMatchObject({ valid: true, issues: [], recipeHash: expect.stringMatching(/^sha256:/) });
  });

  it("rejects missing mandatory Breakers and catalog-only hooks", () => {
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "5000" });
    expect(validateRecipe({ ...recipe, hookIds: recipe.hookIds.filter((id) => id !== "venux") }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIRED_HOOK", hookId: "venux" })]));
    expect(validateRecipe({ ...recipe, hookIds: [...recipe.hookIds, "gapro"] }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_HOOK", hookId: "gapro" })]));
  });

  it("rejects short legs and invalid single-leg compositions", () => {
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "5000" });
    const shortPut = { ...recipe, parameters: { ...recipe.parameters, percy: { type: "put", side: "sell", otmPct: 7 } } };
    expect(validateRecipe(shortPut).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_COMPOSITION" }),
    ]));
    expect(validateRecipe({ ...recipe, hookIds: recipe.hookIds.filter((id) => id !== "tenora") }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_REQUIRED_HOOK", hookId: "tenora" })]));
  });
});
