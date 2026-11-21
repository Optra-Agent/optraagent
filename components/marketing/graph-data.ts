import { buildProtectivePutRecipe, getHookCatalog, getHouseAgentTemplates, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import { buildHouseRecipe, HOUSE_STRATEGY_HOOK_IDS } from "../../lib/hooks/house-specs";
import type { HookStage } from "../../lib/domain/contracts";
import { STAGE_ORDER, STAGE_QUESTION, stageLabel } from "./data";
import { templateSummaries } from "../app/agents/TemplateCard";
import type { FlowScenario, Verdict } from "./graph-flow";

/* Data for the Optra Agent Intelligence Graph. Everything here is derived from the same registries the API serves:
   the hook catalog, the House Agent template catalog and the Protective Put recipe builder. Nothing is invented
   except the clearly labeled illustrative evaluation text, whose wording is copied from the engine. */

export type HookExample = { status: Verdict; reason: string; threshold?: string; unit?: string };

export type GraphHook = {
  id: string;
  name: string;
  stage: HookStage;
  summary: string;
  note?: string;
  params: { key: string; value: string }[];
  example: HookExample;
};

export type LockedHook = { id: string; name: string; reason: string };
export type GraphStage = { stage: HookStage; label: string; question: string; hooks: GraphHook[]; locked: LockedHook[]; live: number; total: number };

export type GraphAgent = {
  id: "protective_put" | "covered_call" | "cash_secured_put" | "earnings_straddle";
  name: string;
  ready: boolean;
  summary: string;
  reason: string;
};

/** What each hook returns on a typical pass. Reason text is the engine's own string (lib/engine/run-tick.ts);
 *  threshold is read from the recipe. No observed values are shown. */
const EXAMPLE_TEXT: Record<string, { status: Verdict; reason: string; unit?: string }> = {
  calmo: { status: "pass", reason: "RVfast/RV30 is calm and the latest hourly price change is bounded.", unit: "RV ratio" },
  corpax: { status: "pass", reason: "No known corporate action is inside the configured pause window.", unit: "hours" },
  sessia: { status: "pass", reason: "Entry timestamp falls inside the regular US equity session.", unit: "local market time" },
  percy: { status: "select", reason: "Selected the configured theoretical out-of-the-money put strike; this is not a listed venue contract.", unit: "% OTM" },
  tenora: { status: "select", reason: "Selected exact calendar-day model tenor; no exchange expiry calendar was inferred.", unit: "calendar days" },
  coverix: { status: "size", reason: "Configured virtual reference shares determine one-share model units; no wallet balance is read or locked.", unit: "% coverage" },
  capra: { status: "size", reason: "Option-unit quantity fits the reference-holding premium cap, virtual coverage, one-position limit, and paper cash.", unit: "% of holding" },
  trailo: { status: "noop", reason: "No open model position exists to trail." },
  lastra: { status: "noop", reason: "No open model position exists to close before expiry." },
  nextra: { status: "pass", reason: "A new modeled protection cycle may be considered; all Gates and Breakers are still evaluated." },
  haltr: { status: "pass", reason: "Current quote/candle is fresh, not halted, and the prior-hour move is within the configured bound.", unit: "%" },
  daylo: { status: "pass", reason: "Daily realized and marked paper loss is below the configured limit.", unit: "%" },
  drawra: { status: "pass", reason: "Paper equity drawdown is below the configured limit.", unit: "%" },
  exposa: { status: "pass", reason: "Configured reference-share notional is within the paper capital exposure cap.", unit: "%" },
  venux: { status: "pass", reason: "Underlying data and the disclosed premium model are available; no option venue quote or fee schedule is represented." },
};

/** Wording for the hooks the three strategy agents add. Strings follow the strategy engine's own trace (lib/engine/strategy/run-strategy-tick.ts). */
const STRATEGY_EXAMPLE_TEXT: Record<string, { status: Verdict; reason: string; unit?: string }> = {
  volra: { status: "pass", reason: "Volra ✓ modeled IV rank clears the threshold (realized-vol proxy, not an option-chain IV).", unit: "IV rank" },
  trendix: { status: "pass", reason: "Trendix ✓ price is above the fast and slow daily averages.", unit: "USD vs fast SMA" },
  earnex: { status: "pass", reason: "Earnex ✓ no earnings report falls inside the configured window.", unit: "days" },
  deltra: { status: "select", reason: "Deltra → the weekly put strike whose modeled delta is closest to the target (theoretical, not a listed contract).", unit: "|delta|" },
  premo: { status: "pass", reason: "Premo ✓ the modeled premium clears the minimum percentage of the share price.", unit: "% of spot" },
  profira: { status: "noop", reason: "No open model position has reached its profit target." },
  stopra: { status: "noop", reason: "No open model position has hit its stop." },
  rescu: { status: "noop", reason: "No open short option is in the money by the rescue margin." },
  settla: { status: "noop", reason: "No open model position is inside its settlement window." },
  strangl: { status: "select", reason: "Strangl → long at-the-money straddle, call and put at one strike, modeled implied move shown (theoretical, not a listed contract)." },
  kelvo: { status: "size", reason: "Kelvo scales the size down when realized volatility is above the target.", unit: "size scale" },
};

const AGENT_EXAMPLE_TEXT: Partial<Record<GraphAgent["id"], Record<string, { status: Verdict; reason: string; unit?: string }>>> = {
  covered_call: {
    percy: { status: "select", reason: "Percy → the configured out-of-the-money call strike (theoretical, not a listed contract).", unit: "% OTM" },
    tenora: { status: "select", reason: "Tenora → next weekly expiry at 16:00 New York time that meets the minimum days.", unit: "min DTE" },
    coverix: { status: "size", reason: "Coverix → one-share call units covered by virtual reference shares not already committed to another call.", unit: "% coverage" },
    capra: { status: "size", reason: "Capra ✓ the covered call units fit the position cap.", unit: "% of holding" },
    nextra: { status: "pass", reason: "A new covered-call cycle may open; every Gate and Breaker is evaluated first." },
  },
  cash_secured_put: {
    tenora: { status: "select", reason: "Tenora → next weekly expiry at 16:00 New York time that meets the minimum days.", unit: "min DTE" },
    capra: { status: "size", reason: "Capra ✓ cash-secured units: strike × quantity of virtual USDG is locked, inside the equity cap.", unit: "% of equity" },
    nextra: { status: "pass", reason: "A new cash-secured-put cycle may open; every Gate and Breaker is evaluated first." },
  },
  earnings_straddle: {
    tenora: { status: "select", reason: "Tenora → the first weekly expiry after the earnings report.", unit: "min DTE" },
    capra: { status: "size", reason: "Capra ✓ the combined premium of both legs fits the position cap.", unit: "% of capital" },
    lastra: { status: "noop", reason: "No open straddle is inside its pre-expiry close window." },
  },
};

/** The threshold shown beside the example comes from the recipe, so it cannot drift from the real defaults. */
const THRESHOLD_KEY: Record<string, string> = {
  calmo: "rvRatioMax", percy: "otmPct", tenora: "minDTE", coverix: "coveragePct", capra: "maxPremiumPctHolding",
  volra: "threshold", earnex: "daysBefore", deltra: "targetDelta", premo: "minPremiumPct", profira: "capturePct", stopra: "lossPct", rescu: "itmPct", settla: "otmBufferPct", kelvo: "targetVol",
  haltr: "maxMove1hPct", daylo: "maxDailyLossPct", drawra: "maxDrawdownPct", exposa: "maxUnderlyingPct",
};

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export type GraphData = {
  agents: GraphAgent[];
  stages: GraphStage[];
  breaker: GraphStage;
  hookTotal: number;
  hookLive: number;
  scenarios: FlowScenario[];
  /** Three labeled illustrative ticks for the Tape timeline. */
  ticks: FlowScenario[];
  /** The same graph per House Agent. The top-level fields above are the Protective Put view. */
  byAgent: Record<GraphAgent["id"], AgentView>;
};

export type AgentView = { stages: GraphStage[]; breaker: GraphStage; scenarios: FlowScenario[]; ticks: FlowScenario[]; hookCount: number };

type AgentId = GraphAgent["id"];
const AGENT_IDS = ["protective_put", "covered_call", "cash_secured_put", "earnings_straddle"] as const;

function agentRecipeParameters(id: AgentId): Record<string, unknown> {
  if (id === "protective_put") return buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" }).parameters as Record<string, unknown>;
  return buildHouseRecipe(id, { underlyingSymbol: "AAPL" }).parameters as Record<string, unknown>;
}

function agentHookIds(id: AgentId): readonly string[] {
  return id === "protective_put" ? PAPER_PROTECTIVE_PUT_HOOK_IDS : HOUSE_STRATEGY_HOOK_IDS[id];
}

/** The hook that blocks the illustrative "entry blocked" example for each agent, with the engine-style reason. */
const BLOCKER: Record<AgentId, { hook: string; reason: string }> = {
  protective_put: { hook: "calmo", reason: "Calmo requires valid RVfast/RV30, the configured calm ratio, and a bounded hourly move." },
  covered_call: { hook: "earnex", reason: "Earnex ✗ an earnings report is inside the blocked window (confirmed date)." },
  cash_secured_put: { hook: "trendix", reason: "Trendix ✗ price is below the slow daily average." },
  earnings_straddle: { hook: "earnex", reason: "Earnex ✗ the next earnings report is outside the entry window." },
};
const OPEN_REASON: Record<AgentId, string> = {
  protective_put: "Opened modeled one-share Protective Put units for paper execution.",
  covered_call: "Opened a modeled covered call: sold weekly call units against uncommitted virtual shares.",
  cash_secured_put: "Opened a modeled cash-secured put: sold weekly put units with the strike reserved in virtual USDG.",
  earnings_straddle: "Opened a modeled long straddle before the confirmed earnings report.",
};

export function getGraphData(): GraphData {
  const catalog = getHookCatalog();
  const templates = getHouseAgentTemplates().templates;

  const viewFor = (agent: AgentId): AgentView => {
    const parameters = agentRecipeParameters(agent);
    const ids = agentHookIds(agent);
    const toHook = (id: string): GraphHook => {
      const definition = catalog.definitions.find((hook) => hook.id === id);
      if (!definition) throw new Error(`Hook ${id} is missing from the catalog.`);
      const recipeParams = (parameters[id] ?? {}) as Record<string, unknown>;
      const example = AGENT_EXAMPLE_TEXT[agent]?.[id] ?? STRATEGY_EXAMPLE_TEXT[id] ?? EXAMPLE_TEXT[id] ?? { status: "pass" as Verdict, reason: definition.summary };
      const thresholdKey = THRESHOLD_KEY[id];
      const threshold = thresholdKey !== undefined && recipeParams[thresholdKey] !== undefined ? flatten(recipeParams[thresholdKey]) : undefined;
      return {
        id,
        name: definition.name,
        stage: definition.stage,
        summary: definition.summary,
        ...(definition.implementationNote ? { note: definition.implementationNote } : {}),
        params: Object.entries(recipeParams)
          .filter(([, value]) => typeof value !== "object" || Array.isArray(value))
          .map(([key, value]) => ({ key, value: flatten(value) })),
        example: { ...example, ...(threshold !== undefined ? { threshold } : {}) },
      };
    };
    const stageOf = (stage: HookStage): GraphStage => {
      const all = catalog.definitions.filter((hook) => hook.stage === stage);
      const used = ids.filter((id) => catalog.definitions.find((hook) => hook.id === id)?.stage === stage);
      const locked = all.filter((hook) => hook.availability !== "implemented").map((hook) => ({ id: hook.id, name: hook.name, reason: hook.unavailableReason ?? "No verified evaluator." }));
      return { stage, label: stageLabel(stage), question: STAGE_QUESTION[stage], hooks: used.map(toHook), locked, live: all.filter((hook) => hook.availability === "implemented").length, total: all.length };
    };
    const order = (id: string) => ["gate", "strike", "size", "pulse", "expiry"].indexOf(id);
    const stages = STAGE_ORDER.filter((stage) => stage !== "breaker").sort((a, b) => order(a) - order(b)).map(stageOf);
    const breaker = stageOf("breaker");
    const base = passesFor(agent, [...stages.flatMap((stage) => stage.hooks), ...breaker.hooks]);
    const blocker = BLOCKER[agent];
    const blocked: FlowScenario = { id: "blocked", label: "Entry blocked", source: "illustrative", verdicts: { ...base, [blocker.hook]: { status: "block", reason: blocker.reason } }, action: "skip", reason: `Entry blocked by ${blocker.hook}.` };
    const open: FlowScenario = { id: "open", label: "Entry opens", source: "illustrative", verdicts: base, action: "open", reason: OPEN_REASON[agent] };
    const outside: FlowScenario = { id: "outside-session", label: "Outside regular hours", source: "illustrative", verdicts: { ...base, ...(agent === "protective_put" ? { sessia: { status: "block" as Verdict, reason: "Entries are restricted to regular US equity hours and the market is closed." } } : { venux: { status: "block" as Verdict, reason: "Paper fills happen only in the regular US equity session, and the market is closed." } }) }, action: "skip", reason: agent === "protective_put" ? "Entry blocked by sessia." : "Entry blocked: the market is closed." };
    return { stages, breaker, scenarios: [blocked, open], ticks: [outside, blocked, open], hookCount: ids.length };
  };

  const sm = (id: AgentId) => templates.find((template) => template.id === id);
  const agentRow = (id: AgentId): GraphAgent => {
    const template = sm(id);
    if (!template) throw new Error(`Template ${id} is missing from the catalog.`);
    return { id, name: template.name, ready: template.availability === "paper_ready", summary: templateSummaries[id], reason: template.reason };
  };

  const byAgent = Object.fromEntries(AGENT_IDS.map((id) => [id, viewFor(id)])) as Record<AgentId, AgentView>;
  const primary = byAgent.protective_put;
  return {
    agents: AGENT_IDS.map(agentRow),
    stages: primary.stages,
    breaker: primary.breaker,
    hookTotal: catalog.definitions.length,
    hookLive: catalog.definitions.filter((hook) => hook.availability === "implemented").length,
    scenarios: primary.scenarios,
    ticks: primary.ticks,
    byAgent,
  };
}

function passesFor(_agent: AgentId, hooks: GraphHook[]): Record<string, { status: Verdict; reason: string }> {
  return Object.fromEntries(hooks.map((hook) => [hook.id, { status: hook.example.status, reason: hook.example.reason }]));
}

