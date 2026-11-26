"use client";

import { useEffect, useState } from "react";
import { PublicHouseBacktestCampaignResponseSchema } from "../../lib/domain/contracts";
import type { PublicHouseBacktestCampaignResponse, PublicHouseBacktestRun } from "../../lib/domain/contracts";
import { formatPct, formatUsd, formatUtc, shortHash, signedTone } from "./format";
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

export function isValidHouseBacktestNoEntry(run: PublicHouseBacktestRun): boolean {
  return run.status === "failed" && run.entryOrderCount === 0 && run.exitOrderCount === 0 && run.metrics === null
    && run.hourlyCoverageComplete && run.reason.includes("no modeled entry fills");
}

function outcome(run: PublicHouseBacktestRun): string {
  if (run.status === "complete") return "Modeled entries";
  return isValidHouseBacktestNoEntry(run) ? "No modeled entry" : "Backtest failed";
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
  const state = useHouseBacktestCampaign();

  if (state.status === "loading") {
    return <div id="house-backtests"><StateBlock kind="loading" title="Loading historical House Agent backtests" /></div>;
  }
  if (state.status === "error") {
    return <div id="house-backtests"><StateBlock kind="error" title="Historical House backtests could not be loaded">Refresh the page to try again.</StateBlock></div>;
  }
  if (state.response.status !== "complete" || state.response.runs.length === 0) {
    return <div id="house-backtests"><StateBlock kind="empty" title="No published House backtest campaign">The results appear when the complete verified campaign is persisted.</StateBlock></div>;
  }

  const runs = [...state.response.runs].sort((left, right) => left.symbol.localeCompare(right.symbol) || left.agentLabel.localeCompare(right.agentLabel));
  return (
    <Panel id="house-backtests" className="house-backtests" aria-label="Historical House Agent backtests">
      <div className="panel-head">
        <div><p className="eyebrow">VERIFIED HISTORICAL REPLAY</p><h2>Historical House Agent backtests</h2></div>
        <Chip tone="azure">{runs.length} runs</Chip>
      </div>
      <p className="panel-lede">Historical model outcomes, not live performance. Where metrics exist, option premiums use a model with 50 bp slippage. Venue fees and historical option quotes are not included.</p>
      <p className="cell-sub">Campaign as of {formatUtc(state.response.asOf)}. Complete runs replay 720 hourly decisions after the verified warmup window.</p>
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
