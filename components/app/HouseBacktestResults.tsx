"use client";

import { useEffect, useState } from "react";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";
import type { HouseCampaignMarketCoverage, PublicHouseBacktestCampaignResponse, PublicHouseBacktestRun } from "../../lib/domain/contracts";
import { compareMarketPriority } from "../../lib/market/market-priority";
import { formatPct, formatUsd, formatUtc, shortAddress, shortHash, signedTone } from "./format";
import { Chip, Panel, StateBlock } from "./ui";

export type HouseBacktestCampaignState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; response: PublicHouseBacktestCampaignResponse };

export function useHouseBacktestCampaign(enabled = true): HouseBacktestCampaignState {
  const [state, setState] = useState<HouseBacktestCampaignState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch("/api/public/v1/house-backtests", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return PublicHouseBacktestCampaignResponseSchema.parse(await response.json());
      })
      .then((response) => setState({ status: "ready", response }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [enabled]);

  return state;
}

export function isSimulatedRun(run: Pick<PublicHouseBacktestRun, "dataSource">): boolean {
  return run.dataSource === "synthetic_deterministic_scenario";
}

export function isValidHouseBacktestNoEntry(run: PublicHouseBacktestRun): boolean {
  return run.status === "failed" && run.entryOrderCount === 0 && run.exitOrderCount === 0 && run.metrics === null
    && (run.hourlyCoverageComplete || run.sampleCount >= 168) && run.reason.includes("no modeled entry fills");
}

function outcome(run: PublicHouseBacktestRun): string {
  if (run.status === "complete") return isSimulatedRun(run) ? "Simulated entries" : "Modeled entries";
  return isValidHouseBacktestNoEntry(run) ? "No modeled entry" : "Backtest failed";
}

const marketStatusLabel: Record<HouseCampaignMarketCoverage["status"], string> = {
  qualified: "Verified Historical",
  simulated: "Simulated Scenario",
  insufficient_data: "Limited hourly history",
  corporate_action: "Corporate-action review",
  unverified: "Source unverified",
  provider_error: "Provider unavailable",
};

const strategyStatusLabel: Record<HouseCampaignMarketCoverage["strategies"]["protective_put"]["status"], string> = {
  complete: "Backtested",
  no_entry: "No entry",
  insufficient_data: "Incomplete history",
  incompatible: "Not compatible",
  error: "Run error",
};

type CoverageFilter = "all" | "qualified" | "simulated";

function MarketCoverageTable({ markets }: { markets: HouseCampaignMarketCoverage[] }) {
  const [filter, setFilter] = useState<CoverageFilter>("all");
  if (markets.length === 0) return null;

  const ordered = [...markets].sort((left, right) => {
    const leftVerified = left.status === "qualified" ? 0 : 1;
    const rightVerified = right.status === "qualified" ? 0 : 1;
    return leftVerified - rightVerified || compareMarketPriority(left.symbol, right.symbol) || left.symbol.localeCompare(right.symbol);
  });
  const qualifiedCount = ordered.filter((market) => market.status === "qualified").length;
  const simulatedCount = ordered.filter((market) => market.status === "simulated").length;
  const shown = ordered.filter((market) => (filter === "all" ? true : market.status === filter));
  const strategyOrder = ["protective_put", "covered_call", "cash_secured_put", "earnings_straddle"] as const;
  const strategyLabels = {
    protective_put: "Protective Put",
    covered_call: "Covered Call",
    cash_secured_put: "Cash-Secured Put",
    earnings_straddle: "Earnings Straddle",
  } as const;

  return (
    <section className="market-coverage" aria-label="Market-by-strategy coverage">
      <div className="panel-head">
        <div>
          <p className="eyebrow">FULL REGISTRY · 205-MARKET STRATEGY MATRIX</p>
          <h3>Market-by-strategy results</h3>
        </div>
        <div className="coverage-tabs" role="tablist" aria-label="Filter markets by data provenance">
          <button type="button" role="tab" aria-selected={filter === "all"} className="coverage-tab" onClick={() => setFilter("all")}>All ({ordered.length})</button>
          <button type="button" role="tab" aria-selected={filter === "qualified"} className="coverage-tab" onClick={() => setFilter("qualified")}>Verified Historical ({qualifiedCount})</button>
          {simulatedCount > 0 ? (
            <button type="button" role="tab" aria-selected={filter === "simulated"} className="coverage-tab" onClick={() => setFilter("simulated")}>Simulated ({simulatedCount})</button>
          ) : null}
        </div>
      </div>
      <p className="cell-sub">
        Verified markets use consecutive Robinhood Chain candles from Crius; simulated markets run the same strategy engine over deterministic synthetic scenarios where full historical candles are unavailable.
      </p>
      <div className="table-scroll coverage-scroll">
        <table className="data-table">
          <caption className="sr-only">Historical and simulated strategy evaluation outcomes across all Robinhood Chain markets.</caption>
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Provenance</th>
              <th scope="col">Candles</th>
              {strategyOrder.map((key) => <th key={key} scope="col">{strategyLabels[key]}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((market) => (
              <tr key={market.symbol}>
                <th scope="row">
                  {market.symbol}
                  <span className="cell-sub">{market.registryTokenAddress ? shortAddress(market.registryTokenAddress) : "No token"} · ×{Number(market.currentMultiplier).toFixed(4)}</span>
                </th>
                <td>
                  <Chip tone={market.status === "qualified" ? "azure" : undefined}>{marketStatusLabel[market.status]}</Chip>
                  <span className="cell-sub">{market.reason}</span>
                </td>
                <td className="mono">{market.status === "simulated" ? "1441 / 1441 (sim)" : `${market.coverage.consecutiveHours} / ${market.coverage.requiredSamples}`}</td>
                {strategyOrder.map((key) => {
                  const item = market.strategies[key];
                  return (
                    <td key={key} title={item.reason}>
                      <span>{strategyStatusLabel[item.status]}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReturnCell({ run }: { run: PublicHouseBacktestRun }) {
  if (!run.metrics) return <span>No performance metrics</span>;
  return <span className={`mono pnl pnl-${signedTone(run.metrics.totalReturnPct)}`} title={`${run.metrics.totalReturnPct}%`}>{formatPct(run.metrics.totalReturnPct)}</span>;
}

function DrawdownCell({ run }: { run: PublicHouseBacktestRun }) {
  if (!run.metrics) return <span>No performance metrics</span>;
  const value = `-${run.metrics.maxDrawdownPct}`;
  return <span className="mono pnl pnl-loss" title={`${value}%`}>{formatPct(value)}</span>;
}

export function HouseBacktestResults({ runningWalletAgents = 0 }: { runningWalletAgents?: number } = {}) {
  const state = useHouseBacktestCampaign();
  const [runScope, setRunScope] = useState<"verified" | "simulated">("verified");

  if (state.status === "loading") {
    return <div id="house-backtests"><StateBlock kind="loading" title="Loading historical House Agent backtests" /></div>;
  }
  if (state.status === "error") {
    return <div id="house-backtests"><StateBlock kind="error" title="Historical House backtests could not be loaded">Refresh the page to try again.</StateBlock></div>;
  }
  if (state.response.status !== "complete" || state.response.runs.length === 0) {
    return <div id="house-backtests"><StateBlock kind="empty" title="No published House backtest campaign">The results appear when the complete verified campaign is persisted.</StateBlock></div>;
  }

  const allRuns = state.response.runs;
  const verifiedRuns = allRuns.filter((run) => !isSimulatedRun(run));
  const simulatedRuns = allRuns.filter((run) => isSimulatedRun(run));
  const activeRuns = [...(runScope === "verified" ? verifiedRuns : simulatedRuns)].sort(
    (left, right) => compareMarketPriority(left.symbol, right.symbol) || left.symbol.localeCompare(right.symbol) || left.agentLabel.localeCompare(right.agentLabel),
  );

  const coverage = state.response.marketCoverage;
  const totalMarkets = coverage.length || new Set(allRuns.map((run) => run.symbol)).size;
  const verifiedMarketsCount = coverage.length
    ? coverage.filter((market) => market.status === "qualified").length
    : new Set(verifiedRuns.map((run) => run.symbol)).size;
  const simulatedMarketsCount = coverage.length
    ? coverage.filter((market) => market.status === "simulated").length
    : new Set(simulatedRuns.map((run) => run.symbol)).size;
  const marketsTested = coverage.length
    ? coverage.filter((market) => market.status === "qualified" || market.status === "simulated").length
    : new Set(allRuns.map((run) => run.symbol)).size;
  const coveragePct = totalMarkets > 0 ? Math.round((marketsTested / totalMarkets) * 100) : 0;
  const totalRunningPaper = 4 + runningWalletAgents;

  return (
    <Panel className="house-backtests" aria-label="Historical House Agent backtests">
      <div id="house-backtests" className="panel-head">
        <div><p className="eyebrow">FULL REGISTRY · VERIFIED &amp; SIMULATED COVERAGE</p><h2>Historical House Agent backtests</h2></div>
        <Chip tone="azure">{allRuns.length} evaluations</Chip>
      </div>
      <div className="coverage-kpis" aria-label="Market coverage summary">
        <div className="coverage-kpi"><span>Total Markets</span><strong className="mono">{totalMarkets}</strong></div>
        <div className="coverage-kpi"><span>Markets Tested</span><strong className="mono">{marketsTested}</strong><small>{verifiedMarketsCount} verified · {simulatedMarketsCount} simulated</small></div>
        <div className="coverage-kpi"><span>Strategy Evaluations</span><strong className="mono">{allRuns.length}</strong><small>{verifiedRuns.length} verified · {simulatedRuns.length} simulated</small></div>
        <div className="coverage-kpi"><span>Market Coverage</span><strong className="mono">{coveragePct}%</strong><small>{marketsTested} / {totalMarkets} active tokens</small></div>
        <div className="coverage-kpi"><span>Running Paper Agents</span><strong className="mono">{totalRunningPaper}</strong><small>4 House · {runningWalletAgents} wallet</small></div>
      </div>
      <p className="panel-lede">Historical model outcomes and deterministic scenario simulations, not live performance. Option premiums use a Black–Scholes model with 50 bp slippage; venue fees and historical option quotes are not included.</p>
      <p className="cell-sub">Campaign as of {formatUtc(state.response.asOf)}. Full verified runs replay 720 hourly decisions after the 721-hour RV30 warmup; shorter verified windows and synthetic scenarios are explicitly labeled.</p>
      <MarketCoverageTable markets={state.response.marketCoverage} />
      <div className="panel-head" style={{ marginTop: 18 }}>
        <div><p className="eyebrow">PER-RUN TELEMETRY &amp; PROVENANCE</p><h3>Strategy evaluation runs</h3></div>
        {simulatedRuns.length > 0 ? (
          <div className="coverage-tabs" role="tablist" aria-label="Select run provenance">
            <button type="button" role="tab" aria-selected={runScope === "verified"} className="coverage-tab" onClick={() => setRunScope("verified")}>Verified Historical ({verifiedRuns.length})</button>
            <button type="button" role="tab" aria-selected={runScope === "simulated"} className="coverage-tab" onClick={() => setRunScope("simulated")}>Simulated Scenarios ({simulatedRuns.length})</button>
          </div>
        ) : null}
      </div>
      <div className="table-scroll coverage-scroll">
        <table className="data-table">
          <caption className="sr-only">Historical modeled results and source hashes for OPTRA House Agents.</caption>
          <thead>
            <tr>
              <th scope="col">Strategy</th>
              <th scope="col">Symbol</th>
              <th scope="col">Outcome</th>
              <th scope="col">Return</th>
              <th scope="col">Max drawdown</th>
              <th scope="col">Ending cash</th>
              <th scope="col">Entries</th>
              <th scope="col">Coverage and provenance</th>
            </tr>
          </thead>
          <tbody>
            {activeRuns.map((run) => (
              <tr key={run.id}>
                <th scope="row">
                  {run.agentLabel}
                  <span className="cell-sub">{formatUtc(run.startAt)} to {formatUtc(run.endAt)}</span>
                </th>
                <td>{run.symbol}</td>
                <td>{outcome(run)}</td>
                <td><ReturnCell run={run} /></td>
                <td><DrawdownCell run={run} /></td>
                <td className="mono">{run.metrics ? formatUsd(run.metrics.endingCashUsd) : "No performance metrics"}</td>
                <td className="mono">{run.entryOrderCount}</td>
                <td>
                  <span>{run.candleCount} / {run.requestedCandles} candles · {run.sampleCount} decisions{isSimulatedRun(run) ? " (simulated)" : run.hourlyCoverageComplete ? "" : " (shorter verified window)"}</span>
                  <span className="cell-sub">Source {run.dataSource}</span>
                  <span className="cell-sub" title={run.historyDataHash}>History {shortHash(run.historyDataHash)}</span>
                  <span className="cell-sub" title={run.candleSnapshotHash}>Snapshot {shortHash(run.candleSnapshotHash)}</span>
                  {run.earningsEventsHash ? <span className="cell-sub" title={run.earningsEventsHash}>Earnings {shortHash(run.earningsEventsHash)}</span> : <span className="cell-sub">Earnings snapshot unavailable</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
