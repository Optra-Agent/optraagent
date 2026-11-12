import { buildProtectivePutRecipe, getHookCatalog, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import { validateRecipe } from "../../lib/hooks/recipe-validator";
import type { HookDefinition, HookStage } from "../../lib/domain/contracts";
import { STAGE_ORDER, STAGE_QUESTION, stageLabel } from "./data";

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
  params: { key: string; spec: string }[];
};
export type ExplorerStage = { stage: HookStage; label: string; question: string; live: number; total: number; hooks: ExplorerHook[] };

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
  return STAGE_ORDER.map((stage) => {
    const hooks = catalog.definitions.filter((hook: HookDefinition) => hook.stage === stage);
    return {
      stage,
      label: stageLabel(stage),
      question: STAGE_QUESTION[stage],
      live: hooks.filter((hook) => hook.availability === "implemented").length,
      total: hooks.length,
      hooks: hooks.map((hook) => ({
        id: hook.id,
        name: hook.name,
        live: hook.availability === "implemented",
        summary: hook.summary,
        note: hook.availability === "implemented" ? hook.implementationNote ?? null : hook.unavailableReason ?? null,
        inRecipe: PAPER_PROTECTIVE_PUT_HOOK_IDS.includes(hook.id),
        params: Object.entries(hook.parameters).map(([key, raw]) => ({ key, spec: paramSpec(raw) })),
      })),
    };
  });
}

/* ───────────── Forge demo ───────────── */

export type ForgeDemoData = {
  stages: { stage: HookStage; label: string; hooks: { id: string; name: string; live: boolean; reason: string }[] }[];
  required: string[];
  /** Real validator messages when a single required hook is removed from the Protective Put recipe. */
  issuesIfRemoved: Record<string, string[]>;
  /** Real canonical hash of the default recipe with example inputs. */
  validHash: string;
};

export function getForgeDemo(): ForgeDemoData {
  const catalog = getHookCatalog();
  const required = [...PAPER_PROTECTIVE_PUT_HOOK_IDS];
  const full = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const base = validateRecipe(full);
  if (!base.valid || !base.recipeHash) throw new Error("The default Protective Put recipe must validate.");

  const issuesIfRemoved: Record<string, string[]> = {};
  for (const id of required) {
    const result = validateRecipe({ ...full, hookIds: full.hookIds.filter((hookId) => hookId !== id) });
    issuesIfRemoved[id] = result.issues.map((issue) => issue.message);
  }

  return {
    required,
    issuesIfRemoved,
    validHash: base.recipeHash,
    stages: STAGE_ORDER.map((stage) => ({
      stage,
      label: stageLabel(stage),
      hooks: catalog.definitions
        .filter((hook) => hook.stage === stage)
        .map((hook) => ({
          id: hook.id,
          name: hook.name,
          live: hook.availability === "implemented",
          reason: hook.availability === "implemented" ? (hook.implementationNote ?? hook.summary) : (hook.unavailableReason ?? "No verified evaluator."),
        })),
    })),
  };
}

/* ───────────── Breaker limits ───────────── */

export type RiskRail = { id: string; name: string; label: string; unit: string; min: number; max: number; value: number };

export function getRiskRails(): RiskRail[] {
  const catalog = getHookCatalog();
  const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const parameters = recipe.parameters as Record<string, Record<string, unknown>>;
  const rail = (id: string, key: string, label: string, unit: string): RiskRail => {
    const definition = catalog.definitions.find((hook) => hook.id === id);
    const spec = (definition?.parameters[key] ?? {}) as { min?: number; max?: number };
    return { id, name: definition?.name ?? id, label, unit, min: spec.min ?? 0, max: spec.max ?? 100, value: Number(parameters[id]?.[key]) };
  };
  return [
    rail("haltr", "maxMove1hPct", "Hourly price move", "%"),
    rail("daylo", "maxDailyLossPct", "Daily paper loss", "%"),
    rail("drawra", "maxDrawdownPct", "Drawdown from peak equity", "%"),
    rail("exposa", "maxUnderlyingPct", "Reference exposure", "%"),
  ];
}

/* ───────────── Public API excerpt ───────────── */

export function getApiSample(): string {
  const catalog = getHookCatalog();
  const first = catalog.definitions.find((hook) => hook.id === "calmo");
  const body = JSON.stringify({ coverage: catalog.coverage, definitions: first ? [first] : [] }, null, 2);
  const trimmed = body.replace(/\n {2}\]\n\}$/, `,\n    …${catalog.definitions.length - 1} more\n  ]\n}`);
  return trimmed;
}
