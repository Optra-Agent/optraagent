import { buildProtectivePutRecipe, getHookCatalog, getHouseAgentTemplates, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import type { HookStage } from "../../lib/domain/contracts";
import { STAGE_ORDER, STAGE_QUESTION, stageLabel } from "./data";
import { templateSummaries } from "../app/agents/TemplateCard";
import type { FlowScenario, Verdict } from "./graph-flow";

/* Data for the Optra Agent Intelligence Graph. Everything here is derived from the same registries the API serves:
   the hook catalog, the House Agent template catalog and the Protective Put recipe builder. Nothing is invented
   except the clearly labeled illustrative evaluation outputs, whose wording is copied from the engine. */

export type HookExample = { status: Verdict; reason: string; value?: string; threshold?: string; unit?: string };

export type GraphHook = {
  id: string;
  name: string;
  stage: HookStage;
  summary: string;
  note?: string;
  params: { key: string; value: string }[];
  example: HookExample;
};

export type GraphStage = { stage: HookStage; label: string; question: string; hooks: GraphHook[]; live: number; total: number };

export type GraphAgent = {
  id: "protective_put" | "covered_call" | "cash_secured_put" | "earnings_straddle";
  name: string;
  ready: boolean;
  summary: string;
  reason: string;
};

/** What each hook returns on a typical pass. Reason text is the engine's own string (lib/engine/run-tick.ts);
 *  threshold is read from the recipe. Observed values are examples only and are labeled as such in the UI. */
const EXAMPLE_TEXT: Record<string, { status: Verdict; reason: string; value?: string; unit?: string }> = {
  calmo: { status: "pass", reason: "RVfast/RV30 is calm and the latest hourly price change is bounded.", value: "0.94", unit: "RV ratio" },
  corpax: { status: "pass", reason: "No known corporate action is inside the configured pause window.", value: "none", unit: "hours" },
  sessia: { status: "pass", reason: "Entry timestamp falls inside the regular US equity session.", unit: "local market time" },
  percy: { status: "select", reason: "Selected the configured theoretical out-of-the-money put strike; this is not a listed venue contract.", unit: "% OTM" },
  tenora: { status: "select", reason: "Selected exact calendar-day model tenor; no exchange expiry calendar was inferred.", value: "30", unit: "calendar days" },
  coverix: { status: "size", reason: "Configured virtual reference shares determine one-share model units; no wallet balance is read or locked.", unit: "% coverage" },
  capra: { status: "size", reason: "Option-unit quantity fits the reference-holding premium cap, virtual coverage, one-position limit, and paper cash.", unit: "% of holding" },
  trailo: { status: "noop", reason: "No open model position exists to trail." },
  lastra: { status: "noop", reason: "No open model position exists to close before expiry." },
  nextra: { status: "pass", reason: "A new modeled protection cycle may be considered; all Gates and Breakers are still evaluated." },
  haltr: { status: "pass", reason: "Current quote/candle is fresh, not halted, and the prior-hour move is within the configured bound.", value: "0.8", unit: "%" },
  daylo: { status: "pass", reason: "Daily realized and marked paper loss is below the configured limit.", value: "0", unit: "%" },
  drawra: { status: "pass", reason: "Paper equity drawdown is below the configured limit.", value: "0", unit: "%" },
  exposa: { status: "pass", reason: "Configured reference-share notional is within the paper capital exposure cap.", value: "12", unit: "%" },
  venux: { status: "pass", reason: "Underlying data and the disclosed premium model are available; no option venue quote or fee schedule is represented.", value: "modeled" },
};

/** The threshold shown beside the example comes from the recipe, so it cannot drift from the real defaults. */
const THRESHOLD_KEY: Record<string, string> = {
  calmo: "rvRatioMax", percy: "otmPct", tenora: "minDTE", coverix: "coveragePct", capra: "maxPremiumPctHolding",
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
};

export function getGraphData(): GraphData {
  const catalog = getHookCatalog();
  const templates = getHouseAgentTemplates().templates;
  const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const parameters = recipe.parameters as Record<string, unknown>;

  const toHook = (id: string): GraphHook => {
    const definition = catalog.definitions.find((hook) => hook.id === id);
    if (!definition) throw new Error(`Hook ${id} is missing from the catalog.`);
    const recipeParams = (parameters[id] ?? {}) as Record<string, unknown>;
    const example = EXAMPLE_TEXT[id] ?? { status: "pass" as Verdict, reason: definition.summary };
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
    const used = PAPER_PROTECTIVE_PUT_HOOK_IDS.filter((id) => catalog.definitions.find((hook) => hook.id === id)?.stage === stage);
    return { stage, label: stageLabel(stage), question: STAGE_QUESTION[stage], hooks: used.map(toHook), live: all.filter((hook) => hook.availability === "implemented").length, total: all.length };
  };

  const order = (id: string) => ["gate", "strike", "size", "pulse", "expiry"].indexOf(id);
  const stages = STAGE_ORDER.filter((stage) => stage !== "breaker").sort((a, b) => order(a) - order(b)).map(stageOf);
  const sm = (id: GraphAgent["id"]) => templates.find((template) => template.id === id);
  const agentRow = (id: GraphAgent["id"]): GraphAgent => {
    const template = sm(id);
    if (!template) throw new Error(`Template ${id} is missing from the catalog.`);
    return { id, name: template.name, ready: template.availability === "paper_ready", summary: templateSummaries[id], reason: template.reason };
  };

  return {
    agents: (["protective_put", "covered_call", "cash_secured_put", "earnings_straddle"] as const).map(agentRow),
    stages,
    breaker: stageOf("breaker"),
    hookTotal: catalog.definitions.length,
    hookLive: catalog.definitions.filter((hook) => hook.availability === "implemented").length,
    scenarios: illustrativeScenarios(),
    ticks: illustrativeTicks(),
  };
}


function passes(): Record<string, { status: Verdict; reason: string }> {
  return Object.fromEntries(Object.entries(EXAMPLE_TEXT).map(([id, example]) => [id, { status: example.status, reason: example.reason }]));
}

/** Two deterministic educational examples. Reasons are the engine's own strings. No prices, no PnL. */
function illustrativeScenarios(): FlowScenario[] {
  const base = passes();
  return [
    {
      id: "blocked",
      label: "Entry blocked",
      source: "illustrative",
      verdicts: { ...base, calmo: { status: "block", reason: "Calmo requires valid RVfast/RV30, the configured calm ratio, and a bounded hourly move." } },
      action: "skip",
      reason: "Entry blocked by calmo.",
    },
    {
      id: "open",
      label: "Entry opens",
      source: "illustrative",
      verdicts: base,
      action: "open",
      reason: "Opened modeled one-share Protective Put units for paper execution.",
    },
  ];
}

function illustrativeTicks(): FlowScenario[] {
  const [blocked, open] = illustrativeScenarios() as [FlowScenario, FlowScenario];
  const base = passes();
  const outside: FlowScenario = {
    id: "outside-session",
    label: "Outside regular hours",
    source: "illustrative",
    verdicts: { ...base, sessia: { status: "block", reason: "Entries are restricted to regular US equity hours and the market is closed." } },
    action: "skip",
    reason: "Entry blocked by sessia.",
  };
  return [outside, blocked, open];
}
