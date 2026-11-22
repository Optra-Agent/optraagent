"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PublicAgentsResponseSchema } from "../../../lib/domain/contracts";
import type { PublicHouseAgent } from "../../../lib/domain/contracts";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPct, formatPts, formatUsd, formatUtc, signedTone } from "../format";
import { Panel, Skeleton } from "../ui";
import { AgentCharacter } from "../../marketing/characters";
import { strategyLine } from "./house-meta";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; agents: PublicHouseAgent[] };

/** OPTRA's own House Agents, running on paper right now. Read from the public API; nothing here is a user's agent. */
export function LiveHouseAgents() {
  const [state, setState] = useState<Load>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/v1/agents", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return PublicAgentsResponseSchema.parse(await response.json());
      })
      .then((result) => setState({ status: "ready", agents: result.agents }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, []);

  if (state.status === "error") return null;
  return (
    <Panel className="live-house" id="house-agents" aria-label="OPTRA House Agents running on paper">
      <div className="panel-head">
        <div><p className="eyebrow">BY OPTRA · RUNNING ON PAPER</p><h2>Live House Agents</h2></div>
      </div>
      <p className="panel-lede">Four OPTRA-owned agents evaluate recorded Robinhood Chain prices every hour with virtual capital and modeled premiums. Every decision, including holds and skips, is on the public Tape. They are not community agents and are never counted as adoption.</p>
      {state.status === "loading" ? <div role="status"><Skeleton lines={4} /></div> : null}
      {state.status === "ready" && state.agents.length === 0 ? <p className="empty-line">The House Agents are being provisioned. Check back shortly.</p> : null}
      {state.status === "ready" && state.agents.length > 0 ? (
        <div className="ag-grid" data-n={state.agents.length}>
          {state.agents.map((agent) => (
            <article className="ag-card" key={agent.id} data-kind="house-live">
              <header className="ag-head">
                <div>
                  <h3>{agent.name}</h3>
                  <p className="ag-sub">{strategyLine[agent.templateId as keyof typeof strategyLine] ?? agent.templateId} · {agent.underlyingSymbol}</p>
                </div>
                <AgentCharacter id={agent.templateId as "protective_put"} size={48} />
              </header>
              <div className="ag-tags">
                <span className="ag-chip" data-tone="azure">{agent.status}</span>
                <span className="ag-chip">by Optra</span>
                <span className="ag-chip">Paper</span>
              </div>
              <dl className="ag-metrics ag-metrics-3">
                <div><dt>Decisions</dt><dd className="mono">{agent.decisionCount}</dd></div>
                <div><dt>Open</dt><dd className="mono">{agent.openPositions}</dd></div>
                <div><dt>Realized</dt><dd className={`mono pnl pnl-${signedTone(agent.account?.realizedPnlUsd ?? "0")}`}>{agent.account ? formatUsd(agent.account.realizedPnlUsd) : "n/a"}</dd></div>
              </dl>
              {agent.backtest ? (
                <p className="ag-decision"><span className="ag-tag">BACKTEST</span>{formatPct(agent.backtest.totalReturnPct)} over 30 days{agent.backtest.vsHoldingPct !== null ? `, ${formatPts(agent.backtest.vsHoldingPct)} vs holding` : ""}. Modeled premiums.</p>
              ) : null}
              <p className="ag-decision">
                <span className="ag-tag">LATEST</span>
                {agent.latestDecision ? <>{agent.latestDecision.action.toUpperCase()} · <time dateTime={agent.latestDecision.createdAt}>{formatUtc(agent.latestDecision.createdAt)}</time>. {agent.latestDecision.reason}</> : "No decision yet. The first appears after the next completed market-hours hour."}
              </p>
              <footer className="ag-foot">
                <Link className={cn(buttonVariants(), "ag-pill")} href={`/house/${encodeURIComponent(agent.id)}`}>Read its Tape</Link>
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
