"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiErrorSchema, PublicHouseAgentDetailSchema } from "../../../lib/domain/contracts";
import type { PublicHouseAgentDetail } from "../../../lib/domain/contracts";
import { buttonVariants } from "@/components/ui/button";
import { AgentCharacter } from "../../marketing/characters";
import { errorText, formatPct, formatUsd, formatUtc, shortHash, signedTone, titleCase } from "../format";
import { OrdersTable, PositionGrid, TapeList } from "../paper";
import { Chip, Panel, StateBlock } from "../ui";
import { modelAssumptions, stageSummaries, strategyLine, type HouseTemplateId } from "./house-meta";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: PublicHouseAgentDetail };

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div><dt>{label}</dt><dd className={`mono${tone ? ` pnl pnl-${tone}` : ""}`}>{value}</dd></div>;
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

      {backtest ? (
        <Panel aria-label="Backtest">
          <div className="panel-head"><div><p className="eyebrow">LAUNCH BACKTEST</p><h2>30 days before launch</h2></div><Chip tone="ember">Modeled premiums</Chip></div>
          <dl className="metric-row">
            <Stat label="Strategy return" value={formatPct(backtest.totalReturnPct)} tone={signedTone(backtest.totalReturnPct)} />
            {backtest.vsHoldingPct !== null ? <Stat label="Versus holding" value={`${formatPct(backtest.vsHoldingPct)} pts`} tone={signedTone(backtest.vsHoldingPct)} /> : null}
            {backtest.vsCashPct !== null ? <Stat label="Versus flat USD" value={`${formatPct(backtest.vsCashPct)} pts`} tone={signedTone(backtest.vsCashPct)} /> : null}
            <Stat label="Max drawdown" value={formatPct(`-${backtest.maxDrawdownPct}`)} tone="loss" />
          </dl>
          <p className="panel-note">{formatUtc(backtest.startAt)} to {formatUtc(backtest.endAt)}. Losses are shown as they happened. The model includes no venue fees and no earnings volatility premium.</p>
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
      <Panel aria-label="Decision Tape">
        <div className="panel-head"><div><p className="eyebrow">APPEND-ONLY · PAPER</p><h2>Decision Tape</h2></div></div>
        <TapeList decisions={detail.decisions} />
      </Panel>
    </main>
  );
}
