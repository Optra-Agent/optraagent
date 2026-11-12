import { HookCatalogResponseSchema, HouseAgentTemplateCatalogResponseSchema, RecipeV1Schema } from "../domain/contracts";
import type { HookCatalogResponse, HouseAgentTemplateCatalogResponse, RecipeV1 } from "../domain/contracts";

type HookRow = HookCatalogResponse["definitions"][number];

const rows: HookRow[] = [
  { id: "volra", name: "Volra", stage: "gate", availability: "catalog_only", summary: "Filter entries by recorded option implied-volatility rank or absolute IV.", unavailableReason: "No recorded option IV source or historical IV series is configured.", parameters: { metric: { type: "enum", values: ["ivRank", "ivAbs"], default: "ivRank" }, op: { type: "enum", values: ["above", "below"], default: "above" }, threshold: { type: "number", default: 50, min: 0, max: 100, unit: "ivRank points" } } },
  { id: "trendix", name: "Trendix", stage: "gate", availability: "catalog_only", summary: "Require a fast/slow moving-average trend in the selected direction.", unavailableReason: "The selected Protective Put recipe does not use this rule.", parameters: { timeframe: { type: "enum", values: ["1h", "1d"], default: "1d" }, fast: { type: "integer", default: 20, min: 5, max: 100 }, slow: { type: "integer", default: 50, min: 10, max: 200 }, direction: { type: "enum", values: ["bullish", "bearish"], default: "bullish" } } },
  { id: "earnex", name: "Earnex", stage: "gate", availability: "catalog_only", summary: "Block or allow entries around reported earnings dates.", unavailableReason: "No verified earnings calendar is configured.", parameters: { mode: { type: "enum", values: ["block", "only"], default: "block" }, daysBefore: { type: "integer", default: 2, min: 0, max: 10 }, daysAfter: { type: "integer", default: 1, min: 0, max: 5 } } },
  { id: "gapro", name: "Gapro", stage: "gate", availability: "catalog_only", summary: "Detect price gaps after an equity trading-session break.", unavailableReason: "Session gap semantics are not implemented in the selected model.", parameters: { minGapPct: { type: "number", default: 2, min: 0.5, max: 10, unit: "%" }, direction: { type: "enum", values: ["up", "down", "any"], default: "any" }, action: { type: "enum", values: ["requireGap", "blockOnGap"], default: "blockOnGap" }, validHours: { type: "integer", default: 2, min: 1, max: 8 } } },
  { id: "rangel", name: "Rangel", stage: "gate", availability: "catalog_only", summary: "Require the underlying price to be inside an absolute or SMA band.", unavailableReason: "Not part of the selected paper recipe.", parameters: { mode: { type: "enum", values: ["absolute", "bandAroundSMA"], default: "bandAroundSMA" }, bandPct: { type: "number", default: 5, min: 1, max: 30, unit: "%" } } },
  { id: "momira", name: "Momira", stage: "gate", availability: "catalog_only", summary: "Filter entries by RSI or a percentage move over a lookback.", unavailableReason: "Not part of the selected paper recipe.", parameters: { mode: { type: "enum", values: ["rsi", "change"], default: "rsi" }, op: { type: "enum", values: ["above", "below"], default: "above" }, level: { type: "number", default: 50, min: 5, max: 95 }, pct: { type: "number", default: 2, min: -20, max: 20, unit: "%" }, hours: { type: "integer", default: 24, min: 1, max: 168 } } },
  { id: "skewr", name: "Skewr", stage: "gate", availability: "catalog_only", summary: "Compare equivalent out-of-the-money put and call IV or premium.", unavailableReason: "Requires paired put and call venue quotes.", parameters: { measure: { type: "enum", values: ["ivSkew", "premiumRatio"], default: "ivSkew" }, op: { type: "enum", values: ["above", "below"], default: "below" }, threshold: { type: "number", default: 5, min: -30, max: 30, unit: "volatility points" } } },
  { id: "calmo", name: "Calmo", stage: "gate", availability: "implemented", summary: "Allow entries when realized volatility is calm and recent hourly moves stay bounded.", implementationNote: "Uses only prior finalized hourly candles; RV24/RV30 and the maximum absolute hourly close return are deterministic.", parameters: { rvRatioMax: { type: "number", default: 1.2, min: 0.5, max: 3 }, maxHourlyMovePct: { type: "number", default: 3, min: 0.5, max: 10, unit: "%" }, rvFastHours: { type: "integer", default: 24 }, rvSlowHours: { type: "integer", default: 720 } } },
  { id: "corpax", name: "Corpax", stage: "gate", availability: "implemented", summary: "Block entries around known Robinhood Stock Token multiplier/corporate-action changes.", implementationNote: "Consumes Robinhood's corporate-action feed; historical windows with an unresolvable multiplier transition fail closed.", parameters: { pauseHoursBefore: { type: "integer", default: 24, min: 0, max: 72 }, pauseHoursAfter: { type: "integer", default: 24, min: 0, max: 72 }, flagOpenPositions: { type: "boolean", default: true } } },
  { id: "sessia", name: "Sessia", stage: "gate", availability: "implemented", summary: "Allow entries only during regular US equity hours on open market days.", implementationNote: "Uses the America/New_York timezone, daylight-saving transitions, standard US equity holidays, and configured early closes; exits are not gated by this entry rule.", parameters: { sessions: { type: "array", values: ["openingBell", "regular", "closingBell", "extended", "overnight", "weekend"], default: ["regular"] }, appliesTo: { type: "enum", values: ["entries", "all"], default: "entries" } } },

  { id: "deltra", name: "Deltra", stage: "strike", availability: "catalog_only", summary: "Select the available strike nearest a target option delta.", unavailableReason: "Requires a venue chain or recorded option quotes and Greeks.", parameters: { type: { type: "enum", values: ["call", "put"] }, side: { type: "enum", values: ["buy", "sell"] }, targetDelta: { type: "number", default: 0.25, min: 0.05, max: 0.95 }, tolerance: { type: "number", default: 0.05 } } },
  { id: "percy", name: "Percy", stage: "strike", availability: "implemented", summary: "Set a theoretical strike at a configured percentage from the underlying share price.", implementationNote: "In the modeled workflow only: strike is theoretical, rounded to the configured $0.01 model precision, and is not asserted to be listed by a venue.", parameters: { type: { type: "enum", values: ["call", "put"] }, side: { type: "enum", values: ["buy", "sell"] }, otmPct: { type: "number", default: 5, min: -20, max: 30, unit: "%" }, rounding: { type: "enum", values: ["nearest", "up", "down"], default: "nearest" } } },
  { id: "tenora", name: "Tenora", stage: "strike", availability: "implemented", summary: "Choose a deterministic model expiry using the requested cycle and DTE.", implementationNote: "The paper model uses exact calendar-day tenor; it is not a promise that a venue lists that expiry.", parameters: { cycle: { type: "enum", values: ["daily", "weekly", "monthly"], default: "weekly" }, targetDTE: { type: "integer", default: 7, min: 1, max: 45, unit: "calendar days" }, minDTE: { type: "integer", default: 2, min: 0, max: 30 } } },
  { id: "premo", name: "Premo", stage: "strike", availability: "catalog_only", summary: "Reject option candidates below a minimum premium.", unavailableReason: "Not part of the selected recipe; recorded/model premium filtering is not generalized.", parameters: { minPremiumPct: { type: "number", default: 0.8, min: 0.1, max: 10, unit: "% of spot" }, minPremiumUsd: { type: "number", optional: true } } },
  { id: "spreadix", name: "Spreadix", stage: "strike", availability: "catalog_only", summary: "Build a defined-risk bull-call or bear-put vertical spread.", unavailableReason: "Multi-leg option pricing and venue sell-leg support are unverified.", parameters: { kind: { type: "enum", values: ["bullCall", "bearPut"] }, longLegOtmPct: { type: "number", default: 0 }, widthPct: { type: "number", default: 5, min: 1, max: 20 }, maxDebitPct: { type: "number", default: 40 } } },
  { id: "strangl", name: "Strangl", stage: "strike", availability: "catalog_only", summary: "Build a long straddle or strangle.", unavailableReason: "The selected paper path does not model two option legs.", parameters: { kind: { type: "enum", values: ["straddle", "strangle"], default: "straddle" }, otmPct: { type: "number", default: 5, min: 0, max: 30 } } },
  { id: "collara", name: "Collara", stage: "strike", availability: "catalog_only", summary: "Pair a protective put with a covered call.", unavailableReason: "Requires verified covered-call support and token holdings.", parameters: { putOtmPct: { type: "number", default: 5, min: 1, max: 20 }, callOtmPct: { type: "number", default: 7, min: 1, max: 30 }, targetNetCost: { type: "number", default: 0 } } },

  { id: "capra", name: "Capra", stage: "size", availability: "implemented", summary: "Cap option premium spend and concurrent positions against the configured paper allocation.", implementationNote: "Protective Put uses the PM recipe's 2% of reference-holding value and one open position.", parameters: { maxPctPerPosition: { type: "number", default: 10, min: 1, max: 50 }, maxOpenPositions: { type: "integer", default: 3, min: 1, max: 10 } } },
  { id: "kelvo", name: "Kelvo", stage: "size", availability: "catalog_only", summary: "Scale position size inversely with 30-day realized volatility.", unavailableReason: "Not part of the selected House Agent recipe.", parameters: { targetVol: { type: "number", default: 40, min: 10, max: 150, unit: "% annualized" }, minScale: { type: "number", default: 0.25 }, maxScale: { type: "number", default: 1 } } },
  { id: "laddr", name: "Laddr", stage: "size", availability: "catalog_only", summary: "Split an entry into separately gated tranches.", unavailableReason: "Tranche scheduling is not implemented.", parameters: { tranches: { type: "integer", default: 3, min: 2, max: 5 }, by: { type: "enum", values: ["time", "strike"], default: "time" }, everyHours: { type: "integer", default: 24, min: 1, max: 168 }, strikeStepPct: { type: "number", default: 2.5 } } },
  { id: "coverix", name: "Coverix", stage: "size", availability: "implemented", summary: "Size a Protective Put against explicit paper reference shares.", implementationNote: "Uses user-configured virtual shares for simulation; no wallet balance or token lock is asserted.", parameters: { coveragePct: { type: "number", default: 100, min: 10, max: 100 }, lockTokens: { type: "boolean", default: true } } },

  { id: "profira", name: "Profira", stage: "pulse", availability: "catalog_only", summary: "Close a position after a configured premium gain or capture threshold.", unavailableReason: "Not used by the selected long-put recipe.", parameters: { gainPct: { type: "number", default: 50, min: 10, max: 300 }, capturePct: { type: "number", default: 50, min: 10, max: 95 } } },
  { id: "stopra", name: "Stopra", stage: "pulse", availability: "catalog_only", summary: "Close a position at a premium- or underlying-based loss threshold.", unavailableReason: "Not used by the selected House Agent recipe.", parameters: { basis: { type: "enum", values: ["premium", "underlying"], default: "premium" }, lossPct: { type: "number", default: 50, min: 10, max: 100 }, premiumMultiple: { type: "number", default: 2, min: 1.2, max: 5 }, movePct: { type: "number", default: 5 } } },
  { id: "trailo", name: "Trailo", stage: "pulse", availability: "implemented", summary: "Arm a trailing exit after the modeled put doubles, then protect 30% from its peak.", implementationNote: "Marks use the same deterministic Black–Scholes model as entry/backtest, with the recorded underlying history and entry assumptions.", parameters: { activateAtGainPct: { type: "number", default: 30, min: 5, max: 200 }, trailPct: { type: "number", default: 20, min: 5, max: 50 } } },
  { id: "rolla", name: "Rolla", stage: "pulse", availability: "catalog_only", summary: "Close and re-open a position under a new expiry/strike after a configured trigger.", unavailableReason: "Multi-order roll sequencing is not implemented.", parameters: { trigger: { type: "enum", values: ["delta", "distancePct", "dte"], default: "distancePct" }, distancePct: { type: "number", default: 1, min: 0, max: 10 }, dte: { type: "integer", default: 2 }, maxRolls: { type: "integer", default: 3, min: 0, max: 10 }, requireNetCredit: { type: "boolean", default: true } } },
  { id: "thetix", name: "Thetix", stage: "pulse", availability: "catalog_only", summary: "Close a short-premium position after time decay thresholds are met.", unavailableReason: "The selected House Agent buys puts; short-premium management is unsupported.", parameters: { minCapturedPct: { type: "number", default: 60, min: 20, max: 95 }, minTimeElapsedPct: { type: "number", default: 50, min: 10, max: 95 } } },
  { id: "hedgra", name: "Hedgra", stage: "pulse", availability: "catalog_only", summary: "Hedge option delta with a stock-token spot leg or a put.", unavailableReason: "No verified spot execution adapter is configured.", parameters: { maxDeltaUsdPer1Pct: { type: "number", default: 5, min: 1 }, hedgeWith: { type: "enum", values: ["spot", "put"], default: "spot" }, hedgeRatio: { type: "number", default: 50, min: 10, max: 100 } } },
  { id: "rescu", name: "Rescu", stage: "pulse", availability: "catalog_only", summary: "Rescue pressured short options through a credit roll or close.", unavailableReason: "The selected House Agent buys puts and does not support short-leg rolls.", parameters: { itmPct: { type: "number", default: 2, min: 0, max: 20 }, action: { type: "enum", values: ["rollOutAndAway", "close"], default: "rollOutAndAway" }, maxRescues: { type: "integer", default: 1, min: 0, max: 3 }, requireNetCredit: { type: "boolean", default: true } } },

  { id: "settla", name: "Settla", stage: "expiry", availability: "catalog_only", summary: "Hold a safely out-of-the-money option through expiry.", unavailableReason: "Expiry settlement rules for an options venue are not verified.", parameters: { otmBufferPct: { type: "number", default: 2, min: 0.5, max: 10 }, checkHoursBefore: { type: "integer", default: 6, min: 1, max: 24 } } },
  { id: "nextra", name: "Nextra", stage: "expiry", availability: "implemented", summary: "Open the next modeled protection cycle after the prior cycle closes.", implementationNote: "The paper model uses its configured calendar-day expiry; next-cycle entries still honor Breakers and available model inputs.", parameters: { when: { type: "enum", values: ["afterSettle", "hoursBefore"], default: "afterSettle" }, hoursBefore: { type: "integer", default: 24 }, respectGate: { type: "boolean", default: true } } },
  { id: "lastra", name: "Lastra", stage: "expiry", availability: "implemented", summary: "Close the modeled option 24 hours before its configured expiry.", implementationNote: "Exit processing is independent of entry gates; the model does not assert venue settlement behavior.", parameters: { hoursBefore: { type: "integer", default: 4, min: 1, max: 48 } } },

  { id: "haltr", name: "Haltr", stage: "breaker", availability: "implemented", summary: "Block new entries on missing/stale/halted prices or an excessive hourly move.", implementationNote: "Uses finalized hourly share-price candles and the current Robinhood quote; exits remain eligible when entries are blocked.", parameters: { maxMove1hPct: { type: "number", default: 7, min: 2, max: 20 }, ivSpikePct: { type: "number", default: 50, min: 10, max: 200 }, cooldownHours: { type: "integer", default: 6, min: 1, max: 48 } } },
  { id: "daylo", name: "Daylo", stage: "breaker", availability: "implemented", summary: "Stop new entries for the UTC day after a 3% realized-plus-marked loss.", implementationNote: "Daily loss includes modeled open-option mark-to-market and realized paper PnL.", parameters: { maxDailyLossPct: { type: "number", default: 3, min: 0.5, max: 20 } } },
  { id: "drawra", name: "Drawra", stage: "breaker", availability: "implemented", summary: "Stop new entries after 20% drawdown from peak paper equity.", implementationNote: "Existing positions continue to be managed for exits after the entry state is stopped.", parameters: { maxDrawdownPct: { type: "number", default: 20, min: 5, max: 50 }, onTrip: { type: "enum", values: ["stopEntries", "closeAll"], default: "stopEntries" } } },
  { id: "exposa", name: "Exposa", stage: "breaker", availability: "implemented", summary: "Block entries when configured reference-underlying exposure exceeds the book cap.", implementationNote: "Counts the user-configured paper reference holding; no live wallet/manual book balances are included.", parameters: { maxUnderlyingPct: { type: "number", default: 25, min: 5, max: 100 }, maxDeltaUsdPer1Pct: { type: "number", optional: true } } },
  { id: "venux", name: "Venux", stage: "breaker", availability: "implemented", summary: "Require healthy underlying data and a valid premium model before paper entry.", implementationNote: "This paper-only path has no venue option quote, so venue spread/error-rate checks are unavailable and disclosed; it does not mark the model as a venue quote.", parameters: { maxQuoteAgeMin: { type: "integer", default: 10, min: 1, max: 60 }, maxSpreadPct: { type: "number", default: 15, min: 2, max: 50 }, maxModelDevPct: { type: "number", default: 25, min: 5, max: 100 }, maxErrorRate: { type: "number", default: 20, min: 0, max: 100 }, allowModeledPremium: { type: "boolean", default: true } } },
];

const catalog: HookCatalogResponse = HookCatalogResponseSchema.parse({
  coverage: {
    sourceStatus: "available",
    expectedCount: 36,
    registeredCount: rows.length,
    expectedByStage: { gate: 10, strike: 7, size: 4, pulse: 7, expiry: 3, breaker: 5 },
  },
  definitions: rows,
});

export function getHookCatalog(): HookCatalogResponse {
  return catalog;
}

const houseAgentTemplates: HouseAgentTemplateCatalogResponse = HouseAgentTemplateCatalogResponseSchema.parse({
  templates: [
    { id: "covered_call", name: "Covered Call", availability: "preview", reason: "Venue short-option support, recorded IV/quotes, and verified wallet coverage are unavailable." },
    { id: "cash_secured_put", name: "Cash-Secured Put", availability: "preview", reason: "Venue short-option support, recorded IV, verified earnings data, and cash-collateral semantics are unavailable." },
    { id: "protective_put", name: "Protective Put", availability: "paper_ready", reason: "Paper-only Black–Scholes premiums use recorded Robinhood Chain share-price history and an explicit RV30 proxy; no venue quote or live execution is represented." },
    { id: "earnings_straddle", name: "Earnings Straddle", availability: "preview", reason: "A verified earnings calendar and independently modeled two-leg option structure are unavailable." },
  ],
});

export function getHouseAgentTemplates(): HouseAgentTemplateCatalogResponse {
  return houseAgentTemplates;
}

const protectivePutHookIds = [
  "calmo", "corpax", "sessia", "percy", "tenora", "coverix", "capra", "trailo", "lastra", "nextra",
  "haltr", "daylo", "drawra", "exposa", "venux",
] as const;

export type ProtectivePutRecipeInput = {
  underlyingSymbol: string;
  protectedShares: string;
  initialCapitalUsd: string;
  name?: string;
};

export function buildProtectivePutRecipe(input: ProtectivePutRecipeInput): RecipeV1 {
  const recipe = {
    version: 1 as const,
    name: input.name?.trim() || `Protective Put ${input.underlyingSymbol}`,
    templateId: "protective_put" as const,
    underlyingSymbol: input.underlyingSymbol.trim().toUpperCase(),
    hookIds: [...protectivePutHookIds],
    parameters: {
      protectedShares: input.protectedShares,
      initialCapitalUsd: input.initialCapitalUsd,
      calmo: { rvRatioMax: 1.2, maxHourlyMovePct: 3, rvFastHours: 24, rvSlowHours: 720 },
      corpax: { pauseHoursBefore: 24, pauseHoursAfter: 24, flagOpenPositions: true },
      sessia: { sessions: ["regular"], appliesTo: "entries" },
      percy: { type: "put", side: "buy", otmPct: 7, rounding: "nearest", strikeIncrementUsd: 0.01 },
      tenora: { cycle: "monthly", targetDTE: 30, minDTE: 10, expiryConvention: "calendar_days" },
      coverix: { coveragePct: 100, lockTokens: false },
      capra: { maxPremiumPctHolding: 2, maxOpenPositions: 1 },
      trailo: { activateAtGainPct: 100, trailPct: 30 },
      lastra: { hoursBefore: 24 },
      nextra: { when: "hoursBefore", hoursBefore: 24, respectGate: false },
      haltr: { maxMove1hPct: 7, ivSpikePct: 50, cooldownHours: 6 },
      daylo: { maxDailyLossPct: 3 },
      drawra: { maxDrawdownPct: 20, onTrip: "stopEntries" },
      exposa: { maxUnderlyingPct: 25 },
      venux: { maxQuoteAgeMin: 10, maxSpreadPct: 15, maxModelDevPct: 25, maxErrorRate: 20, allowModeledPremium: true },
      paperModel: {
        model: "black_scholes_european_put",
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
      },
    },
  };
  return RecipeV1Schema.parse(recipe);
}

export const PAPER_PROTECTIVE_PUT_HOOK_IDS: readonly string[] = protectivePutHookIds;
