"use client";

import { useEffect, useState } from "react";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";
import type { HouseCampaignMarketCoverage, PublicHouseBacktestCampaignResponse, PublicHouseBacktestRun } from "../../lib/domain/contracts";
import { formatPct, formatUsd, formatUtc, shortAddress, shortHash, signedTone } from "./format";
import { Chip, Panel, StateBlock } from "./ui";
import { compareMarketPriority } from "../../lib/market/market-priority";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; response: PublicHouseBacktestCampaignResponse };

function outcome(run: PublicHouseBacktestRun): string {
  if (run.status === "complete") return "Modeled entries";
  return run.entryOrderCount === 0 && run.reason.includes("no modeled entry fills") ? "No modeled entry" : "Backtest failed";
}

const marketStatusLabel: Record<HouseCampaignMarketCoverage["status"], string> = {
  qualified: "Qualified",
  insufficient_data: "Insufficient history",
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

function MarketCoverageTable({ markets }: { markets: HouseCampaignMarketCoverage[] }) {
  if (markets.length === 0) return null;
  const ordered = [...markets].sort((left, right) => compareMarketPriority(left.symbol, right.symbol) || left.symbol.localeCompare(right.symbol));
  const qualified = ordered.filter((market) => market.status === "qualified").length;
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
        <div><p className="eyebrow">FULL REGISTRY · HISTORICAL ELIGIBILITY</p><h3>Market-by-strategy coverage</h3></div>
        <Chip tone="azure">{qualified} / {ordered.length} qualified</Chip>
      </div>
      <p className="cell-sub">Each market was checked against consecutive closed candles, token multiplier provenance, and corporate-action history.</p>
      <details>
        <summary>View {ordered.length} markets across four House Agent strategies</summary>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">Historical data qualification and House Agent strategy outcomes for every supported market.</caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Historical data</th>
                {strategyOrder.map((strategy) => <th scope="col" key={strategy}>{strategyLabels[strategy]}</th>)}
              </tr>
            </thead>
            <tbody>
              {ordered.map((market) => (
                <tr key={market.symbol}>
                  <th scope="row">{market.symbol}<span className="cell-sub">{market.name}</span></th>
                  <td title={market.reason}>
                    <span>{marketStatusLabel[market.status]}</span>
                    <span className="cell-sub">{market.coverage.consecutiveHours} / {market.coverage.requiredSamples} consecutive hours</span>
                    <span className="cell-sub">{market.coverage.startAt && market.coverage.endAt ? `${formatUtc(market.coverage.startAt)} to ${formatUtc(market.coverage.endAt)}` : "No verified candle window"}</span>
                    <span className="cell-sub" title={market.registryTokenAddress ?? undefined}>Token {market.registryTokenAddress ? shortAddress(market.registryTokenAddress) : "unmapped"} · {market.currentMultiplier} shares/token</span>
                    <span className="cell-sub">{market.corporateActionCount} corporate actions · {market.coverage.multiplierStatus ?? "provenance unavailable"}</span>
                    {market.historyDataHash ? <span className="cell-sub" title={market.historyDataHash}>History {shortHash(market.historyDataHash)}</span> : null}
                  </td>
                  {strategyOrder.map((strategy) => {
                    const result = market.strategies[strategy];
                    return <td key={strategy} title={result.reason}><span>{strategyStatusLabel[result.status]}</span>{result.runId ? <span className="cell-sub">Run recorded</span> : null}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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

export function HouseBacktestResults() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/v1/house-backtests", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return PublicHouseBacktestCampaignResponseSchema.parse(await response.json());
      })
      .then((response) => setState({ status: "ready", response }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <StateBlock kind="loading" title="Loading historical House Agent backtests" />;
  }
  if (state.status === "error") {
    return <StateBlock kind="error" title="Historical House backtests could not be loaded">Refresh the page to try again.</StateBlock>;
  }
  if (state.response.status !== "complete" || state.response.runs.length === 0) {
    return <StateBlock kind="empty" title="No published House backtest campaign">The results appear when the complete verified campaign is persisted.</StateBlock>;
  }

  const runs = [...state.response.runs].sort((left, right) => compareMarketPriority(left.symbol, right.symbol) || left.symbol.localeCompare(right.symbol) || left.agentLabel.localeCompare(right.agentLabel));
  return (
    <Panel className="house-backtests" aria-label="Historical House Agent backtests">
      <div className="panel-head">
        <div><p className="eyebrow">VERIFIED HISTORICAL REPLAY</p><h2>Historical House Agent backtests</h2></div>
        <Chip tone="azure">{runs.length} runs</Chip>
      </div>
      <p className="panel-lede">Historical model outcomes, not live performance. Where metrics exist, option premiums use a model with 50 bp slippage. Venue fees and historical option quotes are not included.</p>
      <p className="cell-sub">Campaign as of {formatUtc(state.response.asOf)}. Complete runs replay 720 hourly decisions after the verified warmup window.</p>
      <MarketCoverageTable markets={state.response.marketCoverage} />
      <div className="table-scroll">
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
            {runs.map((run) => (
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
                  <span>{run.candleCount} / {run.requestedCandles} candles · {run.sampleCount} decisions</span>
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
