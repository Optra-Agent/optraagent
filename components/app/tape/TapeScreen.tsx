"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AgentListResponseSchema, ApiErrorSchema, PaperPositionsResponseSchema, TapeResponseSchema } from "../../../lib/domain/contracts";
import type { Agent, AgentDecision, PaperOrder, PaperPosition } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";
import { formatUtc, shortHash, titleCase, errorText } from "../format";
import { OrdersTable, PositionGrid, TapeList } from "../paper";
import { CallPutOrderHistory } from "./CallPutOrderHistory";
import { CallPutOrderPanel } from "./CallPutOrderPanel";
import { CallPutPositionActions } from "./CallPutPositionActions";
import { CallPutRequestTracker } from "./CallPutRequestTracker";
import { LiveAgentControls } from "./LiveAgentControls";
import { LiveGatesPanel } from "./LiveGatesPanel";
import { PublicHouseTape } from "./PublicHouseTape";
import { Chip, JourneyRail, PageHeader, Skeleton, StateBlock, Panel, decisionOutcome } from "../ui";
import type { DecisionOutcome } from "../ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TapeData = { decisions: AgentDecision[]; orders: PaperOrder[]; positions: PaperPosition[] };
type LoadState = "idle" | "loading" | "ready" | "error";
type ActionFilter = "all" | DecisionOutcome;

async function parseResponse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function getErrorMessage(body: unknown): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : "Paper history is temporarily unavailable.";
}

function AgentPicker() {
  const { status, setWalletMenuOpen } = useAuthSession();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status !== "signed_in") return;
    const controller = new AbortController();
    void fetch("/api/agents", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await parseResponse(response);
        if (!response.ok) throw new Error(getErrorMessage(body));
        return AgentListResponseSchema.parse(body);
      })
      .then((result) => setAgents(result.agents))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorText(reason, "Your agents could not be loaded."));
      });
    return () => controller.abort();
  }, [status]);

  if (status === "loading") return <StateBlock kind="loading" title="Checking wallet session…" />;
  if (status === "signed_out") {
    return (
      <StateBlock kind="info" title="No agent selected" action={<Button variant="outline" type="button" onClick={() => { setWalletMenuOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Choose a wallet</Button>}>
        <p>Open Tape from an agent detail page to inspect its persisted decisions.</p>
        <p className="subtle">Tape is private to the wallet that owns the agent. Connect to pick one of yours.</p>
      </StateBlock>
    );
  }
  if (error) return <StateBlock kind="error" title="Agents could not be loaded"><p>{error}</p></StateBlock>;
  if (!agents) return <div className="state-panel" role="status"><Skeleton lines={3} /></div>;
  if (agents.length === 0) {
    return (
      <StateBlock kind="empty" title="No agents yet" action={<Link className={buttonVariants({ variant: "default" })} href="/agents#configure">Create a Protective Put draft</Link>}>
        <p>Tape fills after a paper agent runs its first tick.</p>
      </StateBlock>
    );
  }
  return (
    <Panel  aria-label="Choose an agent">
      <div className="panel-head"><h2>Choose an agent</h2><span className="coverage-sub">{agents.length} saved</span></div>
      <ul className="picker-list">
        {agents.map((agent) => (
          <li key={agent.id}>
            <Link href={`/tape?agentId=${encodeURIComponent(agent.id)}`}>
              <span className="picker-name">{agent.name}</span>
              <span className="picker-meta mono">{titleCase(agent.templateId)} · {shortHash(agent.recipeHash, 14, 6)} · {formatUtc(agent.updatedAt)}</span>
              <span className={`agent-status agent-status-${agent.status}`}>{agent.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function TapeScreen({ agentId }: { agentId: string }) {
  const [data, setData] = useState<TapeData>({ decisions: [], orders: [], positions: [] });
  const [state, setState] = useState<LoadState>(agentId ? "loading" : "idle");
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [filter, setFilter] = useState<ActionFilter>("all");

  function refresh() {
    setData({ decisions: [], orders: [], positions: [] });
    setError("");
    setState("loading");
    setRefreshCount((count) => count + 1);
  }

  useEffect(() => {
    if (!agentId) return;
    const controller = new AbortController();
    const root = `/api/agents/${encodeURIComponent(agentId)}`;
    void Promise.all([
      fetch(`${root}/tape`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await parseResponse(response);
        if (!response.ok) throw new Error(getErrorMessage(body));
        return TapeResponseSchema.parse(body);
      }),
      fetch(`${root}/positions`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await parseResponse(response);
        if (!response.ok) throw new Error(getErrorMessage(body));
        return PaperPositionsResponseSchema.parse(body);
      }),
    ]).then(([tape, positions]) => {
      setData({ decisions: tape.decisions, orders: tape.orders, positions: positions.positions });
      setState("ready");
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(errorText(reason, "Paper history is temporarily unavailable."));
      setState("error");
    });
    return () => controller.abort();
  }, [agentId, refreshCount]);

  const counts = useMemo(() => {
    const tally = { open: 0, hold: 0, close: 0, skip: 0, error: 0 };
    for (const decision of data.decisions) tally[decisionOutcome(decision)] += 1;
    return tally;
  }, [data.decisions]);
  const visible = filter === "all" ? data.decisions : data.decisions.filter((decision) => decisionOutcome(decision) === filter);

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="APPEND-ONLY · PAPER"
        title="Optra Tape"
        description="Persisted agent decisions, source provenance, rule traces, and open paper positions. Holds and skips are first-class entries, not gaps."
        actions={agentId ? <Button variant="outline" type="button" disabled={state === "loading"} onClick={refresh}>Refresh Tape</Button> : null}
      />
      {agentId ? <JourneyRail step={6} /> : null}

      {!agentId ? <PublicHouseTape /> : null}
      {!agentId ? <AgentPicker /> : null}
      <CallPutOrderPanel />
      <CallPutPositionActions />
      <CallPutOrderHistory />
      <CallPutRequestTracker />
      <LiveGatesPanel />
      <LiveAgentControls />
      {state === "loading" ? <div className="state-panel" role="status"><Skeleton lines={4} /><span className="sr-only">Loading persisted paper history…</span></div> : null}
      {state === "error" ? (
        <StateBlock kind="error" title="Tape could not be loaded" action={<><Button variant="outline" type="button" onClick={refresh}>Retry</Button><Link className={buttonVariants({ variant: "outline" })} href="/agents">Back to agents</Link></>}>
          <p>{error}</p>
        </StateBlock>
      ) : null}
      {state === "ready" ? (
        <>
          <dl className="metric-row tape-summary" aria-label="Tape summary">
            <div className="metric"><dt>Decisions</dt><dd className="mono">{data.decisions.length}</dd></div>
            <div className="metric"><dt>Opened</dt><dd className="mono">{counts.open}</dd></div>
            <div className="metric"><dt>Held or skipped</dt><dd className="mono">{counts.hold + counts.skip}</dd></div>
            <div className="metric"><dt>Errors</dt><dd className="mono">{counts.error}</dd></div>
            <div className="metric"><dt>Paper orders</dt><dd className="mono">{data.orders.length}</dd></div>
          </dl>
          <div className="tape-layout">
            <Panel  aria-label="Decision Tape">
              <div className="panel-head">
                <h2>Decision Tape</h2>
                <Chip>Paper</Chip>
              </div>
              {data.decisions.length > 0 ? (
                <Tabs value={filter} onValueChange={(value) => setFilter(value as ActionFilter)} className="mb-4">
                  <TabsList aria-label="Filter decisions by action" className="h-auto flex-wrap justify-start gap-1 bg-secondary p-1">
                    {(["all", "open", "hold", "close", "skip", "error"] as const).map((action) => (
                      <TabsTrigger key={action} value={action} className="h-9 px-3 text-sm data-[state=active]:bg-accent data-[state=active]:text-foreground">
                        {action === "all" ? "All" : titleCase(action)}
                        <span className="mono ml-1.5 text-xs text-muted-foreground">{action === "all" ? data.decisions.length : counts[action]}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : null}
              <TapeList decisions={visible} />
              {data.decisions.length > 0 && visible.length === 0 ? <p className="empty-line">No {filter} decisions on this Tape.</p> : null}
            </Panel>
            <div className="tape-side">
              <Panel  aria-label="Paper positions">
                <div className="panel-head"><h2>Positions</h2><Chip>Paper</Chip></div>
                <PositionGrid positions={data.positions} />
              </Panel>
              <Panel  aria-label="Paper orders">
                <div className="panel-head"><h2>Paper orders</h2><Chip tone="ember">Modeled premiums</Chip></div>
                <OrdersTable orders={data.orders} />
              </Panel>
              <Link className={buttonVariants({ variant: "outline" })} href={`/agents/${encodeURIComponent(agentId)}`}>Open agent</Link>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
