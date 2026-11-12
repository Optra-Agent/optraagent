"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AgentDetailSchema, ApiErrorSchema, MarketListSchema } from "../../../lib/domain/contracts";
import { buildProtectivePutRecipe } from "../../../lib/hooks/catalog";

function responseError(body: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : fallback;
}

export function HouseAgentCreator() {
  const router = useRouter();
  const [symbols, setSymbols] = useState<string[]>([]);
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
        if (nextSymbols.length) setSymbol((current) => nextSymbols.includes(current) ? current : nextSymbols.includes("AAPL") ? "AAPL" : nextSymbols[0]!);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Market list is temporarily unavailable.");
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
      setError(reason instanceof Error ? reason.message : "Paper agent could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="state-panel" aria-label="Create Protective Put House Agent">
      <div className="market-status-row"><div><p className="eyebrow">HOUSE AGENT · PAPER</p><h2>Protective Put</h2></div><span className="template-badge template-badge-paper_ready">Paper ready</span></div>
      <p>Creates one deterministic model recipe. Reference shares are virtual simulation inputs and are not read from or locked in your wallet.</p>
      <form className="market-controls" onSubmit={(event) => void createDraft(event)}>
        <label htmlFor="house-agent-symbol">Underlying</label>
        <select id="house-agent-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={busy || symbols.length === 0}>
          {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label htmlFor="house-agent-shares">Virtual reference shares</label>
        <input id="house-agent-shares" type="number" min="1" step="1" value={shares} onChange={(event) => setShares(event.target.value)} required />
        <label htmlFor="house-agent-capital">Paper capital (USD)</label>
        <input id="house-agent-capital" type="number" min="100" step="100" value={capital} onChange={(event) => setCapital(event.target.value)} required />
        <button className="button button-primary" type="submit" disabled={busy || symbols.length === 0}>{busy ? "Creating…" : "Create paper draft"}</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
