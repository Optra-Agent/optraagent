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
import { formatPct, formatUsd, formatUtc, shortHash, signedTone, errorText } from "../format";
import { Chip, JourneyRail, PageHeader, Skeleton, StateBlock, Panel } from "../ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BenchmarkComparison } from "./BenchmarkComparison";
import { modelAssumptions, type HouseTemplateId } from "../agents/house-meta";
import { HouseBacktestResults } from "../HouseBacktestResults";
import { prioritizeMarkets } from "../../../lib/market/market-priority";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function errorMessage(value: unknown): string {
  const parsed = ApiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.message : "The paper workflow is temporarily unavailable.";
}

async function jsonBody(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

const multiplierLabel: Record<NonNullable<BacktestCoverage["multiplierStatus"]>, string> = {
  stable_verified: "Stable and verified",
  action_in_window: "Corporate action in window",
  unverified: "Unverified",
};

/** The saved draft's own settings (read from its recipe), so the strategy tested here is visibly the one that was saved. */
function draftParameters(parameters: Record<string, unknown>): Array<[string, string]> {
  const group = (key: string) => (parameters[key] ?? {}) as Record<string, unknown>;
  const rows: Array<[string, unknown, string]> = [
    ["Reference shares", parameters.protectedShares ?? parameters.referenceShares, ""],
    ["Paper capital", parameters.initialCapitalUsd, " USD"],
    ["Strike distance", group("percy").otmPct, "% OTM"],
    ["Model expiry", group("tenora").targetDTE, " days"],
    ["Max premium", group("capra").maxPremiumPctHolding, "% of holding"],
  ];
  return rows.flatMap(([label, value, unit]) => typeof value === "string" || typeof value === "number" ? [[label, `${value}${unit}`] as [string, string]] : []);
}

export function LabScreen({ initialAgentId = "" }: { initialAgentId?: string }) {
  const { status, setWalletMenuOpen } = useAuthSession();
  const [markets, setMarkets] = useState<MarketAsset[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [coverage, setCoverage] = useState<BacktestCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [launched, setLaunched] = useState<Agent | null>(null);
  const [busy, setBusy] = useState<"" | "backtest" | "launch">("");
  const [workflowError, setWorkflowError] = useState("");
  const agentsLoading = status === "signed_in" && !agentsLoaded;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await jsonBody(response);
        if (!response.ok) throw new Error(errorMessage(body));
        return MarketListSchema.parse(body);
      })
      .then(({ markets: result }) => {
        const orderedMarkets = prioritizeMarkets(result);
        setMarkets(orderedMarkets);
        setSelectedSymbol((current) => current && result.some((market) => market.symbol === current)
          ? current
          : orderedMarkets.find((market) => market.symbol === "AAPL")?.symbol ?? orderedMarkets[0]?.symbol ?? "");
        setMarketsLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMarketError(errorText(reason, "Market list is unavailable."));
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
        setCoverageError(errorText(reason, "Backtest coverage is unavailable."));
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
        const drafts = result.filter((agent) => agent.status === "draft");
        setAgents(drafts);
        setSelectedAgentId((current) => current && drafts.some((agent) => agent.id === current)
          ? current
          : drafts.find((agent) => agent.id === initialAgentId)?.id ?? drafts[0]?.id ?? "");
        setAgentsLoaded(true);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setWorkflowError(errorText(reason, "Your paper agents could not be loaded."));
        setAgentsLoaded(true);
      });
    return () => controller.abort();
  }, [status, initialAgentId]);

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
        if (!controller.signal.aborted) setWorkflowError(errorText(reason, "The selected agent could not be loaded."));
      });
    return () => controller.abort();
  }, [selectedAgentId, status]);

  // A draft's recipe pins its own underlying: follow it so coverage and backtest always agree.
  const agentSymbol = selectedAgent && selectedAgent.id === selectedAgentId ? selectedAgent.recipe.underlyingSymbol : "";
  useEffect(() => {
    if (!agentSymbol || agentSymbol === selectedSymbol || !markets.some((market) => market.symbol === agentSymbol)) return;
    const timer = window.setTimeout(() => {
      setCoverage(null);
      setCoverageError("");
      setCoverageLoading(true);
      setRun(null);
      setSelectedSymbol(agentSymbol);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [agentSymbol, selectedSymbol, markets]);

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

  const agentMatchesCoverage = Boolean(agentSymbol) && coverage?.symbol === agentSymbol;

  async function createBacktest() {
    if (!selectedAgent || selectedAgent.id !== selectedAgentId || !coverage?.ready || !agentMatchesCoverage) return;
    setBusy("backtest");
    setWorkflowError("");
    try {
      const response = await fetch("/api/backtests", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipe: selectedAgent.recipe }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(errorMessage(body));
      setRun(BacktestRunSchema.parse(body));
    } catch (reason) {
      setWorkflowError(errorText(reason, "The backtest could not be created."));
    } finally {
      setBusy("");
    }
  }

  async function launchAgent() {
    if (!selectedAgent || selectedAgent.id !== selectedAgentId || !run || run.status !== "complete") return;
    setBusy("launch");
    setWorkflowError("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(selectedAgent.id)}/launch`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ backtestRunId: run.id }),
      });
      const body = await jsonBody(response);
      if (!response.ok) throw new Error(errorMessage(body));
      const agent = AgentSchema.parse(body);
      setLaunched(agent);
      setAgents((current) => current.filter((item) => item.id !== agent.id));
      setSelectedAgentId("");
      setSelectedAgent(null);
    } catch (reason) {
      setWorkflowError(errorText(reason, "The paper agent could not be launched."));
    } finally {
      setBusy("");
    }
  }

  const draftTemplate = (selectedAgent?.id === selectedAgentId ? selectedAgent.templateId : agents.find((agent) => agent.id === selectedAgentId)?.templateId) ?? "protective_put";
  const assumptions = modelAssumptions[(draftTemplate in modelAssumptions ? draftTemplate : "protective_put") as HouseTemplateId];
  const draftLabel = draftTemplate === "custom" ? "Custom agent" : draftTemplate.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const progress = coverage ? Math.min(100, Math.round((coverage.availableSamples / coverage.requiredSamples) * 100)) : 0;
  const journeyStep = launched ? 5 : run?.status === "complete" ? 4 : 3;
  const runBlockedReason = !coverage?.ready
    ? "Coverage is not ready for this symbol."
    : !selectedAgent ? "Select a paper agent draft first."
    : !agentMatchesCoverage ? "Loading the draft's underlying…" : "";

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="HISTORICAL REPLAY · PAPER"
        title="Lab"
        description="Backtests replay closed Robinhood Chain hourly candles through the same rule engine used by paper ticks. Premiums are modeled, not recorded."
      />
      <JourneyRail step={journeyStep} />

      {marketsLoading ? <StateBlock kind="loading" title="Loading supported markets…" /> : null}
      {marketError ? <StateBlock kind="error" title="Markets unavailable"><p>{marketError}</p></StateBlock> : null}
      {!marketsLoading && !marketError && markets.length === 0 ? <StateBlock kind="empty" title="No markets">No supported markets are available for a historical replay.</StateBlock> : null}

      {markets.length > 0 ? (
        <div className="lab-layout">
          <Panel className="lab-panel" aria-label="Backtest coverage">
            <div className="panel-head"><div><p className="eyebrow">1 · DATA COVERAGE</p><h2>Source-backed history</h2></div></div>
            <div className="control-row">
              <div className="field field-inline">
                <Label htmlFor="lab-symbol">Underlying symbol</Label>
                <Select value={selectedSymbol} onValueChange={chooseSymbol} disabled={Boolean(agentSymbol)}>
                  <SelectTrigger id="lab-symbol" className="w-full" aria-describedby={agentSymbol ? "lab-symbol-note" : undefined}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {markets.map((market) => <SelectItem key={market.symbol} value={market.symbol}>{market.symbol}</SelectItem>)}
                  </SelectContent>
                </Select>
                {agentSymbol ? <span className="field-hint" id="lab-symbol-note">Pinned to the selected draft&apos;s underlying.</span> : null}
              </div>
              <Button variant="outline" type="button" disabled={coverageLoading} onClick={refreshCoverage}>Refresh coverage</Button>
            </div>
            {coverageLoading ? <div role="status"><Skeleton lines={3} /></div> : null}
            {coverageError ? <p className="form-error" role="alert">{coverageError}</p> : null}
            {coverage ? (
              <>
                <div className="coverage-count">
                  <strong className="mono">{coverage.availableSamples} / {coverage.requiredSamples} verified hourly candles</strong>
                  <span className={coverage.ready ? "coverage-state coverage-ready" : "coverage-state coverage-blocked"}>{coverage.ready ? "Coverage ready" : "Backtest blocked"}</span>
                </div>
                <div className="meter" role="img" aria-label={`${progress}% of the required candles are available`}><span style={{ width: `${progress}%` }} /></div>
                <p className="coverage-reason">{coverage.reason}</p>
                <dl className="kv">
                  <div><dt>Consecutive UTC hours</dt><dd className="mono">{coverage.consecutiveHours}</dd></div>
                  <div><dt>Premium method</dt><dd>Black–Scholes · RV30 × 1.1 · modeled</dd></div>
                  <div><dt>First candle</dt><dd className="mono">{coverage.startAt ? formatUtc(coverage.startAt) : "No candles"}</dd></div>
                  <div><dt>Latest closed candle</dt><dd className="mono">{coverage.endAt ? formatUtc(coverage.endAt) : "No candles"}</dd></div>
                  {coverage.multiplierStatus ? <div><dt>Token multiplier</dt><dd>{multiplierLabel[coverage.multiplierStatus]}</dd></div> : null}
                  {coverage.dataSource ? <div><dt>Source</dt><dd className="mono">{coverage.dataSource}</dd></div> : null}
                </dl>
              </>
            ) : null}
            <div className="assumptions">
              <h3>Model assumptions</h3>
              <ul>
                {assumptions.map((line) => <li key={line}>{line}</li>)}
                {assumptions === modelAssumptions.protective_put ? null : <li>No historical option chain, implied volatility or listed-contract guarantee exists in this data.</li>}
              </ul>
            </div>
          </Panel>

          <Panel className="lab-panel" aria-label="Backtest and launch">
            <div className="panel-head"><div><p className="eyebrow">2 · BACKTEST AND LAUNCH</p><h2>Run the draft</h2></div><Chip tone="ember">Modeled premiums</Chip></div>

            {status === "loading" ? <div role="status"><Skeleton lines={2} /></div> : null}
            {status === "signed_out" ? (
              <>
                <p>Connect a wallet to create and launch your paper backtest.</p>
                <Button variant="outline" type="button" onClick={() => { setWalletMenuOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Choose a wallet</Button>
              </>
            ) : null}
            {status === "error" ? <p className="form-error" role="alert">Wallet session could not be checked. Retry from the header.</p> : null}

            {status === "signed_in" ? (
              <>
                <div className="field">
                  <Label htmlFor="lab-agent">Paper agent draft</Label>
                  <Select value={selectedAgentId} onValueChange={(value) => { setSelectedAgentId(value); setSelectedAgent(null); setRun(null); setWorkflowError(""); }} disabled={agentsLoading || agents.length === 0}>
                    <SelectTrigger id="lab-agent" className="w-full">
                      <SelectValue placeholder={agentsLoading ? "Loading drafts…" : "No paper agent drafts"} />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name} · {agent.recipeHash.slice(0, 18)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {!agentsLoading && agents.length === 0 && !launched ? (
                  <p className="form-hint">Backtests run against a saved draft. <Link href="/agents#configure">Create a paper agent draft</Link> first.</p>
                ) : null}
                {selectedAgent && selectedAgent.id === selectedAgentId && !launched ? (
                  <div className="draft-summary" role="group" aria-label="Selected draft">
                    <dl className="kv kv-tight">
                      <div><dt>Strategy</dt><dd>{draftLabel} · {selectedAgent.recipe.underlyingSymbol}</dd></div>
                      {draftParameters(selectedAgent.recipe.parameters).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>)}
                    </dl>
                    <Link className={buttonVariants({ variant: "outline" })} href={`/agents/${encodeURIComponent(selectedAgent.id)}`}>Back to this draft</Link>
                  </div>
                ) : null}
                <div className="action-row">
                  <Button  type="button" aria-describedby={runBlockedReason ? "run-blocked" : undefined} disabled={busy !== "" || agentsLoading || Boolean(runBlockedReason) || Boolean(launched)} onClick={() => void createBacktest()}>
                    {busy === "backtest" ? "Replaying 720 decisions…" : "Run paper backtest"}
                  </Button>
                  {runBlockedReason && agents.length > 0 ? <span className="action-note" id="run-blocked">{runBlockedReason}</span> : null}
                </div>
              </>
            ) : null}

            {run ? (
              <section className="lab-result" aria-label="Backtest result">
                <div className="panel-head">
                  <h3>Backtest {run.status.replaceAll("_", " ")}</h3>
                  <Chip tone={run.status === "complete" ? "azure" : "ember"}>{run.entryOrderCount ?? 0} modeled entries</Chip>
                </div>
                <p>{run.reason}</p>
                {run.metrics ? (
                  <dl className="metric-row">
                    <div className="metric"><dt>Total return</dt><dd className={`mono pnl pnl-${signedTone(run.metrics.totalReturnPct)}`} title={`${run.metrics.totalReturnPct}%`}>{formatPct(run.metrics.totalReturnPct)}</dd></div>
                    <div className="metric"><dt>Maximum drawdown</dt><dd className="mono pnl pnl-loss" title={`-${run.metrics.maxDrawdownPct}%`}>{formatPct(`-${run.metrics.maxDrawdownPct}`)}</dd></div>
                    <div className="metric"><dt>Ending cash</dt><dd className="mono">{formatUsd(run.metrics.endingCashUsd)}</dd></div>
                  </dl>
                ) : <p className="form-hint">No performance metrics were produced.</p>}
                {run.metrics?.strategy ? (
                  <dl className="kv kv-tight" aria-label="Strategy counters">
                    <div><dt>Premium collected</dt><dd className="mono">{formatUsd(run.metrics.strategy.premiumCollectedUsd)}</dd></div>
                    <div><dt>Premium paid</dt><dd className="mono">{formatUsd(run.metrics.strategy.premiumPaidUsd)}</dd></div>
                    <div><dt>Closes (winning)</dt><dd className="mono">{run.metrics.strategy.closes} ({run.metrics.strategy.winningCloses})</dd></div>
                    <div><dt>Settled ITM / OTM</dt><dd className="mono">{run.metrics.strategy.settledItm} / {run.metrics.strategy.settledOtm}</dd></div>
                    <div><dt>Rolls</dt><dd className="mono">{run.metrics.strategy.rolls}</dd></div>
                    {run.metrics.strategy.worstTradeUsd !== null ? <div><dt>Worst trade</dt><dd className={`mono pnl pnl-${signedTone(run.metrics.strategy.worstTradeUsd)}`}>{formatUsd(run.metrics.strategy.worstTradeUsd)}</dd></div> : null}
                  </dl>
                ) : null}
                <dl className="kv kv-tight">
                  <div><dt>Decisions replayed</dt><dd className="mono">{run.sampleCount}</dd></div>
                  <div><dt>Entries / exits</dt><dd className="mono">{run.entryOrderCount ?? 0} / {run.exitOrderCount ?? 0}</dd></div>
                  <div className="kv-wide"><dt>Window</dt><dd className="mono">{formatUtc(run.startAt)} to {formatUtc(run.endAt)}</dd></div>
                  {run.historyDataHash ? <div><dt>History hash</dt><dd className="mono" title={run.historyDataHash}>{shortHash(run.historyDataHash, 16, 8)}</dd></div> : null}
                </dl>
                {run.metrics ? <BenchmarkComparison metrics={run.metrics} strategyLabel={draftLabel} /> : <p className="panel-note">No metrics, so no benchmark comparison. Treat any result as a model result, not a forecast.</p>}
                {run.status === "complete" && !launched ? (
                  <div className="action-row">
                    <Button  type="button" disabled={busy !== ""} onClick={() => void launchAgent()}>{busy === "launch" ? "Launching…" : "Launch paper agent"}</Button>
                    <span className="action-note">Launch attaches this exact backtest to the draft.</span>
                  </div>
                ) : null}
              </section>
            ) : null}

            {launched ? (
              <section className="launch-success" role="status">
                <h3>Paper agent running</h3>
                <p>{launched.name} is live on paper. Open it to run a paper tick, then inspect the Tape.</p>
                <div className="action-row">
                  <Link className={buttonVariants({ variant: "default" })} href={`/agents/${encodeURIComponent(launched.id)}`}>Open agent and run a tick</Link>
                  <Link className={buttonVariants({ variant: "outline" })} href={`/tape?agentId=${encodeURIComponent(launched.id)}`}>Open Tape</Link>
                </div>
              </section>
            ) : null}
            {workflowError ? <p className="form-error" role="alert">{workflowError}</p> : null}
          </Panel>
        </div>
      ) : null}
      <HouseBacktestResults />
    </main>
  );
}
