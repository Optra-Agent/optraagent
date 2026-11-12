"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AgentDetailSchema,
  AgentListResponseSchema,
  AgentSchema,
  ApiErrorSchema,
  BacktestCoverageSchema,
  BacktestRunSchema,
  MarketListSchema,
} from "../../../lib/domain/contracts";
import type { Agent, AgentDetail, BacktestCoverage, BacktestRun, MarketAsset } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";

function errorMessage(value: unknown): string {
  const parsed = ApiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.message : "The paper workflow is temporarily unavailable.";
}

async function jsonBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

export function LabScreen() {
  const { status } = useAuthSession();
  const [markets, setMarkets] = useState<MarketAsset[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [coverage, setCoverage] = useState<BacktestCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowMessage, setWorkflowMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(errorMessage(body));
        return MarketListSchema.parse(body);
      })
      .then(({ markets: result }) => {
        setMarkets(result);
        setSelectedSymbol((current) => current && result.some((market) => market.symbol === current)
          ? current
          : result.find((market) => market.symbol === "AAPL")?.symbol ?? result[0]?.symbol ?? "");
        setMarketsLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMarketError(reason instanceof Error ? reason.message : "Market list is unavailable.");
        setMarketsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedSymbol) return;
    const controller = new AbortController();
    void fetch(`/api/backtests/coverage?symbol=${encodeURIComponent(selectedSymbol)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(errorMessage(body));
        return BacktestCoverageSchema.parse(body);
      })
      .then((result) => {
        setCoverage(result);
        setCoverageLoading(false);
        setCoverageError("");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setCoverageError(reason instanceof Error ? reason.message : "Backtest coverage is unavailable.");
        setCoverageLoading(false);
      });
    return () => controller.abort();
  }, [selectedSymbol, refreshKey]);

  useEffect(() => {
    if (status !== "signed_in") return;
    const controller = new AbortController();
    void fetch("/api/agents", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(errorMessage(body));
        return AgentListResponseSchema.parse(body);
      })
      .then(({ agents: result }) => {
        const drafts = result.filter((agent) => agent.status === "draft" && agent.templateId === "protective_put");
        setAgents(drafts);
        setSelectedAgentId((current) => current && drafts.some((agent) => agent.id === current) ? current : drafts[0]?.id ?? "");
        setAgentsLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setWorkflowError(reason instanceof Error ? reason.message : "Your paper agents could not be loaded.");
        setAgentsLoading(false);
      });
    return () => controller.abort();
  }, [status]);

  useEffect(() => {
    if (!selectedAgentId || status !== "signed_in") return;
    const controller = new AbortController();
    void fetch(`/api/agents/${encodeURIComponent(selectedAgentId)}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(errorMessage(body));
        return AgentDetailSchema.parse(body);
      })
      .then(setSelectedAgent)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setWorkflowError(reason instanceof Error ? reason.message : "The selected agent could not be loaded.");
      });
    return () => controller.abort();
  }, [selectedAgentId, status]);

  function chooseSymbol(symbol: string) {
    setCoverage(null);
    setCoverageError("");
    setCoverageLoading(true);
    setRun(null);
    setSelectedSymbol(symbol);
  }

  function refreshCoverage() {
    setCoverage(null);
    setCoverageError("");
    setCoverageLoading(true);
    setRun(null);
    setRefreshKey((key) => key + 1);
  }

  async function createBacktest() {
    if (!selectedAgent || selectedAgent.id !== selectedAgentId || !coverage?.ready) return;
    setBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const response = await fetch("/api/backtests", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe: selectedAgent.recipe }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(errorMessage(body));
      const result = BacktestRunSchema.parse(body);
      setRun(result);
      setWorkflowMessage(result.reason);
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : "The backtest could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function launchAgent() {
    if (!selectedAgent || selectedAgent.id !== selectedAgentId || !run || run.status !== "complete") return;
    setBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgent.id)}/launch`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ backtestRunId: run.id }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(errorMessage(body));
      const launched = AgentSchema.parse(body);
      setWorkflowMessage(`Paper agent ${launched.name} is running. Open its agent page to run a paper tick and inspect Tape.`);
      setAgents((current) => current.filter((agent) => agent.id !== launched.id));
      setSelectedAgentId("");
      setSelectedAgent(null);
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : "The paper agent could not be launched.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-container">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">HISTORICAL REPLAY · PAPER</p>
          <h1>Lab</h1>
          <p className="page-description">Backtests replay closed Robinhood Chain hourly candles through the same rule engine used by paper ticks.</p>
        </div>
      </div>

      {marketsLoading ? <p role="status">Loading supported markets…</p> : null}
      {marketError ? <section className="state-panel" role="alert">{marketError}</section> : null}
      {!marketsLoading && !marketError && markets.length === 0 ? <section className="state-panel">No supported markets are available for a historical replay.</section> : null}

      {markets.length > 0 ? (
        <section className="state-panel lab-panel" aria-label="Backtest coverage">
          <div className="market-controls">
            <label htmlFor="lab-symbol">Underlying symbol</label>
            <select id="lab-symbol" value={selectedSymbol} onChange={(event) => chooseSymbol(event.target.value)}>
              {markets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol}</option>)}
            </select>
            <button className="button button-secondary" type="button" disabled={coverageLoading} onClick={refreshCoverage}>Refresh coverage</button>
          </div>
          {coverageLoading ? <p role="status">Checking source-backed hourly history…</p> : null}
          {coverageError ? <p role="alert">{coverageError}</p> : null}
          {coverage ? (
            <>
              <div className="coverage-count"><strong>{coverage.availableSamples} / {coverage.requiredSamples} verified hourly candles</strong><span>{coverage.ready ? "Coverage ready" : "Backtest blocked"}</span></div>
              <p>{coverage.reason}</p>
              <dl className="market-grid">
                <div><dt>Consecutive UTC hours</dt><dd>{coverage.consecutiveHours}</dd></div>
                <div><dt>Premium method</dt><dd>Black–Scholes · RV30 × 1.1 · modeled</dd></div>
                <div><dt>First candle</dt><dd>{coverage.startAt ?? "No candles"}</dd></div>
                <div><dt>Latest closed candle</dt><dd>{coverage.endAt ?? "No candles"}</dd></div>
              </dl>
            </>
          ) : null}

          {status === "signed_out" ? <p>Connect a wallet to create and launch your paper backtest.</p> : null}
          {status === "signed_in" ? (
            <div className="market-controls">
              <label htmlFor="lab-agent">Protective Put draft</label>
              <select id="lab-agent" value={selectedAgentId} onChange={(event) => { setSelectedAgentId(event.target.value); setRun(null); setWorkflowError(""); }} disabled={agentsLoading || agents.length === 0}>
                {agents.length === 0 ? <option value="">No Protective Put drafts</option> : null}
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.recipeHash.slice(0, 18)}</option>)}
              </select>
              <button className="button button-primary" type="button" disabled={busy || agentsLoading || !selectedAgent || !coverage?.ready} onClick={() => void createBacktest()}>
                {busy ? "Working…" : "Run paper backtest"}
              </button>
              {agents.length === 0 && !agentsLoading ? <Link className="button button-secondary" href="/agents">Create a Protective Put draft</Link> : null}
            </div>
          ) : null}

          {run ? (
            <section className="state-panel lab-result" aria-label="Backtest result">
              <div className="market-status-row"><h2>Backtest {run.status.replaceAll("_", " ")}</h2><span>{run.entryOrderCount ?? 0} modeled entries</span></div>
              <p>{run.reason}</p>
              {run.metrics ? <dl className="market-grid">
                <div><dt>Total return</dt><dd>{run.metrics.totalReturnPct}%</dd></div>
                <div><dt>Maximum drawdown</dt><dd>{run.metrics.maxDrawdownPct}%</dd></div>
                <div><dt>Ending cash</dt><dd>${run.metrics.endingCashUsd}</dd></div>
                <div><dt>History hash</dt><dd>{run.historyDataHash}</dd></div>
              </dl> : <p>No performance metrics were produced.</p>}
              {run.status === "complete" ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void launchAgent()}>{busy ? "Launching…" : "Launch paper agent"}</button> : null}
            </section>
          ) : null}
          {workflowMessage ? <p role="status">{workflowMessage}</p> : null}
          {workflowError ? <p role="alert">{workflowError}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
