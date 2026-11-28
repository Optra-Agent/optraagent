"use client";

import { AgentCharacter } from "../../marketing/characters";
import Link from "next/link";
import { Check } from "lucide-react";
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
import { buildProtectivePutRecipe, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../../lib/hooks/catalog";
import { parseUsdgToAtomic } from "../../../lib/economics/atomic";
import { DEFAULT_ECONOMIC_MANDATE, OPTRA_VOLATILITY_PROVIDER_ID } from "../../../lib/economics/types";
import type { ServiceCategory } from "../../../lib/economics/types";
import { shortHash, titleCase, errorText } from "../format";
import { Chip, PageHeader, StateBlock, Panel } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [protectedShares, setProtectedShares] = useState("10");
  const [initialCapitalUsd, setInitialCapitalUsd] = useState("100000");
  const [putOtmPct, setPutOtmPct] = useState("7");
  const [targetDte, setTargetDte] = useState("30");
  const [maxPremiumPctHolding, setMaxPremiumPctHolding] = useState("2");
  const [hookIds, setHookIds] = useState<string[]>([...PAPER_PROTECTIVE_PUT_HOOK_IDS]);
  const [validation, setValidation] = useState<RecipeValidationResult | null>(null);
  const [validationError, setValidationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [x402Enabled, setX402Enabled] = useState(true);
  const [dailyServiceBudgetUsdg, setDailyServiceBudgetUsdg] = useState("1.00");
  const [perRequestLimitUsdg, setPerRequestLimitUsdg] = useState("0.10");
  const [initialServiceFundUsdg, setInitialServiceFundUsdg] = useState("1.00");
  const [approvedCategories, setApprovedCategories] = useState<ServiceCategory[]>(["VOLATILITY_DATA", "MARKET_DATA"]);

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
    const defaults = buildProtectivePutRecipe({
      underlyingSymbol: symbol || "AAPL",
      protectedShares,
      initialCapitalUsd,
      name: name.trim() || "Custom Protective Put",
    });
    return RecipeV1Schema.safeParse({
      ...defaults,
      name,
      templateId,
      underlyingSymbol: symbol,
      hookIds,
      parameters: {
        ...defaults.parameters,
        percy: { ...(defaults.parameters.percy as Record<string, unknown>), otmPct: Number(putOtmPct) },
        tenora: { ...(defaults.parameters.tenora as Record<string, unknown>), targetDTE: Number(targetDte) },
        capra: { ...(defaults.parameters.capra as Record<string, unknown>), maxPremiumPctHolding: Number(maxPremiumPctHolding) },
      },
    });
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
    if (templateId === "covered_call" || templateId === "cash_secured_put" || templateId === "earnings_straddle") {
      // These three are closed House Agent specifications with their own configuration form; Forge composes the Protective Put family.
      setValidation({ valid: false, recipeHash: null, issues: [{ code: "INVALID_COMPOSITION", message: `${titleCase(templateId)} is a closed House Agent specification. Configure it on the Agents screen, where every input stays inside its validated range. Forge composes Protective Put and custom Protective Put recipes only.` }] });
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
      try {
        await fetch(`/api/agents/${encodeURIComponent(saved.id)}/economics`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "update_mandate",
            mandate: {
              ...DEFAULT_ECONOMIC_MANDATE,
              enabled: x402Enabled,
              dailyServiceBudgetAtomic: parseUsdgToAtomic(dailyServiceBudgetUsdg || "1.00"),
              perRequestLimitAtomic: parseUsdgToAtomic(perRequestLimitUsdg || "0.10"),
              approvedProviders: [OPTRA_VOLATILITY_PROVIDER_ID],
              approvedServiceCategories: approvedCategories.length > 0 ? approvedCategories : ["VOLATILITY_DATA"],
            },
            reason: "Configured Economic Mandate in Forge.",
          }),
        });
        if (x402Enabled && Number(initialServiceFundUsdg) > 0) {
          await fetch(`/api/agents/${encodeURIComponent(saved.id)}/economics`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "fund",
              amountUsdg: initialServiceFundUsdg,
              reason: "Initial Service Budget allocation from Forge.",
            }),
          });
        }
      } catch {
        // Non-blocking: draft is saved and Economic Mandate can be adjusted on the Economics tab.
      }
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

      <ol className="journey forge-rail" aria-label="Forge workflow">
        <li className="forge-rail-wrap">
          {(() => {
            const steps = [
              { label: "Choose agent", done: Boolean(templateId && symbol) },
              { label: "Configure hooks", done: hookIds.length > 0 },
              { label: "Validate recipe", done: Boolean(validation?.valid) },
              { label: "Backtest in Lab", done: false },
            ];
            const current = steps.findIndex((step) => !step.done);
            return (
              <ol>
                {steps.map((step, index) => {
                  const state = step.done ? "done" : index === current ? "current" : "next";
                  return (
                    <li key={step.label} className={`journey-step journey-${state}`} aria-current={state === "current" ? "step" : undefined}>
                      <span className="journey-static"><span className="journey-index">{step.done ? <Check aria-hidden /> : index + 1}</span><span className="journey-label">{step.label}</span></span>
                    </li>
                  );
                })}
              </ol>
            );
          })()}
        </li>
      </ol>

      {loadState === "loading" ? <StateBlock kind="loading" title="Loading verified recipe inputs…" /> : null}
      {loadState === "error" ? <StateBlock kind="error" title="Forge is unavailable"><p>{loadError}</p></StateBlock> : null}
      {loadState === "ready" && catalog ? (
        <div className="forge-layout">
          <Panel className="forge-form" aria-label="Recipe builder">
            <div className="panel-head"><h2>Recipe details</h2></div>
            <div className="forge-basics">
              <div className="field">
                <Label htmlFor="forge-name">Agent name</Label>
                <Input id="forge-name" maxLength={80} value={name} onChange={(event) => { setName(event.target.value); invalidateValidation(); }} />
              </div>
              <div className="field">
                <Label htmlFor="forge-template">Strategy template</Label>
                <Select value={templateId} onValueChange={(value) => { setTemplateId(value as typeof templateId); invalidateValidation(); }}>
                  <SelectTrigger id="forge-template" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templateOptions.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="field">
                <Label htmlFor="forge-symbol">Underlying market</Label>
                <Select value={symbol || undefined} onValueChange={(value) => { setSymbol(value); invalidateValidation(); }} disabled={markets.length === 0}>
                  <SelectTrigger id="forge-symbol" className="w-full"><SelectValue placeholder="No markets available" /></SelectTrigger>
                  <SelectContent>
                    {markets.map((market) => <SelectItem key={market.symbol} value={market.symbol}>{market.symbol} · {market.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="field">
                <Label htmlFor="forge-shares">Virtual reference shares</Label>
                <Input id="forge-shares" type="number" min="1" step="1" inputMode="numeric" value={protectedShares} onChange={(event) => { setProtectedShares(event.target.value); invalidateValidation(); }} required />
              </div>
              <div className="field">
                <Label htmlFor="forge-capital">Paper capital (USD)</Label>
                <Input id="forge-capital" type="number" min="100" step="100" inputMode="decimal" value={initialCapitalUsd} onChange={(event) => { setInitialCapitalUsd(event.target.value); invalidateValidation(); }} required />
              </div>
              <div className="field">
                <Label htmlFor="forge-otm-pct">Put strike distance (% OTM)</Label>
                <Input id="forge-otm-pct" type="number" min="1" max="20" step="0.5" inputMode="decimal" value={putOtmPct} onChange={(event) => { setPutOtmPct(event.target.value); invalidateValidation(); }} required />
              </div>
              <div className="field">
                <Label htmlFor="forge-target-dte">Model expiry (calendar days)</Label>
                <Input id="forge-target-dte" type="number" min="10" max="45" step="1" inputMode="numeric" value={targetDte} onChange={(event) => { setTargetDte(event.target.value); invalidateValidation(); }} required />
              </div>
              <div className="field">
                <Label htmlFor="forge-premium-cap">Max premium (% of reference holding)</Label>
                <Input id="forge-premium-cap" type="number" min="0.1" max="2" step="0.1" inputMode="decimal" value={maxPremiumPctHolding} onChange={(event) => { setMaxPremiumPctHolding(event.target.value); invalidateValidation(); }} required />
              </div>
            </div>

            <fieldset className="forge-hooks">
              <legend>Economic Mandate (x402 Machine Services)</legend>
              <p className="forge-hooks-note">
                Separate from Trading Capital: machine services (volatility &amp; market data) draw only from the isolated Service Budget. Unknown providers are denied by default.
              </p>
              <div className="forge-basics">
                <div className="field">
                  <Label htmlFor="forge-x402-enabled">Machine spending</Label>
                  <Select value={x402Enabled ? "enabled" : "disabled"} onValueChange={(v) => setX402Enabled(v === "enabled")}>
                    <SelectTrigger id="forge-x402-enabled" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enabled">Enabled (bounded x402)</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="field">
                  <Label htmlFor="forge-daily-service-budget">Daily Service Budget (USDG)</Label>
                  <Input id="forge-daily-service-budget" type="number" min="0" step="0.1" value={dailyServiceBudgetUsdg} onChange={(e) => setDailyServiceBudgetUsdg(e.target.value)} />
                </div>
                <div className="field">
                  <Label htmlFor="forge-per-request-limit">Per-Request Cap (USDG)</Label>
                  <Input id="forge-per-request-limit" type="number" min="0" step="0.01" value={perRequestLimitUsdg} onChange={(e) => setPerRequestLimitUsdg(e.target.value)} />
                </div>
                <div className="field">
                  <Label htmlFor="forge-initial-service-fund">Initial Service Budget Fund (USDG)</Label>
                  <Input id="forge-initial-service-fund" type="number" min="0" step="0.1" value={initialServiceFundUsdg} onChange={(e) => setInitialServiceFundUsdg(e.target.value)} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["VOLATILITY_DATA", "MARKET_DATA", "VERIFICATION", "RESEARCH"] as const).map((cat) => {
                  const checked = approvedCategories.includes(cat);
                  return (
                    <label className="forge-hook" key={cat}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setApprovedCategories((prev) =>
                            checked ? prev.filter((item) => item !== cat) : [...prev, cat],
                          )
                        }
                      />
                      <span><strong>{cat}</strong></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="forge-hooks">
              <legend>Hook rules</legend>
              <p className="forge-hooks-note">{implementedCount} rules have deterministic evaluators. The supported Protective Put requires all of its 15 rules; {catalogOnlyCount} catalog-only hooks stay locked.</p>
              {catalog.definitions.length === 0 ? <p>No verified hooks are available for a recipe.</p> : null}
              {STAGES.map((stage) => {
                const group = byStage.get(stage.id);
                if (!group || group.ready.length + group.catalogOnly.length === 0) return null;
                return (
                  <div className="forge-stage" key={stage.id}>
                    <div className="forge-stage-head">
                      <AgentCharacter id={stage.id} size={30} />
                      <h3>{stage.label}</h3>
                      <span>{stage.purpose}</span>
                    </div>
                    <div className="forge-chips">
                      {group.ready.map((hook) => (
                        <label className="forge-hook" key={hook.id} title={hook.summary}>
                          <input type="checkbox" checked={hookIds.includes(hook.id)} onChange={() => toggleHook(hook.id)} />
                          <span><strong>{hook.name}</strong><small className="sr-only">{hook.summary}</small></span>
                        </label>
                      ))}
                    </div>
                    {group.catalogOnly.length > 0 ? (
                      <details className="forge-locked">
                        <summary>{group.catalogOnly.length} catalog-only in {stage.label.toLowerCase()} (locked)</summary>
                        <div className="forge-chips forge-chips-locked">
                          {group.catalogOnly.map((hook) => (
                            <label className="forge-hook forge-hook-locked" key={hook.id} title={`${hook.summary} ${hook.unavailableReason ?? "Not implemented"}`}>
                              <input type="checkbox" checked={false} disabled readOnly />
                              <span><strong>{hook.name}</strong><small className="sr-only">{hook.summary} · {hook.unavailableReason ?? "Not implemented"}</small></span>
                            </label>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
              {catalog.coverage.sourceStatus === "source_unavailable" ? <p className="panel-note">{catalog.coverage.unavailableReason}</p> : null}
            </fieldset>

            <div className="forge-actions">
              <Button variant="outline" type="button" disabled={busy || markets.length === 0} onClick={() => void validate()}>Validate recipe</Button>
              <Button  type="button" disabled={busy || !validation?.valid} onClick={() => void saveDraft()}>Save draft</Button>
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
          </Panel>

          <aside className="forge-aside" aria-label="Recipe outline and capability">
            <Panel>
              <div className="panel-head"><h2>Recipe outline</h2><Chip>{hookIds.length} selected</Chip></div>
              <ol className="stage-outline">
                {STAGES.map((stage) => {
                  const chosen = selectedByStage(stage.id);
                  return (
                    <li key={stage.id} className={chosen.length ? "outline-filled" : ""}>
                      <span className="outline-stage"><AgentCharacter id={stage.id} size={22} />{stage.label}</span>
                      <span className="outline-hooks">{chosen.length ? chosen.map((hook) => titleCase(hook.id)).join(", ") : "No rule yet"}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="panel-note">{templateId === "custom" ? "Custom" : titleCase(templateId)} on {symbol || "no market"}. {validation?.recipeHash ? `Hash ${shortHash(validation.recipeHash, 14, 6)}` : "Not validated yet."}</p>
            </Panel>
            <Panel className="forge-status">
              <p className="eyebrow">CAPABILITY</p>
              <h2>AI composition is planned</h2>
              <p>No verified AI provider is configured, so this builder does not generate recipes. Rules decide; the editor is click-only today.</p>
              <p>Registered hooks: {catalog.coverage.registeredCount} / {catalog.coverage.expectedCount}</p>
              <p>Market symbols: {markets.length}</p>
              <p className="panel-note"><strong>Fastest supported path.</strong> Only the Protective Put composition can be validated and launched on paper. <Link href="/agents#configure">Create that draft on Agents</Link>.</p>
              <Link href="/hooks">Review hook capability</Link>
            </Panel>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
