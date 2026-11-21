import { describe, expect, it } from "vitest";
import { buildProtectivePutRecipe, getHookCatalog } from "../../lib/hooks/catalog";
import { HOUSE_SPECS, HOUSE_STRATEGY_HOOK_IDS, HOUSE_STRATEGY_TEMPLATE_IDS, buildHouseRecipe } from "../../lib/hooks/house-specs";
import type { HouseStrategyTemplateId } from "../../lib/hooks/house-specs";
import { canonicalRecipeHash, validateRecipe } from "../../lib/hooks/recipe-validator";
import type { RecipeV1 } from "../../lib/domain/contracts";

const BREAKERS = ["haltr", "daylo", "drawra", "exposa", "venux"];

const mutate = (recipe: RecipeV1, hookId: string, patch: Record<string, unknown>): RecipeV1 => ({
  ...recipe, parameters: { ...recipe.parameters, [hookId]: { ...(recipe.parameters[hookId] as Record<string, unknown>), ...patch } },
});

describe("House Agent recipes follow the PM brief", () => {
  const pm: Record<HouseStrategyTemplateId, string[]> = {
    covered_call: ["volra", "earnex", "corpax", "percy", "tenora", "coverix", "capra", "profira", "rescu", "settla", "nextra"],
    cash_secured_put: ["volra", "trendix", "earnex", "corpax", "deltra", "tenora", "premo", "capra", "profira", "stopra", "rescu", "settla", "nextra"],
    earnings_straddle: ["earnex", "corpax", "strangl", "tenora", "capra", "kelvo", "profira", "stopra", "lastra"],
  };

  it.each(HOUSE_STRATEGY_TEMPLATE_IDS)("%s carries exactly the PM hooks plus the five mandatory Breakers", (templateId) => {
    expect(HOUSE_STRATEGY_HOOK_IDS[templateId]).toEqual([...pm[templateId], ...BREAKERS]);
    const recipe = buildHouseRecipe(templateId, { underlyingSymbol: "NVDA" });
    expect(recipe.hookIds).toEqual([...pm[templateId], ...BREAKERS]);
    const catalog = getHookCatalog();
    for (const hookId of recipe.hookIds) expect(catalog.definitions.find((hook) => hook.id === hookId)?.availability, hookId).toBe("implemented");
  });

  it.each(HOUSE_STRATEGY_TEMPLATE_IDS)("%s builds a valid, canonically hashed recipe with PM default parameters", (templateId) => {
    const recipe = buildHouseRecipe(templateId, { underlyingSymbol: "nvda" });
    expect(recipe.underlyingSymbol).toBe("NVDA");
    const result = validateRecipe(recipe);
    expect(result).toMatchObject({ valid: true, issues: [], recipeHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    expect(result.recipeHash).toBe(canonicalRecipeHash(recipe));
    expect(canonicalRecipeHash(buildHouseRecipe(templateId, { underlyingSymbol: "NVDA" }))).toBe(result.recipeHash);
  });

  it("encodes the PM defaults for each strategy", () => {
    const cc = buildHouseRecipe("covered_call", { underlyingSymbol: "NVDA" }).parameters;
    expect(cc).toMatchObject({
      volra: { op: "above", threshold: 50 }, earnex: { mode: "block", daysBefore: 2, daysAfter: 1 }, percy: { type: "call", side: "sell", otmPct: 5 },
      tenora: { cycle: "weekly", targetDTE: 7, minDTE: 2 }, coverix: { coveragePct: 100 }, capra: { maxOpenPositions: 1 }, profira: { capturePct: 50 },
      rescu: { itmPct: 2, action: "rollOutAndAway", maxRescues: 1 }, settla: { otmBufferPct: 2, checkHoursBefore: 6 }, haltr: { maxMove1hPct: 7 },
      daylo: { maxDailyLossPct: 3 }, drawra: { maxDrawdownPct: 20 }, exposa: { maxUnderlyingPct: 100 },
    });
    const csp = buildHouseRecipe("cash_secured_put", { underlyingSymbol: "NVDA" }).parameters;
    expect(csp).toMatchObject({
      trendix: { timeframe: "1d", fast: 20, slow: 50, direction: "bullish" }, deltra: { type: "put", side: "sell", targetDelta: 0.25, tolerance: 0.05 },
      premo: { minPremiumPct: 0.6 }, capra: { maxPctPerPosition: 50, maxOpenPositions: 2, cashSecured: true }, stopra: { basis: "premium", premiumMultiple: 2 },
    });
    const straddle = buildHouseRecipe("earnings_straddle", { underlyingSymbol: "NVDA" }).parameters;
    expect(straddle).toMatchObject({
      earnex: { mode: "only", daysBefore: 3, daysAfter: 0 }, strangl: { kind: "straddle", otmPct: 0 }, capra: { maxPctPerPosition: 5, maxOpenPositions: 1 },
      kelvo: { targetVol: 60 }, profira: { gainPct: 40 }, stopra: { lossPct: 50 }, lastra: { hoursBefore: 24 },
    });
  });

  it("is independent of object key order, as jsonb storage reorders keys", () => {
    for (const templateId of HOUSE_STRATEGY_TEMPLATE_IDS) {
      const recipe = buildHouseRecipe(templateId, { underlyingSymbol: "NVDA" });
      const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
      const stored = { ...recipe, parameters: reorder(recipe.parameters) as RecipeV1["parameters"] };
      expect(validateRecipe(stored)).toMatchObject({ valid: true, recipeHash: canonicalRecipeHash(recipe) });
    }
  });

  it("accepts permitted customization and changes the hash", () => {
    const base = buildHouseRecipe("covered_call", { underlyingSymbol: "NVDA" });
    const tuned = buildHouseRecipe("covered_call", { underlyingSymbol: "NVDA", referenceShares: 25, initialCapitalUsd: 3000, overrides: { percy: { type: "call", side: "sell", otmPct: 8, rounding: "nearest", strikeIncrementUsd: 0.01 }, profira: { capturePct: 70 } } });
    expect(validateRecipe(tuned).valid).toBe(true);
    expect(canonicalRecipeHash(tuned)).not.toBe(canonicalRecipeHash(base));
  });
});

describe("House Agent validator rejects unsafe or unsupported recipes", () => {
  const cc = buildHouseRecipe("covered_call", { underlyingSymbol: "NVDA" });
  const csp = buildHouseRecipe("cash_secured_put", { underlyingSymbol: "NVDA" });
  const straddle = buildHouseRecipe("earnings_straddle", { underlyingSymbol: "NVDA" });
  const drop = (recipe: RecipeV1, hookId: string): RecipeV1 => ({ ...recipe, hookIds: recipe.hookIds.filter((id) => id !== hookId) });

  const invalid: Array<[string, RecipeV1, string | RegExp]> = [
    ["CC: naked call (side buy)", mutate(cc, "percy", { side: "buy" }), "percy.side"],
    ["CC: put instead of call", mutate(cc, "percy", { type: "put" }), "percy.type"],
    ["CC: ITM short call", mutate(cc, "percy", { otmPct: -5 }), "percy.otmPct"],
    ["CC: coverage above 100%", mutate(cc, "coverix", { coveragePct: 150 }), "coverix.coveragePct"],
    ["CC: token locking claimed", mutate(cc, "coverix", { lockTokens: true }), "coverix.lockTokens"],
    ["CC: two simultaneous calls", mutate(cc, "capra", { maxOpenPositions: 2 }), "capra.maxOpenPositions"],
    ["CC: missing Coverix", drop(cc, "coverix"), "Covered Call requires coverix"],
    ["CC: missing Earnex", drop(cc, "earnex"), "requires earnex"],
    ["CC: respectGate disabled", mutate(cc, "nextra", { respectGate: false }), "nextra.respectGate"],
    ["CC: no shares", { ...cc, parameters: { ...cc.parameters, referenceShares: "0" } }, "referenceShares"],
    ["CC: fractional shares", { ...cc, parameters: { ...cc.parameters, referenceShares: "1.5" } }, "referenceShares"],
    ["CC: Exposa above 100", mutate(cc, "exposa", { maxUnderlyingPct: 150 }), "exposa.maxUnderlyingPct"],
    ["CSP: collateral not required", mutate(csp, "capra", { cashSecured: false }), "capra.cashSecured"],
    ["CSP: three positions", mutate(csp, "capra", { maxOpenPositions: 3 }), "capra.maxOpenPositions"],
    ["CSP: 80% of capital per position", mutate(csp, "capra", { maxPctPerPosition: 80 }), "capra.maxPctPerPosition"],
    ["CSP: call instead of put", mutate(csp, "deltra", { type: "call" }), "deltra.type"],
    ["CSP: delta above 0.4", mutate(csp, "deltra", { targetDelta: 0.6 }), "deltra.targetDelta"],
    ["CSP: fast SMA not below slow", mutate(mutate(csp, "trendix", { fast: 50 }), "trendix", { slow: 20 }), "fast average"],
    ["CSP: bearish Trendix", mutate(csp, "trendix", { direction: "bearish" }), "trendix.direction"],
    ["CSP: stop on the underlying", mutate(csp, "stopra", { basis: "underlying" }), "stopra.basis"],
    ["CSP: missing Trendix", drop(csp, "trendix"), "requires trendix"],
    ["CSP: Premo above 5%", mutate(csp, "premo", { minPremiumPct: 9 }), "premo.minPremiumPct"],
    ["Straddle: block mode", mutate(straddle, "earnex", { mode: "block" }), "earnex.mode"],
    ["Straddle: strangle", mutate(straddle, "strangl", { kind: "strangle", otmPct: 5 }), "strangl.kind"],
    ["Straddle: 20% of capital", mutate(straddle, "capra", { maxPctPerPosition: 20 }), "capra.maxPctPerPosition"],
    ["Straddle: Lastra above 48h", mutate(straddle, "lastra", { hoursBefore: 60 }), "lastra.hoursBefore"],
    ["Straddle: Kelvo maxScale above 1", mutate(straddle, "kelvo", { maxScale: 2 }), "kelvo.maxScale"],
    ["Straddle: missing Kelvo", drop(straddle, "kelvo"), "requires kelvo"],
    ["Mandatory Breaker removed (Daylo)", drop(cc, "daylo"), "requires daylo"],
    ["Breaker loosened (Haltr 15%)", mutate(csp, "haltr", { maxMove1hPct: 15 }), "haltr.maxMove1hPct"],
    ["Breaker loosened (Drawra 40%)", mutate(straddle, "drawra", { maxDrawdownPct: 40 }), "drawra.maxDrawdownPct"],
    ["Corpax window shortened", mutate(cc, "corpax", { pauseHoursBefore: 2 }), "corpax.pauseHoursBefore"],
    ["Unsupported extra parameter", mutate(cc, "profira", { gainPct: 10 }), "profira.gainPct"],
    ["Unsupported extra hook", { ...cc, hookIds: [...cc.hookIds, "gapro"] }, /gapro/],
    ["Premium model altered", { ...cc, parameters: { ...cc.parameters, paperModel: { ...(cc.parameters.paperModel as object), slippageBps: 0 } } }, "documented RV30"],
    ["Capital below minimum", { ...csp, parameters: { ...csp.parameters, initialCapitalUsd: "10" } }, "paper capital"],
    ["Unknown top-level parameter", { ...straddle, parameters: { ...straddle.parameters, leverage: 5 } }, "Unsupported recipe parameter"],
    ["Custom template cannot carry strategy hooks", { ...cc, templateId: "custom" }, /not part of the supported Protective Put evaluator|requires/],
  ];

  it.each(invalid)("%s", (_name, recipe, expected) => {
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(" | ")).toMatch(typeof expected === "string" ? new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : expected);
  });

  it("keeps the Protective Put recipe valid and unchanged by the strategy specs", () => {
    const put = buildProtectivePutRecipe({ underlyingSymbol: "NVDA", protectedShares: "100", initialCapitalUsd: "100000" });
    expect(validateRecipe(put).valid).toBe(true);
    expect(Object.keys(HOUSE_SPECS)).not.toContain("protective_put");
  });
});
