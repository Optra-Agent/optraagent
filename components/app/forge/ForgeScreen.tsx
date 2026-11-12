"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgentDetailSchema,
  ApiErrorSchema,
  HookCatalogResponseSchema,
  MarketListSchema,
  RecipeValidationResultSchema,
  RecipeV1Schema,
} from "../../../lib/domain/contracts";
import type { HookCatalogResponse, MarketAsset, RecipeValidationResult } from "../../../lib/domain/contracts";

type LoadState = "loading" | "ready" | "error";
const templateOptions = [
  ["covered_call", "Covered Call"],
  ["cash_secured_put", "Cash-Secured Put"],
  ["protective_put", "Protective Put"],
  ["earnings_straddle", "Earnings Straddle"],
  ["custom", "Custom"],
] as const;

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
      setLoadError(reason instanceof Error ? reason.message : "Recipe inputs are temporarily unavailable.");
      setLoadState("error");
    });
    return () => controller.abort();
  }, []);

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
      setValidationError(reason instanceof Error ? reason.message : "Recipe validation is temporarily unavailable.");
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
      setValidationError(reason instanceof Error ? reason.message : "The validated draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-container">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">CLICK-TO-CONFIGURE · PAPER ONLY</p>
          <h1>Forge</h1>
          <p className="page-description">Build a schema-bound recipe from supported markets and verified hook rules.</p>
        </div>
      </div>

      {loadState === "loading" ? <section className="state-panel" role="status">Loading verified recipe inputs…</section> : null}
      {loadState === "error" ? <section className="state-panel" role="alert">{loadError}</section> : null}
      {loadState === "ready" && catalog ? (
        <div className="forge-layout">
          <section className="state-panel forge-form" aria-label="Recipe builder">
            <h2>Recipe details</h2>
            <label className="forge-field">Agent name
              <input maxLength={80} value={name} onChange={(event) => { setName(event.target.value); invalidateValidation(); }} />
            </label>
            <label className="forge-field">Strategy template
              <select value={templateId} onChange={(event) => { setTemplateId(event.target.value as typeof templateId); invalidateValidation(); }}>
                {templateOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="forge-field">Underlying market
              <select value={symbol} onChange={(event) => { setSymbol(event.target.value); invalidateValidation(); }} disabled={markets.length === 0}>
                {markets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol} · {market.name}</option>)}
              </select>
            </label>

            <fieldset className="forge-hooks">
              <legend>Hook rules</legend>
              {catalog.definitions.length === 0 ? <p>No verified hooks are available for a recipe.</p> : null}
              {catalog.definitions.map((hook) => (
                <label className="forge-hook" key={hook.id}>
                  <input type="checkbox" checked={hookIds.includes(hook.id)} disabled={hook.availability !== "implemented"} onChange={() => toggleHook(hook.id)} />
                  <span><strong>{hook.name}</strong><small>{hook.summary}{hook.availability !== "implemented" ? ` · ${hook.unavailableReason ?? "Not implemented"}` : ""}</small></span>
                </label>
              ))}
              {catalog.coverage.sourceStatus === "source_unavailable" ? <p className="market-note">{catalog.coverage.unavailableReason}</p> : null}
            </fieldset>

            <div className="forge-actions">
              <button className="button button-secondary" type="button" disabled={busy || markets.length === 0} onClick={() => void validate()}>Validate recipe</button>
              <button className="button button-primary" type="button" disabled={busy || !validation?.valid} onClick={() => void saveDraft()}>Save draft</button>
            </div>
            {validationError ? <p className="forge-error" role="alert">{validationError}</p> : null}
            {validation ? (
              <section className={`forge-validation ${validation.valid ? "forge-validation-valid" : "forge-validation-invalid"}`} aria-live="polite">
                <strong>{validation.valid ? "Recipe valid" : "Recipe blocked"}</strong>
                {validation.recipeHash ? <p className="market-note">Canonical hash: {validation.recipeHash}</p> : null}
                {validation.issues.length ? <ul>{validation.issues.map((issue, index) => <li key={`${issue.code}:${issue.hookId ?? index}`}>{issue.message}</li>)}</ul> : null}
              </section>
            ) : null}
          </section>

          <aside className="state-panel forge-status">
            <p className="eyebrow">CAPABILITY</p>
            <h2>AI composition is planned</h2>
            <p>No verified AI provider is configured, so this builder does not generate recipes.</p>
            <p>Registered hooks: {catalog.coverage.registeredCount} / {catalog.coverage.expectedCount}</p>
            <p>Market symbols: {markets.length}</p>
            <Link href="/hooks">Review hook capability</Link>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
