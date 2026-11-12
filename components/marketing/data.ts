import { buildProtectivePutRecipe, getHookCatalog, getHouseAgentTemplates, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import type { HookDefinition, HookStage } from "../../lib/domain/contracts";

export const STAGE_ORDER: HookStage[] = ["gate", "strike", "size", "pulse", "expiry", "breaker"];

export const stageLabel = (stage: HookStage): string => stage.charAt(0).toUpperCase() + stage.slice(1);

/** Everything the landing page states about capability is derived from the same catalog the API serves. */
export function getLandingFacts() {
  const catalog = getHookCatalog();
  const templates = getHouseAgentTemplates().templates;
  const implemented = catalog.definitions.filter((hook) => hook.availability === "implemented");
  const byStage = STAGE_ORDER.map((stage) => {
    const hooks = catalog.definitions.filter((hook) => hook.stage === stage);
    return { stage, total: hooks.length, live: hooks.filter((hook) => hook.availability === "implemented").length };
  });

  // Recipe defaults are read from the real Protective Put builder; the symbol and sizes are placeholders and never displayed.
  const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const p = recipe.parameters as Record<string, Record<string, number | string>>;
  const summary: Record<string, string> = {
    calmo: `Realized volatility ratio at most ${p.calmo?.rvRatioMax}`,
    corpax: `Pause ${p.corpax?.pauseHoursBefore}h around token corporate actions`,
    sessia: "Enter in regular US hours only",
    percy: `Buy a put ${p.percy?.otmPct}% out of the money`,
    tenora: `${p.tenora?.targetDTE} calendar days to expiry`,
    coverix: `Cover ${p.coverix?.coveragePct}% of reference shares`,
    capra: `Premium at most ${p.capra?.maxPremiumPctHolding}% of the holding`,
    trailo: `Arm at +${p.trailo?.activateAtGainPct}%, trail ${p.trailo?.trailPct}%`,
    lastra: `Close ${p.lastra?.hoursBefore}h before expiry`,
    nextra: "Open the next cycle after the close",
    haltr: `Pause entries on a ${p.haltr?.maxMove1hPct}% hourly move`,
    daylo: `Stop entries at ${p.daylo?.maxDailyLossPct}% daily loss`,
    drawra: `Stop entries at ${p.drawra?.maxDrawdownPct}% drawdown`,
    exposa: `Cap exposure at ${p.exposa?.maxUnderlyingPct}%`,
    venux: "Require healthy data and a valid premium model",
  };
  const recipeStages = STAGE_ORDER.map((stage) => ({
    stage,
    hooks: PAPER_PROTECTIVE_PUT_HOOK_IDS
      .map((id) => catalog.definitions.find((hook): hook is HookDefinition => hook.id === id))
      .filter((hook): hook is HookDefinition => hook !== undefined && hook.stage === stage)
      .map((hook) => ({ id: hook.id, name: hook.name, line: summary[hook.id] ?? hook.summary })),
  })).filter((entry) => entry.hooks.length > 0);

  return {
    hookTotal: catalog.definitions.length,
    hookLive: implemented.length,
    hookCatalogOnly: catalog.definitions.length - implemented.length,
    byStage,
    recipeStages,
    templates,
    paperReadyTemplates: templates.filter((template) => template.availability === "paper_ready"),
    previewTemplates: templates.filter((template) => template.availability === "preview"),
  };
}
