"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AgentDetailSchema, ApiErrorSchema, MarketListSchema } from "../../../lib/domain/contracts";
import { buildProtectivePutRecipe } from "../../../lib/hooks/catalog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chip, Panel } from "../ui";
import { errorText } from "../format";
import { Button } from "@/components/ui/button";

function responseError(body: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : fallback;
}

const stageSummary = [
  ["Gate", "Calmo, Corpax, Sessia", "Enter only in calm volatility, outside corporate actions, in regular hours."],
  ["Strike", "Percy, Tenora", "Buy a put 7% out of the money, about 30 calendar days out."],
  ["Size", "Coverix, Capra", "Cover the reference shares; spend at most 2% of their value on premium."],
  ["Pulse", "Trailo", "Arm a trailing exit once the modeled put doubles."],
  ["Expiry", "Lastra, Nextra", "Close 24 hours before expiry, then open the next cycle."],
  ["Breaker", "Haltr, Daylo, Drawra, Exposa, Venux", "Block new entries on bad data, daily loss, drawdown or exposure."],
] as const;

export function HouseAgentCreator() {
  const router = useRouter();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [symbol, setSymbol] = useState("AAPL");
  const [shares, setShares] = useState("10");
  const [capital, setCapital] = useState("100000");
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
        const nextSymbols = markets.map((market) => market.symbol);
        setSymbols(nextSymbols);
        setMarketsLoading(false);
        if (nextSymbols.length) setSymbol((current) => nextSymbols.includes(current) ? current : nextSymbols.includes("AAPL") ? "AAPL" : nextSymbols[0]!);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMarketsLoading(false);
        setError(errorText(reason, "Market list is temporarily unavailable."));
      });
    return () => controller.abort();
  }, []);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const recipe = buildProtectivePutRecipe({ underlyingSymbol: symbol, protectedShares: shares, initialCapitalUsd: capital });
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
    <Panel className="creator" id="configure" aria-label="Create Protective Put House Agent">
      <div className="panel-head">
        <div><p className="eyebrow">STEP 2 · CONFIGURE</p><h2>Protective Put draft</h2></div>
        <Chip tone="azure">Paper ready</Chip>
      </div>
      <p className="panel-lede">Creates one deterministic recipe. Reference shares and capital are virtual simulation inputs: nothing is read from, or locked in, your wallet.</p>
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
        <div className="field">
          <Label htmlFor="house-agent-shares">Virtual reference shares</Label>
          <Input id="house-agent-shares" type="number" min="1" step="1" inputMode="numeric" value={shares} onChange={(event) => setShares(event.target.value)} required />
          <span className="field-hint">Shares the put is sized to protect.</span>
        </div>
        <div className="field">
          <Label htmlFor="house-agent-capital">Paper capital (USD)</Label>
          <Input id="house-agent-capital" type="number" min="100" step="100" inputMode="numeric" value={capital} onChange={(event) => setCapital(event.target.value)} required />
          <span className="field-hint">Virtual cash that pays premiums.</span>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={busy || marketsLoading || symbols.length === 0}>{busy ? "Creating…" : "Create paper draft"}</Button>
      </form>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {!marketsLoading && symbols.length === 0 && !error ? <p className="form-hint">No active markets were returned, so a draft cannot be created right now.</p> : null}

      <div className="recipe-outline">
        <h3>What this recipe will run</h3>
        <ol>
          {stageSummary.map(([stage, hooks, text]) => (
            <li key={stage}>
              <span className="recipe-stage">{stage}</span>
              <span className="recipe-body"><span className="recipe-hooks">{hooks}</span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
