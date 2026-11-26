"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AgentDetailSchema, ApiErrorSchema, MarketListSchema } from "../../../lib/domain/contracts";
import { buildProtectivePutRecipe } from "../../../lib/hooks/catalog";
import { buildHouseRecipe } from "../../../lib/hooks/house-specs";
import { isStrategyTemplate, stageSummaries, templateSummaries, tuningDefault, tuningFields, type HouseTemplateId } from "./house-meta";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chip, Panel } from "../ui";
import { errorText } from "../format";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { prioritizeMarkets } from "../../../lib/market/market-priority";

function responseError(body: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : fallback;
}

const titles: Record<HouseTemplateId, string> = {
  protective_put: "Protective Put",
  covered_call: "Covered Call",
  cash_secured_put: "Cash-Secured Put",
  earnings_straddle: "Earnings Straddle",
};

export function HouseAgentCreator({ templateId = "protective_put" }: { templateId?: HouseTemplateId }) {
  const router = useRouter();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [symbol, setSymbol] = useState("AAPL");
  const [shares, setShares] = useState("10");
  const [capital, setCapital] = useState("100000");
  const [tuning, setTuning] = useState<Record<string, string>>({});
  const [capitalFor, setCapitalFor] = useState<HouseTemplateId>("protective_put");
  const strategy = isStrategyTemplate(templateId) ? templateId : null;
  const fields = strategy ? tuningFields[strategy] : [];
  const usesShares = templateId === "protective_put" || templateId === "covered_call";

  // Each strategy starts from its own paper capital so switching templates never carries a mismatched amount over.
  if (capitalFor !== templateId) {
    setCapitalFor(templateId);
    setCapital(templateId === "protective_put" ? "100000" : templateId === "covered_call" ? "2000" : "10000");
    setShares(templateId === "covered_call" ? "10" : "10");
    setTuning({});
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(body, "Market list is temporarily unavailable."));
        return MarketListSchema.parse(body);
      })
      .then(({ markets }) => {
        const nextSymbols = prioritizeMarkets(markets).map((market) => market.symbol);
        setSymbols(nextSymbols);
        setMarketsLoading(false);
        if (nextSymbols.length) {
          // Markets links here with ?symbol=XYZ. The choice still has to pass wallet sign-in, a backtest and validation.
          const requested = new URLSearchParams(window.location.search).get("symbol")?.toUpperCase();
          setSymbol((current) => requested && nextSymbols.includes(requested) ? requested : nextSymbols.includes(current) ? current : nextSymbols.includes("AAPL") ? "AAPL" : nextSymbols[0]!);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMarketsLoading(false);
        setError(errorText(reason, "Market list is temporarily unavailable."));
      });
    return () => controller.abort();
  }, []);

  const minCapital = templateId === "protective_put" || templateId === "covered_call" ? 100 : 1000;
  const sharesValid = !usesShares || (Number.isInteger(Number(shares)) && Number(shares) >= 1);
  const capitalValid = Number.isFinite(Number(capital)) && Number(capital) >= minCapital;
  const tuningValue = (field: (typeof fields)[number]) => tuning[field.id] ?? String(strategy ? tuningDefault(strategy, field) : "");
  const tuningValid = (field: (typeof fields)[number]) => {
    const raw = tuningValue(field);
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) && value >= field.min && value <= field.max && (!field.integer || Number.isInteger(value));
  };
  const formValid = sharesValid && capitalValid && fields.every(tuningValid);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid) return;
    setBusy(true);
    setError("");
    try {
      let recipe;
      if (strategy) {
        const overrides: Record<string, Record<string, unknown>> = {};
        for (const field of fields) {
          const defaults = buildHouseRecipe(strategy, { underlyingSymbol: symbol }).parameters[field.hook] as Record<string, unknown>;
          overrides[field.hook] = { ...(overrides[field.hook] ?? defaults), [field.key]: Number(tuningValue(field)) };
        }
        recipe = buildHouseRecipe(strategy, { underlyingSymbol: symbol, initialCapitalUsd: capital, referenceShares: shares, overrides });
      } else {
        recipe = buildProtectivePutRecipe({ underlyingSymbol: symbol, protectedShares: shares, initialCapitalUsd: capital });
      }
      const response = await fetch("/api/agents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Paper agent could not be created."));
      const agent = AgentDetailSchema.parse(body);
      router.push(`/agents/${encodeURIComponent(agent.id)}`);
    } catch (reason) {
      setError(errorText(reason, "Paper agent could not be created."));
      setBusy(false);
    }
  }

  return (
    <Panel className="creator" id="configure" aria-label={`Create ${titles[templateId]} House Agent`}>
      <div className="panel-head">
        <div><p className="eyebrow">STEP 2 · CONFIGURE</p><h2>{titles[templateId]} draft</h2></div>
        <Chip tone="azure">Paper ready</Chip>
      </div>
      <p className="panel-lede">{templateSummaries[templateId]}</p>
      <p className="panel-lede">Creates one deterministic recipe. Reference shares, collateral and capital are virtual simulation inputs: nothing is read from, or locked in, your wallet.</p>
      <form className="creator-form" onSubmit={(event) => void createDraft(event)} noValidate={false}>
        <div className="field">
          <Label htmlFor="house-agent-symbol">Underlying</Label>
          <Select value={symbol} onValueChange={setSymbol} disabled={busy || symbols.length === 0}>
            <SelectTrigger id="house-agent-symbol" className="w-full">
              <SelectValue placeholder={marketsLoading ? "Loading markets…" : "No markets available"} />
            </SelectTrigger>
            <SelectContent>
              {symbols.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {usesShares ? (
        <div className="field">
          <Label htmlFor="house-agent-shares">Virtual reference shares</Label>
          <Input id="house-agent-shares" type="number" min="1" step="1" inputMode="numeric" value={shares} onChange={(event) => setShares(event.target.value)} aria-invalid={!sharesValid} aria-describedby="shares-note" required />
          <span className={sharesValid ? "field-hint" : "field-hint field-hint-error"} id="shares-note">{sharesValid ? (templateId === "covered_call" ? "Whole shares the calls can be written against." : "Shares the put is sized to protect.") : "Enter a whole number of at least 1."}</span>
        </div>
        ) : null}
        <div className="field">
          <Label htmlFor="house-agent-capital">Paper capital (USD)</Label>
          <Input id="house-agent-capital" type="number" min={minCapital} step="100" inputMode="numeric" value={capital} onChange={(event) => setCapital(event.target.value)} aria-invalid={!capitalValid} aria-describedby="capital-note" required />
          <span className={capitalValid ? "field-hint" : "field-hint field-hint-error"} id="capital-note">{capitalValid ? (templateId === "cash_secured_put" ? "Virtual USDG that secures each put." : "Virtual cash for premiums and collateral.") : `Enter at least ${minCapital} USD.`}</span>
        </div>
        {fields.map((field) => (
          <div className="field" key={field.id}>
            <Label htmlFor={`house-${field.id}`}>{field.label}</Label>
            <Input id={`house-${field.id}`} type="number" min={field.min} max={field.max} step={field.step} inputMode="decimal" value={tuningValue(field)} onChange={(event) => setTuning((current) => ({ ...current, [field.id]: event.target.value }))} aria-invalid={!tuningValid(field)} aria-describedby={`house-${field.id}-note`} required />
            <span className={tuningValid(field) ? "field-hint" : "field-hint field-hint-error"} id={`house-${field.id}-note`}>{tuningValid(field) ? field.hint : `Enter ${field.integer ? "a whole number " : ""}from ${field.min} to ${field.max}.`}</span>
          </div>
        ))}
        <div className="strategy-summary" aria-live="polite">
          <p className="eyebrow">YOUR STRATEGY</p>
          {templateId === "protective_put" ? (
            <>
              <p className="strategy-line">Protect <b className="mono">{sharesValid ? shares : "?"} {symbol || "shares"}</b> with a put <b>7% out of the money</b>, about 30 days out.</p>
              <p className="strategy-sub">Premium capped at 2% of the holding per entry, paid from <span className="mono">${capitalValid ? Number(capital).toLocaleString("en-US") : "?"}</span> of virtual capital. Simulated execution: premiums are modeled and no real funds or onchain orders are involved.</p>
            </>
          ) : templateId === "covered_call" ? (
            <>
              <p className="strategy-line">Sell weekly calls <b>{tuningValue(fields[0]!)}% out of the money</b> against <b className="mono">{sharesValid ? shares : "?"} {symbol || "shares"}</b> you hold on paper.</p>
              <p className="strategy-sub">Never more calls than whole uncommitted shares. Upside above the strike is given up. Premiums are modeled and no real funds or onchain orders are involved.</p>
            </>
          ) : templateId === "cash_secured_put" ? (
            <>
              <p className="strategy-line">Sell weekly <b className="mono">{symbol || "stock"}</b> puts near <b>{tuningValue(fields[0]!)} delta</b> in an uptrend, with the full strike reserved from <span className="mono">${capitalValid ? Number(capital).toLocaleString("en-US") : "?"}</span> of virtual USDG.</p>
              <p className="strategy-sub">At most two positions and half of equity each. A drop below the strike is a paper loss. Premiums are modeled and no real funds or onchain orders are involved.</p>
            </>
          ) : (
            <>
              <p className="strategy-line">Buy a <b className="mono">{symbol || "stock"}</b> at-the-money call and put before a confirmed earnings report, using up to <b>{tuningValue(fields[1]!)}%</b> of capital.</p>
              <p className="strategy-sub">It loses the premium if the stock does not move enough. Only a company-confirmed earnings date can open a trade. Premiums are modeled and no real funds or onchain orders are involved.</p>
            </>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={busy || marketsLoading || symbols.length === 0 || !formValid}>{busy ? "Creating…" : "Create paper draft"}</Button>
      </form>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {!marketsLoading && symbols.length === 0 && !error ? <p className="form-hint">No active markets were returned, so a draft cannot be created right now.</p> : null}

      <details className="recipe-outline">
        <summary><ShieldCheck aria-hidden />What this recipe will run</summary>
        <ol>
          {stageSummaries[templateId].map(([stage, hooks, text]) => (
            <li key={stage}>
              <span className="recipe-stage">{stage}</span>
              <span className="recipe-body"><span className="recipe-hooks">{hooks}</span>{text}</span>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}
