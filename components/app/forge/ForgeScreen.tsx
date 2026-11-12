"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgentDetailSchema,
  ApiErrorSchema,
  HookCatalogResponseSchema,
  MarketListSchema,
  RecipeValidationResultSchema,
  RecipeV1Schema,
} from "../../../lib/domain/contracts";
import type { HookCatalogResponse, HookDefinition, HookStage, MarketAsset, RecipeValidationResult } from "../../../lib/domain/contracts";
import { shortHash, titleCase, errorText } from "../format";
import { Chip, PageHeader, StateBlock } from "../ui";

type LoadState = "loading" | "ready" | "error";
const templateOptions = [
  ["covered_call", "Covered Call"],
  ["cash_secured_put", "Cash-Secured Put"],
  ["protective_put", "Protective Put"],
  ["earnings_straddle", "Earnings Straddle"],
  ["custom", "Custom"],
] as const;

const STAGES: { id: HookStage; label: string; purpose: string }[] = [
  { id: "gate", label: "Gate", purpose: "May the agent enter now?" },
  { id: "strike", label: "Strike", purpose: "Which strike and expiry?" },
  { id: "size", label: "Size", purpose: "How much to put at risk?" },
  { id: "pulse", label: "Pulse", purpose: "When to manage or exit?" },
  { id: "expiry", label: "Expiry", purpose: "What happens near expiry?" },
  { id: "breaker", label: "Breaker", purpose: "When to stop new entries?" },
];

async function readBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function apiMessage(value: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.message : fallback;
}

export function ForgeScreen() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<HookCatalogResponse | null>(null);
  const [markets, setMarkets] = useState<MarketAsset[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("My paper strategy");
  const [templateId, setTemplateId] = useState<(typeof templateOptions)[number][0]>("custom");
  const [symbol, setSymbol] = useState("AAPL");
  const [hookIds, setHookIds] = useState<string[]>([]);
  const [validation, setValidation] = useState<RecipeValidationResult | null>(null);
  const [validationError, setValidationError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/hooks", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await readBody(response);
        if (!response.ok) throw new Error(apiMessage(body, "Hook capability is temporarily unavailable."));
        return HookCatalogResponseSchema.parse(body);
      }),
      fetch("/api/markets", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await readBody(response);
        if (!response.ok) throw new Error(apiMessage(body, "Market list is temporarily unavailable."));
        return MarketListSchema.parse(body);
      }),
    ]).then(([hookCatalog, marketList]) => {
      setCatalog(hookCatalog);
      setMarkets(marketList.markets);
      if (!marketList.markets.some((market) => market.symbol === "AAPL")) setSymbol(marketList.markets[0]?.symbol ?? "");
      setLoadState("ready");
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setLoadError(errorText(reason, "Recipe inputs are temporarily unavailable."));
      setLoadState("error");
    });
    return () => controller.abort();
  }, []);

  const byStage = useMemo(() => {
    const groups = new Map<HookStage, { ready: HookDefinition[]; catalogOnly: HookDefinition[] }>();
    for (const stage of STAGES) groups.set(stage.id, { ready: [], catalogOnly: [] });
    for (const hook of catalog?.definitions ?? []) {
      groups.get(hook.stage)?.[hook.availability === "implemented" ? "ready" : "catalogOnly"].push(hook);
    }
    return groups;
  }, [catalog]);

  function currentRecipe() {
    return RecipeV1Schema.safeParse({ version: 1, name, templateId, underlyingSymbol: symbol, hookIds, parameters: {} });
  }

  function invalidateValidation() {
    setValidation(null);
    setValidationError("");
  }

  function toggleHook(hookId: string) {
    setHookIds((current) => current.includes(hookId) ? current.filter((id) => id !== hookId) : [...current, hookId]);
    invalidateValidation();
  }

  async function validate() {
    const parsed = currentRecipe();
    if (!parsed.success) {
      setValidation(null);
      setValidationError("Complete the required recipe fields before validation.");
      return;
    }
    setBusy(true);
    setValidationError("");
    try {
      const response = await fetch("/api/recipes/validate", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const body = await readBody(response);
      if (!response.ok) throw new Error(apiMessage(body, "Recipe validation is temporarily unavailable."));
      setValidation(RecipeValidationResultSchema.parse(body));
    } catch (reason) {
      setValidationError(errorText(reason, "Recipe validation is temporarily unavailable."));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const parsed = currentRecipe();
    if (!parsed.success || !validation?.valid) return;
    setBusy(true);
    setValidationError("");
    try {
      const response = await fetch("/api/recipes", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipe: parsed.data }),
      });
      const body = await readBody(response);
      if (!response.ok) throw new Error(apiMessage(body, "The validated draft could not be saved."));
      const saved = AgentDetailSchema.parse(body);
      router.push(`/agents/${encodeURIComponent(saved.id)}`);
    } catch (reason) {
      setValidationError(errorText(reason, "The validated draft could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const selectedByStage = (stage: HookStage) => (catalog?.definitions ?? []).filter((hook) => hook.stage === stage && hookIds.includes(hook.id));
  const implementedCount = catalog?.definitions.filter((hook) => hook.availability === "implemented").length ?? 0;
  const catalogOnlyCount = (catalog?.definitions.length ?? 0) - implementedCount;

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="CLICK-TO-CONFIGURE · PAPER ONLY"
        title="Forge"
        description="Assemble a recipe from six stages of hook rules. The server validates it, gives it a canonical hash, and blocks anything it cannot run."
      />

      {loadState === "loading" ? <StateBlock kind="loading" title="Loading verified recipe inputs…" /> : null}
      {loadState === "error" ? <StateBlock kind="error" title="Forge is unavailable"><p>{loadError}</p></StateBlock> : null}
      {loadState === "ready" && catalog ? (
        <div className="forge-layout">
          <section className="panel forge-form" aria-label="Recipe builder">
            <div className="panel-head"><h2>Recipe details</h2></div>
            <div className="forge-basics">
              <div className="field">
                <label htmlFor="forge-name">Agent name</label>
                <input id="forge-name" maxLength={80} value={name} onChange={(event) => { setName(event.target.value); invalidateValidation(); }} />
              </div>
              <div className="field">
                <label htmlFor="forge-template">Strategy template</label>
                <select id="forge-template" value={templateId} onChange={(event) => { setTemplateId(event.target.value as typeof templateId); invalidateValidation(); }}>
                  {templateOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="forge-symbol">Underlying market</label>
                <select id="forge-symbol" value={symbol} onChange={(event) => { setSymbol(event.target.value); invalidateValidation(); }} disabled={markets.length === 0}>
                  {markets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol} · {market.name}</option>)}
                </select>
              </div>
            </div>

            <fieldset className="forge-hooks">
              <legend>Hook rules</legend>
              <p className="forge-hooks-note">{implementedCount} rules have deterministic evaluators and can be selected. {catalogOnlyCount} are catalog only and stay locked.</p>
              {catalog.definitions.length === 0 ? <p>No verified hooks are available for a recipe.</p> : null}
              {STAGES.map((stage) => {
                const group = byStage.get(stage.id);
                if (!group || group.ready.length + group.catalogOnly.length === 0) return null;
                return (
                  <div className="forge-stage" key={stage.id}>
                    <div className="forge-stage-head">
                      <h3>{stage.label}</h3>
                      <span>{stage.purpose}</span>
                    </div>
                    {group.ready.map((hook) => (
                      <label className="forge-hook" key={hook.id}>
                        <input type="checkbox" checked={hookIds.includes(hook.id)} onChange={() => toggleHook(hook.id)} />
                        <span><strong>{hook.name}</strong><small>{hook.summary}</small></span>
                      </label>
                    ))}
                    {group.catalogOnly.length > 0 ? (
                      <details className="forge-locked">
                        <summary>{group.catalogOnly.length} catalog-only in {stage.label.toLowerCase()} (locked)</summary>
                        {group.catalogOnly.map((hook) => (
                          <label className="forge-hook forge-hook-locked" key={hook.id}>
                            <input type="checkbox" checked={false} disabled readOnly />
                            <span><strong>{hook.name}</strong><small>{hook.summary} · {hook.unavailableReason ?? "Not implemented"}</small></span>
                          </label>
                        ))}
                      </details>
                    ) : null}
                  </div>
                );
              })}
              {catalog.coverage.sourceStatus === "source_unavailable" ? <p className="panel-note">{catalog.coverage.unavailableReason}</p> : null}
            </fieldset>

            <div className="forge-actions">
              <button className="button button-secondary" type="button" disabled={busy || markets.length === 0} onClick={() => void validate()}>Validate recipe</button>
              <button className="button button-primary" type="button" disabled={busy || !validation?.valid} onClick={() => void saveDraft()}>Save draft</button>
              {!validation?.valid ? <span className="action-note">Save unlocks after the server validates the recipe.</span> : null}
            </div>
            {validationError ? <p className="form-error forge-error" role="alert">{validationError}</p> : null}
            {validation ? (
              <section className={`forge-validation ${validation.valid ? "forge-validation-valid" : "forge-validation-invalid"}`} aria-live="polite">
                <strong>{validation.valid ? "Recipe valid" : "Recipe blocked"}</strong>
                {validation.recipeHash ? <p className="panel-note mono" title={validation.recipeHash}>Canonical hash: {validation.recipeHash}</p> : null}
                {validation.issues.length ? <ul>{validation.issues.map((issue, index) => <li key={`${issue.code}:${issue.hookId ?? index}`}>{issue.message}</li>)}</ul> : null}
              </section>
            ) : null}
          </section>

          <aside className="forge-aside" aria-label="Recipe outline and capability">
            <section className="panel">
              <div className="panel-head"><h2>Recipe outline</h2><Chip>{hookIds.length} selected</Chip></div>
              <ol className="stage-outline">
                {STAGES.map((stage) => {
                  const chosen = selectedByStage(stage.id);
                  return (
                    <li key={stage.id} className={chosen.length ? "outline-filled" : ""}>
                      <span className="outline-stage">{stage.label}</span>
                      <span className="outline-hooks">{chosen.length ? chosen.map((hook) => titleCase(hook.id)).join(", ") : "No rule yet"}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="panel-note">{templateId === "custom" ? "Custom" : titleCase(templateId)} on {symbol || "no market"}. {validation?.recipeHash ? `Hash ${shortHash(validation.recipeHash, 14, 6)}` : "Not validated yet."}</p>
            </section>
            <section className="panel forge-status">
              <p className="eyebrow">CAPABILITY</p>
              <h2>AI composition is planned</h2>
              <p>No verified AI provider is configured, so this builder does not generate recipes. Rules decide; the editor is click-only today.</p>
              <p>Registered hooks: {catalog.coverage.registeredCount} / {catalog.coverage.expectedCount}</p>
              <p>Market symbols: {markets.length}</p>
              <p className="panel-note"><strong>Fastest supported path.</strong> Only the Protective Put composition can be validated and launched on paper. <Link href="/agents#configure">Create that draft on Agents</Link>.</p>
              <Link href="/hooks">Review hook capability</Link>
            </section>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
