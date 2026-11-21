import { buildProtectivePutRecipe, getHookCatalog, getHouseAgentTemplates, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import { validateRecipe } from "../../lib/hooks/recipe-validator";
import type { HookDefinition, HookStage } from "../../lib/domain/contracts";
import { getLandingFacts, STAGE_BLURB, STAGE_ORDER, STAGE_QUESTION, stageLabel } from "./data";

/* Server-side data for the interactive section visuals. Every value is read from the hook catalog, the Protective Put
   recipe builder or the real recipe validator, so the page cannot claim more than the registry and engine support. */

/* ───────────── Hook explorer (all 36) ───────────── */

export type ExplorerHook = {
  id: string;
  name: string;
  live: boolean;
  summary: string;
  note: string | null;
  inRecipe: boolean;
  /** The recipe's own one-line meaning of this hook, from the real Protective Put defaults. */
  line: string | null;
  params: { key: string; spec: string }[];
};
export type ExplorerStage = { stage: HookStage; label: string; question: string; blurb: string; live: number; total: number; hooks: ExplorerHook[] };

function paramSpec(raw: unknown): string {
  if (raw === null || typeof raw !== "object") return String(raw);
  const spec = raw as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(spec.values)) parts.push(spec.values.join(" | "));
  else if (typeof spec.type === "string") parts.push(spec.type);
  if (spec.default !== undefined) parts.push(`default ${Array.isArray(spec.default) ? spec.default.join(", ") : String(spec.default)}`);
  if (spec.min !== undefined || spec.max !== undefined) parts.push(`range ${spec.min ?? "…"} to ${spec.max ?? "…"}`);
  if (typeof spec.unit === "string") parts.push(spec.unit);
  return parts.join(" · ");
}

export function getExplorerData(): ExplorerStage[] {
  const catalog = getHookCatalog();
  const lines = new Map(getLandingFacts().recipeStages.flatMap((entry) => entry.hooks.map((hook) => [hook.id, hook.line] as const)));
  return STAGE_ORDER.map((stage) => {
    const hooks = catalog.definitions.filter((hook: HookDefinition) => hook.stage === stage);
    return {
      stage,
      label: stageLabel(stage),
      question: STAGE_QUESTION[stage],
      blurb: STAGE_BLURB[stage],
      live: hooks.filter((hook) => hook.availability === "implemented").length,
      total: hooks.length,
      hooks: [...hooks].sort((a, b) => Number(b.availability === "implemented") - Number(a.availability === "implemented")).map((hook) => ({
        id: hook.id,
        name: hook.name,
        live: hook.availability === "implemented",
        summary: hook.summary,
        note: hook.availability === "implemented" ? hook.implementationNote ?? null : hook.unavailableReason ?? null,
        inRecipe: PAPER_PROTECTIVE_PUT_HOOK_IDS.includes(hook.id),
        line: lines.get(hook.id) ?? null,
        params: Object.entries(hook.parameters).map(([key, raw]) => ({ key, spec: paramSpec(raw) })),
      })),
    };
  });
}

/* ───────────── Forge demo ───────────── */

export type ForgeDemoData = {
  agents: { id: string; name: string; ready: boolean; reason: string }[];
  stages: { stage: HookStage; label: string; question: string; hooks: { id: string; name: string; live: boolean; reason: string; line: string }[] }[];
  required: string[];
  /** Real validator messages when a single required hook is removed from the Protective Put recipe. */
  issuesIfRemoved: Record<string, string[]>;
  /** Real canonical hash of the default recipe with example inputs. */
  validHash: string;
};

export function getForgeDemo(): ForgeDemoData {
  const catalog = getHookCatalog();
  const forgeLines = new Map(getLandingFacts().recipeStages.flatMap((entry) => entry.hooks.map((hook) => [hook.id, hook.line] as const)));
  const required = [...PAPER_PROTECTIVE_PUT_HOOK_IDS];
  const full = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const base = validateRecipe(full);
  if (!base.valid || !base.recipeHash) throw new Error("The default Protective Put recipe must validate.");

  const issuesIfRemoved: Record<string, string[]> = {};
  for (const id of required) {
    const result = validateRecipe({ ...full, hookIds: full.hookIds.filter((hookId) => hookId !== id) });
    issuesIfRemoved[id] = result.issues.map((issue) => issue.message);
  }

  const order = ["protective_put", "covered_call", "cash_secured_put", "earnings_straddle"];
  const agents = [...getHouseAgentTemplates().templates]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((template) => ({ id: template.id, name: template.name, ready: template.availability === "paper_ready", reason: template.reason }));

  return {
    agents,
    required,
    issuesIfRemoved,
    validHash: base.recipeHash,
    stages: STAGE_ORDER.map((stage) => ({
      stage,
      label: stageLabel(stage),
      question: STAGE_QUESTION[stage],
      hooks: catalog.definitions
        .filter((hook) => hook.stage === stage)
        .map((hook) => ({
          id: hook.id,
          name: hook.name,
          live: hook.availability === "implemented",
          reason: hook.availability === "implemented" ? (hook.implementationNote ?? hook.summary) : (hook.unavailableReason ?? "No verified evaluator."),
          line: forgeLines.get(hook.id) ?? hook.summary,
        })),
    })),
  };
}

/* ───────────── Breaker limits ───────────── */

export type RiskRail = { id: string; name: string; label: string; unit: string; min: number; max: number; value: number; summary: string; step: number };
export type HealthGuard = { id: string; name: string; summary: string; note: string };

export function getRiskRails(): RiskRail[] {
  const catalog = getHookCatalog();
  const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const parameters = recipe.parameters as Record<string, Record<string, unknown>>;
  const rail = (id: string, key: string, label: string, unit: string): RiskRail => {
    const definition = catalog.definitions.find((hook) => hook.id === id);
    const spec = (definition?.parameters[key] ?? {}) as { min?: number; max?: number };
    const max = spec.max ?? 100;
    return { id, name: definition?.name ?? id, label, unit, min: spec.min ?? 0, max, value: Number(parameters[id]?.[key]), summary: definition?.summary ?? "", step: max <= 20 ? 0.5 : 1 };
  };
  return [
    rail("haltr", "maxMove1hPct", "Hourly price move", "%"),
    rail("daylo", "maxDailyLossPct", "Daily paper loss", "%"),
    rail("drawra", "maxDrawdownPct", "Drawdown from peak equity", "%"),
    rail("exposa", "maxUnderlyingPct", "Reference exposure", "%"),
  ];
}

export function getHealthGuard(): HealthGuard {
  const definition = getHookCatalog().definitions.find((hook) => hook.id === "venux");
  return { id: "venux", name: definition?.name ?? "Venux", summary: definition?.summary ?? "", note: definition?.implementationNote ?? "" };
}

/* ───────────── Public API excerpt ───────────── */

export type ApiDoc = { id: string; path: string; title: string; summary: string; auth: string; status: "Working" | "Empty"; response: string };

function hooksExcerpt(): string {
  const catalog = getHookCatalog();
  const first = catalog.definitions.find((hook) => hook.id === "calmo");
  const body = JSON.stringify({ coverage: catalog.coverage, definitions: first ? [first] : [] }, null, 2);
  const flat = body.replace(/"expectedByStage": \{[^}]*\}/, `"expectedByStage": ${JSON.stringify(catalog.coverage.expectedByStage)}`);
  return flat.replace(/\n {2}\]\n\}$/, `,\n    …${catalog.definitions.length - 1} more\n  ]\n}`);
}

/** The five public read-only endpoints, with real responses. The caller passes what the public handlers returned. */
export function getApiDocs(live: { templates: unknown; verify: unknown; agents: unknown; tape: unknown }): ApiDoc[] {
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  const filled = (value: unknown, key: string) => Array.isArray((value as Record<string, unknown> | null)?.[key]) && ((value as Record<string, unknown[]>)[key]?.length ?? 0) > 0;
  return [
    { id: "hooks", path: "/api/public/v1/hooks", title: "Hook catalog", summary: "All 36 hook definitions with their stage, parameters and whether an evaluator exists. This sample shows one of them.", auth: "None. Public, read-only.", status: "Working", response: hooksExcerpt() },
    { id: "templates", path: "/api/public/v1/templates", title: "House Agent templates", summary: "The four House Agent templates and whether each is paper ready.", auth: "None. Public, read-only.", status: "Working", response: pretty(live.templates) },
    { id: "verify", path: "/api/public/v1/verify", title: "Capability claims", summary: "What the server claims about itself, each with the path that proves it.", auth: "None. Public, read-only.", status: "Working", response: pretty(live.verify) },
    { id: "agents", path: "/api/public/v1/agents", title: "Public agents", summary: "OPTRA-owned House Agents only, with their status and paper results. User agents are never listed.", auth: "None. Public, read-only.", status: filled(live.agents, "agents") ? "Working" : "Empty", response: pretty(live.agents) },
    { id: "tape", path: "/api/public/v1/tape", title: "Public Tape", summary: "Decisions recorded by the House Agents. Each wallet's own Tape stays private and needs a session.", auth: "None. Public, read-only.", status: filled(live.tape, "decisions") ? "Working" : "Empty", response: pretty(live.tape) },
  ];
}
