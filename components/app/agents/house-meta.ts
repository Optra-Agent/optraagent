import { buildProtectivePutRecipe, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../../lib/hooks/catalog";
import { buildHouseRecipe, HOUSE_STRATEGY_HOOK_IDS } from "../../../lib/hooks/house-specs";
import type { HouseAgentTemplate, RecipeV1 } from "../../../lib/domain/contracts";

export type HouseTemplateId = HouseAgentTemplate["id"];

export const templateSummaries: Record<HouseTemplateId, string> = {
  protective_put: "Buys a put about 7% out of the money, 30 calendar days out, when realized volatility is calm. The premium is the cost of insurance and is lost if the stock does not fall.",
  covered_call: "Sells a weekly call about 5% out of the money against virtual shares you hold, when modeled volatility is rich and no earnings are near. It keeps the premium, gives up upside above the strike, and never sells more calls than it has shares for.",
  cash_secured_put: "Sells a weekly put near 0.25 delta in an uptrend, with the full strike held back as virtual USDG. It keeps the premium, and a drop below the strike turns into a paper loss, never a leveraged one.",
  earnings_straddle: "Buys a call and a put at the same strike before a company-confirmed earnings report, sized small and exited by rule. It profits from a move larger than the premium paid and loses that premium if the stock stays put.",
};

export const strategyLine: Record<HouseTemplateId, string> = {
  protective_put: "Long put · protects shares you hold",
  covered_call: "Short call · against shares you hold",
  cash_secured_put: "Short put · backed by cash",
  earnings_straddle: "Long call and put · around earnings",
};

/** Payoff-at-expiry shapes: the quickest honest way to tell strategies apart. Original vector marks, not mascots. */
export const payoffPath: Record<HouseTemplateId, string> = {
  protective_put: "M4 30 H18 L44 8",
  covered_call: "M4 34 L28 10 H44",
  cash_secured_put: "M4 30 L20 14 H44",
  earnings_straddle: "M4 8 L24 34 L44 8",
};

export type Fact = { label: string; value: string };

function parameter(recipe: RecipeV1, hook: string, key: string): number | string {
  const group = recipe.parameters[hook] as Record<string, number | string> | undefined;
  return group?.[key] ?? "";
}

export function templateFacts(id: HouseTemplateId): Fact[] {
  if (id === "protective_put") {
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
    return [
      { label: "Hooks", value: String(PAPER_PROTECTIVE_PUT_HOOK_IDS.length) },
      { label: "Put strike", value: `${parameter(recipe, "percy", "otmPct")}% OTM` },
      { label: "Tenor", value: `${parameter(recipe, "tenora", "targetDTE")} days` },
    ];
  }
  const recipe = buildHouseRecipe(id, { underlyingSymbol: "AAPL" });
  const hooks = { label: "Hooks", value: String(HOUSE_STRATEGY_HOOK_IDS[id].length) };
  if (id === "covered_call") return [hooks, { label: "Call strike", value: `${parameter(recipe, "percy", "otmPct")}% OTM` }, { label: "Expiry", value: "Weekly" }];
  if (id === "cash_secured_put") return [hooks, { label: "Put delta", value: String(parameter(recipe, "deltra", "targetDelta")) }, { label: "Expiry", value: "Weekly" }];
  return [hooks, { label: "Structure", value: "ATM call + put" }, { label: "Size cap", value: `${parameter(recipe, "capra", "maxPctPerPosition")}% of capital` }];
}

export type Stage = readonly [stage: string, hooks: string, text: string];

export const stageSummaries: Record<HouseTemplateId, readonly Stage[]> = {
  protective_put: [
    ["Gate", "Calmo, Corpax, Sessia", "Enter only in calm volatility, outside corporate actions, in regular hours."],
    ["Strike", "Percy, Tenora", "Buy a put 7% out of the money, about 30 calendar days out."],
    ["Size", "Coverix, Capra", "Cover the reference shares; spend at most 2% of their value on premium."],
    ["Pulse", "Trailo", "Arm a trailing exit once the modeled put doubles."],
    ["Expiry", "Lastra, Nextra", "Close 24 hours before expiry, then open the next cycle."],
    ["Breaker", "Haltr, Daylo, Drawra, Exposa, Venux", "Block new entries on bad data, daily loss, drawdown or exposure."],
  ],
  covered_call: [
    ["Gate", "Volra, Earnex, Corpax", "Enter only when modeled IV rank is at least 50, no earnings fall in the window, and no corporate action is near."],
    ["Strike", "Percy, Tenora", "Sell a call 5% out of the money on the next weekly expiry at least 2 days out."],
    ["Size", "Coverix, Capra", "Write calls only against whole virtual shares not already committed to another call."],
    ["Pulse", "Profira, Rescu", "Buy the call back after capturing half the premium; roll out and away for a net credit if it goes in the money."],
    ["Expiry", "Settla, Nextra", "Hold a safely out-of-the-money call to expiry and settle it, then write the next one."],
    ["Breaker", "Haltr, Daylo, Drawra, Exposa, Venux", "Block new entries on bad data, daily loss, drawdown or exposure."],
  ],
  cash_secured_put: [
    ["Gate", "Volra, Trendix, Earnex, Corpax", "Enter only in a bullish daily trend, with rich modeled IV rank, no earnings in the window, and no corporate action near."],
    ["Strike", "Deltra, Tenora", "Sell the weekly put whose modeled delta is closest to 0.25."],
    ["Size", "Premo, Capra", "Require a minimum premium; lock strike × quantity of virtual USDG, at most 50% of equity per position and two positions."],
    ["Pulse", "Profira, Stopra, Rescu", "Capture half the premium, stop out if the premium doubles, or roll out and down for a net credit."],
    ["Expiry", "Settla, Nextra", "Settle at expiry at intrinsic value, then reopen if the gate allows."],
    ["Breaker", "Haltr, Daylo, Drawra, Exposa, Venux", "Block new entries on bad data, daily loss, drawdown or exposure."],
  ],
  earnings_straddle: [
    ["Gate", "Earnex, Corpax", "Enter only inside the window before a company-confirmed earnings report. An estimated date never opens a trade."],
    ["Strike", "Strangl, Tenora", "Buy an at-the-money call and put on the first weekly expiry after the report."],
    ["Size", "Capra, Kelvo", "Spend at most 5% of capital, scaled down when realized volatility is high."],
    ["Pulse", "Profira, Stopra", "Take profit at a +40% combined gain; stop out at a −50% combined loss."],
    ["Expiry", "Lastra", "Close both legs 24 hours before expiry, or settle them together at expiry."],
    ["Breaker", "Haltr, Daylo, Drawra, Exposa, Venux", "Block new entries on bad data, daily loss, drawdown or exposure."],
  ],
};

export type Tuning = { id: string; label: string; hook: string; key: string; min: number; max: number; step: number; integer?: boolean; hint: string };

/** The user-adjustable inputs per strategy. Every range here mirrors the validator's closed specification. */
export const tuningFields: Record<Exclude<HouseTemplateId, "protective_put">, Tuning[]> = {
  covered_call: [
    { id: "cc-otm", label: "Call strike (% out of the money)", hook: "percy", key: "otmPct", min: 1, max: 20, step: 0.5, hint: "Further out keeps more upside and collects less premium." },
    { id: "cc-capture", label: "Take profit at premium captured (%)", hook: "profira", key: "capturePct", min: 10, max: 95, step: 5, hint: "Buy the call back after this share of its premium has decayed." },
    { id: "cc-volra", label: "Minimum modeled IV rank", hook: "volra", key: "threshold", min: 0, max: 100, step: 5, hint: "Realized-volatility rank proxy, not a listed option IV." },
  ],
  cash_secured_put: [
    { id: "csp-delta", label: "Target put delta", hook: "deltra", key: "targetDelta", min: 0.1, max: 0.4, step: 0.05, hint: "Lower delta sells a put further from the price." },
    { id: "csp-premium", label: "Minimum premium (% of strike)", hook: "premo", key: "minPremiumPct", min: 0.1, max: 5, step: 0.1, hint: "Skip entries that pay less than this." },
    { id: "csp-capture", label: "Take profit at premium captured (%)", hook: "profira", key: "capturePct", min: 10, max: 95, step: 5, hint: "Buy the put back after this share of its premium has decayed." },
  ],
  earnings_straddle: [
    { id: "es-days", label: "Enter up to N days before the report", hook: "earnex", key: "daysBefore", min: 1, max: 10, step: 1, integer: true, hint: "Entry needs a company-confirmed report date." },
    { id: "es-size", label: "Max capital per straddle (%)", hook: "capra", key: "maxPctPerPosition", min: 1, max: 5, step: 1, hint: "Combined premium of both legs is capped at this share." },
    { id: "es-gain", label: "Take profit at combined gain (%)", hook: "profira", key: "gainPct", min: 10, max: 300, step: 10, hint: "Close both legs together." },
    { id: "es-loss", label: "Stop out at combined loss (%)", hook: "stopra", key: "lossPct", min: 10, max: 100, step: 10, hint: "Close both legs together." },
  ],
};

export function tuningDefault(id: Exclude<HouseTemplateId, "protective_put">, field: Tuning): number {
  const recipe = buildHouseRecipe(id, { underlyingSymbol: "AAPL" });
  return Number(parameter(recipe, field.hook, field.key));
}

/** Plain-language model assumptions shown in Lab for the selected draft. */
export const modelAssumptions: Record<HouseTemplateId, string[]> = {
  protective_put: [
    "European Black–Scholes put, volatility = 30-day realized × 1.1.",
    "30 calendar-day tenor, one underlying share per model unit.",
    "50 bp slippage. Options venue fees are not modeled.",
    "No historical option chain, implied volatility or listed-contract guarantee exists in this data.",
  ],
  covered_call: [
    "European Black–Scholes call, volatility = 30-day realized × 1.1; IV rank is a realized-volatility proxy.",
    "Weekly expiries at 16:00 New York time; fills only in the regular session, with 50 bp slippage and no venue fees.",
    "Calls are written only against uncommitted virtual shares. Called-away settlement is modeled at the first close after expiry.",
    "Earnings dates come from Robinhood. A missing calendar blocks entry; no premium is invented.",
  ],
  cash_secured_put: [
    "European Black–Scholes put at the strike whose modeled delta is closest to target; volatility = 30-day realized × 1.1.",
    "Strike × quantity of virtual USDG is locked per position and released only at close or settlement.",
    "Weekly expiries at 16:00 New York time, 50 bp slippage, no venue fees. Assignment is modeled as cash settlement at intrinsic value.",
    "Earnings dates come from Robinhood. A missing calendar blocks entry.",
  ],
  earnings_straddle: [
    "Long Black–Scholes call and put at the same strike; volatility = 30-day realized × 1.1. No earnings IV premium or IV crush is modeled, so entry cost is likely understated.",
    "Trades only a company-confirmed Robinhood earnings date. Estimated dates never open a position.",
    "Both legs are sized, closed and settled together; 50 bp slippage and no venue fees.",
    "A window with no confirmed report produces no trade, and the backtest reports that rather than padding results.",
  ],
};

export const isStrategyTemplate = (id: string): id is Exclude<HouseTemplateId, "protective_put"> => id === "covered_call" || id === "cash_secured_put" || id === "earnings_straddle";
