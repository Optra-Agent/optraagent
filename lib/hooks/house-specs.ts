import { RecipeV1Schema } from "../domain/contracts";
import type { RecipeV1, RecipeValidationIssue } from "../domain/contracts";

/**
 * Versioned recipes for the three House Agents that use the shared options-strategy engine
 * (Covered Call, Cash-Secured Put, Earnings Straddle). Protective Put keeps its own builder in `catalog.ts`.
 *
 * Every recipe is a closed specification: the exact hook list is fixed per template, every hook carries exactly the
 * parameters listed here, and each parameter is either pinned to the PM default or limited to a permitted range.
 * A user's customization therefore always stays inside the PM brief's safety bounds, and the canonical recipe hash
 * identifies one precise, validated behavior.
 */

export const HOUSE_STRATEGY_TEMPLATE_IDS = ["covered_call", "cash_secured_put", "earnings_straddle"] as const;
export type HouseStrategyTemplateId = (typeof HOUSE_STRATEGY_TEMPLATE_IDS)[number];

export const HOUSE_RECIPE_VERSION = "house-v1";

type Rule =
  | { key: string; kind: "range"; min: number; max: number; integer?: boolean }
  | { key: string; kind: "fixed"; value: unknown }
  | { key: string; kind: "enum"; values: readonly unknown[] };

type HookSpec = { hook: string; defaults: Record<string, unknown>; rules: Rule[] };

type TemplateSpec = {
  name: string;
  hooks: HookSpec[];
  /** Top-level numeric inputs, besides initialCapitalUsd. */
  extraTopLevel: Array<{ key: string; min: number; max: number; integer?: boolean; default: number }>;
  capital: { min: number; max: number; default: number };
  paperModel: Record<string, unknown>;
};

const range = (key: string, min: number, max: number, integer = false): Rule => ({ key, kind: "range", min, max, integer });
const fixed = (key: string, value: unknown): Rule => ({ key, kind: "fixed", value });

function hook(hookId: string, defaults: Record<string, unknown>, rules: Rule[]): HookSpec {
  return { hook: hookId, defaults, rules };
}

const breakers = (exposaMax: number): HookSpec[] => [
  hook("haltr", { maxMove1hPct: 7, ivSpikePct: 50, cooldownHours: 6 }, [range("maxMove1hPct", 2, 7), fixed("ivSpikePct", 50), fixed("cooldownHours", 6)]),
  hook("daylo", { maxDailyLossPct: 3 }, [range("maxDailyLossPct", 0.5, 3)]),
  hook("drawra", { maxDrawdownPct: 20, onTrip: "stopEntries" }, [range("maxDrawdownPct", 5, 20), fixed("onTrip", "stopEntries")]),
  hook("exposa", { maxUnderlyingPct: exposaMax }, [range("maxUnderlyingPct", 5, exposaMax)]),
  hook("venux", { maxQuoteAgeMin: 10, maxSpreadPct: 15, maxModelDevPct: 25, maxErrorRate: 20, allowModeledPremium: true }, [
    fixed("maxQuoteAgeMin", 10), fixed("maxSpreadPct", 15), fixed("maxModelDevPct", 25), fixed("maxErrorRate", 20), fixed("allowModeledPremium", true),
  ]),
];

const corpax = hook("corpax", { pauseHoursBefore: 24, pauseHoursAfter: 24, flagOpenPositions: true }, [range("pauseHoursBefore", 24, 72, true), range("pauseHoursAfter", 24, 72, true), fixed("flagOpenPositions", true)]);

const weeklyTenora = (rules: Rule[], defaults: Record<string, unknown>): HookSpec => hook("tenora", defaults, rules);

const percyCall = hook("percy", { type: "call", side: "sell", otmPct: 5, rounding: "nearest", strikeIncrementUsd: 0.01 }, [
  fixed("type", "call"), fixed("side", "sell"), range("otmPct", 1, 20), fixed("rounding", "nearest"), fixed("strikeIncrementUsd", 0.01),
]);

const volra = hook("volra", { metric: "ivRank", op: "above", threshold: 50, ivSource: "rv168_rank_proxy" }, [
  fixed("metric", "ivRank"), fixed("op", "above"), range("threshold", 0, 100), fixed("ivSource", "rv168_rank_proxy"),
]);

const earnexBlock = hook("earnex", { mode: "block", daysBefore: 2, daysAfter: 1 }, [fixed("mode", "block"), range("daysBefore", 1, 10, true), range("daysAfter", 0, 5, true)]);

const nextra = hook("nextra", { when: "afterSettle", hoursBefore: 4, respectGate: true }, [fixed("when", "afterSettle"), fixed("hoursBefore", 4), fixed("respectGate", true)]);
const settla = hook("settla", { otmBufferPct: 2, checkHoursBefore: 6 }, [range("otmBufferPct", 0.5, 10), range("checkHoursBefore", 1, 24, true)]);

const paperModel = (model: string): Record<string, unknown> => ({
  model,
  premiumSource: "modeled",
  ivSource: "rv30_annualized_times_1_1",
  ivMultiplier: 1.1,
  riskFreeRate: 0,
  dividendYield: 0,
  modelUnitShares: 1,
  strikeIncrementUsd: 0.01,
  slippageBps: 50,
  venueFeeBps: null,
  venueFeesIncluded: false,
});

export const HOUSE_SPECS: Record<HouseStrategyTemplateId, TemplateSpec> = {
  covered_call: {
    name: "Covered Call",
    capital: { min: 100, max: 10_000_000, default: 1000 },
    extraTopLevel: [{ key: "referenceShares", min: 1, max: 100_000, integer: true, default: 10 }],
    paperModel: paperModel("black_scholes_european_call"),
    hooks: [
      volra,
      earnexBlock,
      corpax,
      percyCall,
      weeklyTenora([fixed("cycle", "weekly"), range("targetDTE", 3, 21, true), range("minDTE", 2, 7, true), fixed("expiryConvention", "weekly_friday_1600_et")], { cycle: "weekly", targetDTE: 7, minDTE: 2, expiryConvention: "weekly_friday_1600_et" }),
      hook("coverix", { coveragePct: 100, lockTokens: false }, [range("coveragePct", 10, 100), fixed("lockTokens", false)]),
      hook("capra", { maxPctPerPosition: 100, maxOpenPositions: 1 }, [range("maxPctPerPosition", 10, 100), fixed("maxOpenPositions", 1)]),
      hook("profira", { capturePct: 50 }, [range("capturePct", 10, 95)]),
      hook("rescu", { itmPct: 2, action: "rollOutAndAway", maxRescues: 1, requireNetCredit: true }, [range("itmPct", 1, 20), fixed("action", "rollOutAndAway"), range("maxRescues", 0, 3, true), fixed("requireNetCredit", true)]),
      settla,
      nextra,
      ...breakers(100),
    ],
  },
  cash_secured_put: {
    name: "Cash-Secured Put",
    capital: { min: 1000, max: 10_000_000, default: 10_000 },
    extraTopLevel: [],
    paperModel: paperModel("black_scholes_european_put"),
    hooks: [
      volra,
      hook("trendix", { timeframe: "1d", fast: 20, slow: 50, direction: "bullish" }, [fixed("timeframe", "1d"), range("fast", 5, 50, true), range("slow", 10, 100, true), fixed("direction", "bullish")]),
      earnexBlock,
      corpax,
      hook("deltra", { type: "put", side: "sell", targetDelta: 0.25, tolerance: 0.05, strikeIncrementUsd: 0.01 }, [fixed("type", "put"), fixed("side", "sell"), range("targetDelta", 0.1, 0.4), range("tolerance", 0.01, 0.1), fixed("strikeIncrementUsd", 0.01)]),
      weeklyTenora([fixed("cycle", "weekly"), range("targetDTE", 3, 21, true), range("minDTE", 2, 7, true), fixed("expiryConvention", "weekly_friday_1600_et")], { cycle: "weekly", targetDTE: 7, minDTE: 2, expiryConvention: "weekly_friday_1600_et" }),
      hook("premo", { minPremiumPct: 0.6 }, [range("minPremiumPct", 0.1, 5)]),
      hook("capra", { maxPctPerPosition: 50, maxOpenPositions: 2, cashSecured: true }, [range("maxPctPerPosition", 5, 50), range("maxOpenPositions", 1, 2, true), fixed("cashSecured", true)]),
      hook("profira", { capturePct: 50 }, [range("capturePct", 10, 95)]),
      hook("stopra", { basis: "premium", premiumMultiple: 2 }, [fixed("basis", "premium"), range("premiumMultiple", 1.5, 5)]),
      hook("rescu", { itmPct: 2, action: "rollOutAndAway", maxRescues: 1, requireNetCredit: true }, [range("itmPct", 1, 20), fixed("action", "rollOutAndAway"), range("maxRescues", 0, 3, true), fixed("requireNetCredit", true)]),
      settla,
      nextra,
      ...breakers(100),
    ],
  },
  earnings_straddle: {
    name: "Earnings Straddle",
    capital: { min: 1000, max: 10_000_000, default: 10_000 },
    extraTopLevel: [],
    paperModel: paperModel("black_scholes_european_straddle"),
    hooks: [
      hook("earnex", { mode: "only", daysBefore: 3, daysAfter: 0 }, [fixed("mode", "only"), range("daysBefore", 1, 10, true), fixed("daysAfter", 0)]),
      corpax,
      hook("strangl", { kind: "straddle", otmPct: 0 }, [fixed("kind", "straddle"), fixed("otmPct", 0)]),
      weeklyTenora([fixed("cycle", "weekly"), fixed("targetDTE", 7), range("minDTE", 2, 7, true), fixed("expiryConvention", "weekly_friday_1600_et"), fixed("anchor", "first_expiry_after_earnings")], { cycle: "weekly", targetDTE: 7, minDTE: 2, expiryConvention: "weekly_friday_1600_et", anchor: "first_expiry_after_earnings" }),
      hook("capra", { maxPctPerPosition: 5, maxOpenPositions: 1 }, [range("maxPctPerPosition", 1, 5), fixed("maxOpenPositions", 1)]),
      hook("kelvo", { targetVol: 60, minScale: 0.25, maxScale: 1 }, [range("targetVol", 10, 150), range("minScale", 0.1, 1), fixed("maxScale", 1)]),
      hook("profira", { gainPct: 40 }, [range("gainPct", 10, 300)]),
      hook("stopra", { basis: "premium", lossPct: 50 }, [fixed("basis", "premium"), range("lossPct", 10, 100)]),
      hook("lastra", { hoursBefore: 24 }, [range("hoursBefore", 1, 48, true)]),
      ...breakers(25),
    ],
  },
};

export const HOUSE_STRATEGY_HOOK_IDS: Record<HouseStrategyTemplateId, string[]> = {
  covered_call: HOUSE_SPECS.covered_call.hooks.map((spec) => spec.hook),
  cash_secured_put: HOUSE_SPECS.cash_secured_put.hooks.map((spec) => spec.hook),
  earnings_straddle: HOUSE_SPECS.earnings_straddle.hooks.map((spec) => spec.hook),
};

export function isHouseStrategyTemplate(value: string): value is HouseStrategyTemplateId {
  return (HOUSE_STRATEGY_TEMPLATE_IDS as readonly string[]).includes(value);
}

export type HouseRecipeInput = {
  underlyingSymbol: string;
  initialCapitalUsd?: string | number;
  /** Covered Call only: virtual reference shares the calls are written against. */
  referenceShares?: string | number;
  name?: string;
  /** Per-hook parameter overrides; they are validated against the permitted ranges, never trusted. */
  overrides?: Record<string, Record<string, unknown>>;
};

export function buildHouseRecipe(templateId: HouseStrategyTemplateId, input: HouseRecipeInput): RecipeV1 {
  const spec = HOUSE_SPECS[templateId];
  const symbol = input.underlyingSymbol.trim().toUpperCase();
  const parameters: Record<string, unknown> = {
    initialCapitalUsd: String(input.initialCapitalUsd ?? spec.capital.default),
  };
  for (const extra of spec.extraTopLevel) {
    parameters[extra.key] = String((extra.key === "referenceShares" ? input.referenceShares : undefined) ?? extra.default);
  }
  for (const hookSpec of spec.hooks) {
    parameters[hookSpec.hook] = { ...hookSpec.defaults, ...(input.overrides?.[hookSpec.hook] ?? {}) };
  }
  parameters.paperModel = { ...spec.paperModel };
  return RecipeV1Schema.parse({
    version: 1,
    name: input.name?.trim() || `${spec.name} ${symbol}`,
    templateId,
    underlyingSymbol: symbol,
    hookIds: spec.hooks.map((hookSpec) => hookSpec.hook),
    parameters,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOf(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Key-order independent: jsonb storage does not preserve object key order. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/** Closed-specification check for one House Agent recipe. Returns an empty list when the recipe is exactly in spec. */
export function validateHouseRecipe(recipe: RecipeV1, templateId: HouseStrategyTemplateId): RecipeValidationIssue[] {
  const spec = HOUSE_SPECS[templateId];
  const issues: RecipeValidationIssue[] = [];
  const bad = (message: string, hookId?: string): void => {
    issues.push({ code: "INVALID_PARAMETER", message, ...(hookId ? { hookId } : {}) });
  };

  const expectedHooks = spec.hooks.map((hookSpec) => hookSpec.hook);
  for (const hookId of expectedHooks) {
    if (!recipe.hookIds.includes(hookId)) issues.push({ code: "MISSING_REQUIRED_HOOK", hookId, message: `${spec.name} requires ${hookId}.` });
  }
  for (const hookId of recipe.hookIds) {
    if (!expectedHooks.includes(hookId)) issues.push({ code: "INVALID_COMPOSITION", hookId, message: `${hookId} is not part of the supported ${spec.name} evaluator.` });
  }

  const parameters = recipe.parameters;
  const capital = numberOf(parameters.initialCapitalUsd);
  if (capital === null || capital < spec.capital.min || capital > spec.capital.max) {
    bad(`${spec.name} paper capital must be between $${spec.capital.min} and $${spec.capital.max}.`);
  }
  for (const extra of spec.extraTopLevel) {
    const value = numberOf(parameters[extra.key]);
    if (value === null || value < extra.min || value > extra.max || (extra.integer && !Number.isInteger(value))) {
      bad(`${extra.key} must be ${extra.integer ? "a whole number" : "a number"} from ${extra.min} to ${extra.max}.`);
    }
  }
  const allowedTop = new Set(["initialCapitalUsd", "paperModel", ...spec.extraTopLevel.map((extra) => extra.key), ...expectedHooks]);
  for (const key of Object.keys(parameters)) {
    if (!allowedTop.has(key)) bad(`Unsupported recipe parameter ${key}.`);
  }
  if (!deepEqual(record(parameters.paperModel), spec.paperModel)) {
    bad(`${spec.name} must use the documented RV30 × 1.1 Black–Scholes model with 50 bp slippage and disclosed excluded venue fees.`, "venux");
  }

  for (const hookSpec of spec.hooks) {
    const values = record(parameters[hookSpec.hook]);
    if (!values) {
      bad(`${hookSpec.hook} parameters are missing.`, hookSpec.hook);
      continue;
    }
    const allowedKeys = new Set(hookSpec.rules.map((rule) => rule.key));
    for (const key of Object.keys(values)) {
      if (!allowedKeys.has(key)) bad(`${hookSpec.hook}.${key} is not a supported parameter.`, hookSpec.hook);
    }
    for (const rule of hookSpec.rules) {
      const value = values[rule.key];
      if (rule.kind === "fixed") {
        if (!deepEqual(value, rule.value)) bad(`${hookSpec.hook}.${rule.key} is fixed at ${JSON.stringify(rule.value)} for ${spec.name}.`, hookSpec.hook);
      } else if (rule.kind === "enum") {
        if (!rule.values.some((candidate) => deepEqual(candidate, value))) bad(`${hookSpec.hook}.${rule.key} must be one of ${rule.values.join(", ")}.`, hookSpec.hook);
      } else {
        const number = typeof value === "number" ? value : null;
        if (number === null || !Number.isFinite(number) || number < rule.min || number > rule.max || (rule.integer && !Number.isInteger(number))) {
          bad(`${hookSpec.hook}.${rule.key} must be ${rule.integer ? "a whole number" : "a number"} from ${rule.min} to ${rule.max}.`, hookSpec.hook);
        }
      }
    }
  }

  const trendix = record(parameters.trendix);
  if (trendix && typeof trendix.fast === "number" && typeof trendix.slow === "number" && trendix.fast >= trendix.slow) {
    bad("Trendix needs a fast average shorter than the slow average.", "trendix");
  }
  const tenora = record(parameters.tenora);
  if (tenora && typeof tenora.minDTE === "number" && typeof tenora.targetDTE === "number" && tenora.minDTE > tenora.targetDTE) {
    bad("Tenora minDTE cannot exceed targetDTE.", "tenora");
  }
  const kelvo = record(parameters.kelvo);
  if (kelvo && typeof kelvo.minScale === "number" && typeof kelvo.maxScale === "number" && kelvo.minScale > kelvo.maxScale) {
    bad("Kelvo minScale cannot exceed maxScale.", "kelvo");
  }
  return issues;
}
