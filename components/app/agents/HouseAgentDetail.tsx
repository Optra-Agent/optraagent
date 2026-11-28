"use client";

import Link from "next/link";
import { AgentEconomicsSection } from "../economics/AgentEconomicsSection";
import { AgentVerificationSection } from "../verification/AgentVerificationSection";
import { useEffect, useState } from "react";
import { ApiErrorSchema, PublicHouseAgentDetailSchema } from "../../../lib/domain/contracts";
import type { PublicHouseAgentDetail } from "../../../lib/domain/contracts";
import { buttonVariants } from "@/components/ui/button";
import { AgentCharacter } from "../../marketing/characters";
import { errorText, formatPct, formatPts, formatUsd, formatUtc, shortHash, signedTone, titleCase } from "../format";
import { OrdersTable, PositionGrid, TapeList } from "../paper";
import { Chip, Panel, StateBlock } from "../ui";
import { modelAssumptions, stageSummaries, strategyLine, type HouseTemplateId } from "./house-meta";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: PublicHouseAgentDetail };

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div><dt>{label}</dt><dd className={`mono${tone ? ` pnl pnl-${tone}` : ""}`}>{value}</dd></div>;
}

function scalar(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

/** Real recipe values, one row per rule group, so the configuration shown is exactly what the agent runs. */
function configurationRows(parameters: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(parameters)) {
    const single = scalar(value);
    if (single !== null) { rows.push([titleCase(key.replace(/([A-Z])/g, " $1").toLowerCase()), single]); continue; }
    if (!value || typeof value !== "object" || Array.isArray(value) || key === "paperModel") continue;
    const parts = Object.entries(value as Record<string, unknown>).flatMap(([name, item]) => { const text = scalar(item); return text === null ? [] : [`${name} ${text}`]; });
    if (parts.length) rows.push([titleCase(key), parts.join(" · ")]);
  }
  return rows;
}

/** A public, read-only view of one OPTRA House Agent: recipe, six stages, positions, orders and its Decision Tape. */
export function HouseAgentDetail({ agentId }: { agentId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/public/v1/agents/${encodeURIComponent(agentId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(body);
          throw new Error(parsed.success ? parsed.data.error.message : "This House Agent could not be loaded.");
        }
        return PublicHouseAgentDetailSchema.parse(body);
      })
      .then((detail) => setState({ status: "ready", detail }))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: errorText(reason, "This House Agent could not be loaded.") }); });
    return () => controller.abort();
  }, [agentId]);

  if (state.status === "loading") return <main className="page-container"><StateBlock kind="loading" title="Loading House Agent…" /></main>;
  if (state.status === "error") {
    return (
      <main className="page-container">
        <StateBlock kind="error" title="House Agent unavailable" action={<Link className={buttonVariants({ variant: "outline" })} href="/agents">Back to Agents</Link>}><p>{state.message}</p></StateBlock>
      </main>
    );
  }

  const { detail } = state;
  const template = detail.templateId as HouseTemplateId;
  const account = detail.account;
  const strategy = detail.strategy;
  const backtest = detail.backtest;
  const raw = detail.backtestRun;
  const count = (value: unknown) => typeof value === "number" ? value : null;
  const text = (value: unknown) => typeof value === "string" && value ? value : null;
  const run = raw ? { sampleCount: count(raw.sampleCount), entryOrderCount: count(raw.entryOrderCount), exitOrderCount: count(raw.exitOrderCount), dataSource: text(raw.dataSource), historyDataHash: text(raw.historyDataHash) } : null;
  return (
    <main className="page-container">
      <div className="page-heading-row detail-head">
        <div className="detail-id">
          <AgentCharacter className="detail-agent" id={template as "protective_put"} size={64} title={`${titleCase(template)} agent`} />
          <div>
            <Link className="back-link" href="/agents#house-agents">← Agents</Link>
            <p className="eyebrow">{titleCase(template)} · BY OPTRA · PAPER ONLY</p>
            <h1>{detail.name}</h1>
            <p className="page-description mono" title={detail.recipeHash}>Recipe {shortHash(detail.recipeHash, 18, 8)}</p>
          </div>
        </div>
        <div className="detail-status"><span className={`agent-status agent-status-${detail.status}`}>{detail.status}</span></div>
      </div>

      <Panel aria-label="Summary">
        <p className="panel-lede">{strategyLine[template]} on {detail.underlyingSymbol}. OPTRA-owned and read-only: you cannot trade this agent, and nothing here moves real funds. Premiums are modeled, never recorded venue quotes.</p>
        <dl className="metric-row">
          <Stat label="Decisions recorded" value={String(detail.decisionCount)} />
          <Stat label="Open positions" value={String(detail.openPositions)} />
          {account ? <Stat label="Paper equity" value={account.equityUsd === null ? "n/a" : formatUsd(account.equityUsd)} /> : null}
          {account ? <Stat label="Realized P/L" value={formatUsd(account.realizedPnlUsd)} tone={signedTone(account.realizedPnlUsd)} /> : null}
          {account ? <Stat label="Locked collateral" value={formatUsd(account.lockedCollateralUsd)} /> : null}
        </dl>
        {detail.launchedAt ? <p className="panel-note">Launched {formatUtc(detail.launchedAt)}.</p> : null}
      </Panel>

      <Panel aria-label="Configuration and status">
        <div className="panel-head"><div><p className="eyebrow">CONFIGURATION · RISK · STATUS</p><h2>What is configured and where it stands</h2></div><Chip>Paper</Chip></div>
        <dl className="kv">
          <div><dt>Strategy</dt><dd>{titleCase(template)} · {strategyLine[template]}</dd></div>
          <div><dt>Underlying</dt><dd className="mono">{detail.underlyingSymbol}</dd></div>
          <div><dt>Execution mode</dt><dd>{detail.executionMode} · modeled premiums, no venue order</dd></div>
          <div><dt>Status</dt><dd className="mono">{detail.status}</dd></div>
          <div><dt>Launched</dt><dd className="mono">{detail.launchedAt ? formatUtc(detail.launchedAt) : "Not launched"}</dd></div>
          <div><dt>Last evaluation</dt><dd className="mono">{detail.latestDecision ? `${formatUtc(detail.latestDecision.createdAt)} · ${detail.latestDecision.action}` : "None recorded yet"}</dd></div>
          {configurationRows(detail.recipe.parameters).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>)}
        </dl>
        {detail.latestDecision ? null : <p className="panel-note">No evaluation has been persisted for this agent yet. A decision is recorded after an hourly candle in the US session finalizes; a pass that is deferred or finds no eligible candle stores nothing, and none is invented here.</p>}
      </Panel>

      {backtest ? (
        <Panel aria-label="Backtest">
          <div className="panel-head"><div><p className="eyebrow">LAUNCH BACKTEST</p><h2>30 days before launch</h2></div><Chip tone="ember">Modeled premiums</Chip></div>
          <dl className="metric-row">
            <Stat label="Strategy return" value={formatPct(backtest.totalReturnPct)} tone={signedTone(backtest.totalReturnPct)} />
            {backtest.vsHoldingPct !== null ? <Stat label="Versus holding" value={formatPts(backtest.vsHoldingPct)} tone={signedTone(backtest.vsHoldingPct)} /> : null}
            {backtest.vsCashPct !== null ? <Stat label="Versus flat USD" value={formatPts(backtest.vsCashPct)} tone={signedTone(backtest.vsCashPct)} /> : null}
            <Stat label="Max drawdown" value={formatPct(`-${backtest.maxDrawdownPct}`)} tone="loss" />
          </dl>
          {run ? (
            <dl className="kv kv-tight" aria-label="Backtest report">
              {run.sampleCount !== null ? <div><dt>Decisions replayed</dt><dd className="mono">{run.sampleCount}</dd></div> : null}
              {run.entryOrderCount !== null || run.exitOrderCount !== null ? <div><dt>Entries / exits</dt><dd className="mono">{run.entryOrderCount ?? 0} / {run.exitOrderCount ?? 0}</dd></div> : null}
              {run.dataSource ? <div><dt>Source</dt><dd className="mono">{run.dataSource}</dd></div> : null}
              {run.historyDataHash ? <div><dt>History hash</dt><dd className="mono" title={run.historyDataHash}>{shortHash(run.historyDataHash, 16, 8)}</dd></div> : null}
            </dl>
          ) : null}
          <p className="panel-note">Candles read {formatUtc(backtest.startAt)} to {formatUtc(backtest.endAt)}, including the 30-day volatility warm-up; the 30 scored days are the last 720 hours. Losses are shown as they happened. The model includes no venue fees and no earnings volatility premium.</p>
        </Panel>
      ) : null}

      {strategy ? (
        <Panel aria-label="Strategy results">
          <div className="panel-head"><div><p className="eyebrow">STRATEGY COUNTERS</p><h2>What it has done on paper</h2></div></div>
          <dl className="metric-row">
            <Stat label="Entries" value={String(strategy.entries)} />
            <Stat label="Closes" value={`${strategy.closes} (${strategy.winningCloses} winning)`} />
            <Stat label="Rolls" value={String(strategy.rolls)} />
            <Stat label="Settled ITM / OTM" value={`${strategy.settledItm} / ${strategy.settledOtm}`} />
            <Stat label="Premium collected" value={formatUsd(strategy.premiumCollectedUsd)} />
            <Stat label="Premium paid" value={formatUsd(strategy.premiumPaidUsd)} />
            {strategy.worstTradeUsd !== null ? <Stat label="Worst trade" value={formatUsd(strategy.worstTradeUsd)} tone={signedTone(strategy.worstTradeUsd)} /> : null}
            {template === "covered_call" ? <Stat label="Virtual reference shares" value={String(strategy.referenceShares)} /> : null}
          </dl>
          {template === "earnings_straddle" ? <p className="panel-note">Earnings traded: {strategy.tradedEarnings.length ? strategy.tradedEarnings.join(", ") : "none yet"}.</p> : null}
        </Panel>
      ) : null}

      <Panel aria-label="Rule stages">
        <div className="panel-head"><div><p className="eyebrow">RECIPE · SIX STAGES</p><h2>How it decides</h2></div></div>
        <div className="recipe-outline">
          <ol>
            {stageSummaries[template].map(([stage, hooks, text]) => (
              <li key={stage}><span className="recipe-stage">{stage}</span><span className="recipe-body"><span className="recipe-hooks">{hooks}</span>{text}</span></li>
            ))}
          </ol>
        </div>
        <div className="assumptions"><h3>Model assumptions</h3><ul>{modelAssumptions[template].map((line) => <li key={line}>{line}</li>)}</ul></div>
      </Panel>

      <Panel aria-label="Positions"><div className="panel-head"><h2>Positions</h2></div><PositionGrid positions={detail.positions} /></Panel>
      <Panel aria-label="Paper orders"><div className="panel-head"><h2>Modeled paper orders</h2></div><OrdersTable orders={detail.orders} /></Panel>
      <AgentEconomicsSection agentId={detail.id} mode="public" />
      <AgentVerificationSection agentId={detail.id} agentName={detail.name} mode="house" />
      <Panel aria-label="Decision Tape">
        <div className="panel-head"><div><p className="eyebrow">APPEND-ONLY · PAPER</p><h2>Decision Tape</h2></div></div>
        <TapeList decisions={detail.decisions} />
      </Panel>
    </main>
  );
}
