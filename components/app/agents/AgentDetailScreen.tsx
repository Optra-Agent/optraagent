"use client";

import { AgentCharacter, CHARACTERS, type CharacterId } from "../../marketing/characters";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AgentDetailSchema,
  ApiErrorSchema,
  PaperTickResponseSchema,
  PaperPositionsResponseSchema,
  TapeResponseSchema,
} from "../../../lib/domain/contracts";
import type { AgentDecision, AgentDetail, PaperOrder, PaperPosition, PaperTickResponse } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";
import { formatUsd, formatUtc, shortHash, titleCase, errorText } from "../format";
import { OrdersTable, PositionGrid, TapeList } from "../paper";
import { actionTone, Chip, JourneyRail, StateBlock, Panel } from "../ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type DetailData = { agent: AgentDetail; decisions: AgentDecision[]; orders: PaperOrder[]; positions: PaperPosition[] };
type DetailResult = { key: string; base: string; status: "ready" | "error"; data: DetailData | null; error: string };

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    return parsed.success ? parsed.data.error.message : "The agent request could not be completed.";
  } catch {
    return "The agent request could not be completed.";
  }
}

function recipeParam(agent: AgentDetail, key: string): string | null {
  const value = agent.recipe.parameters[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export function AgentDetailScreen({ agentId }: { agentId: string }) {
  const router = useRouter();
  const { session, status } = useAuthSession();
  const [result, setResult] = useState<DetailResult>({ key: "", base: "", status: "ready", data: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("overview");
  const [stopOpen, setStopOpen] = useState(false);
  const [tick, setTick] = useState<PaperTickResponse | null>(null);
  const [tickError, setTickError] = useState("");
  const [reload, setReload] = useState(0);
  const base = `${status}:${session?.user.id ?? ""}:${agentId}`;
  const requestKey = `${base}:${reload}`;
  const data = result.base === base ? result.data : null;
  const error = result.key === requestKey ? result.error : "";
  const state: "idle" | "loading" | "ready" | "error" = status !== "signed_in"
    ? "idle"
    : result.key === requestKey ? result.status : data ? "ready" : "loading";
  const refreshing = status === "signed_in" && result.key !== requestKey && Boolean(data);

  useEffect(() => {
    if (status !== "signed_in") return;
    const controller = new AbortController();
    const root = `/api/agents/${encodeURIComponent(agentId)}`;
    void Promise.all([
      fetch(root, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return AgentDetailSchema.parse(await response.json());
      }),
      fetch(`${root}/tape`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return TapeResponseSchema.parse(await response.json());
      }),
      fetch(`${root}/positions`, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return PaperPositionsResponseSchema.parse(await response.json());
      }),
    ]).then(([agent, tape, positions]) => {
      setResult({ key: requestKey, base, status: "ready", data: { agent, decisions: tape.decisions, orders: tape.orders, positions: positions.positions }, error: "" });
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setResult({ key: requestKey, base, status: "error", data: null, error: errorText(reason, "The agent could not be loaded.") });
    });
    return () => controller.abort();
  }, [agentId, base, requestKey, status]);

  function patchError(message: string) {
    setResult((current) => current.key === requestKey ? { ...current, error: message } : current);
  }

  async function lifecycle(action: "pause" | "resume" | "stop") {
    if (!data) return;
    setBusy(true);
    patchError("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/lifecycle`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const updated = AgentDetailSchema.parse(await response.json());
      setResult((current) => current.key === requestKey && current.data
        ? { ...current, data: { ...current.data, agent: updated } }
        : current);
    } catch (reason) {
      patchError(errorText(reason, "The agent state could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  async function forkAgent() {
    setBusy(true);
    patchError("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/fork`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const forked = AgentDetailSchema.parse(await response.json());
      router.push(`/agents/${encodeURIComponent(forked.id)}`);
    } catch (reason) {
      patchError(errorText(reason, "The agent could not be forked."));
    } finally {
      setBusy(false);
    }
  }

  async function runPaperTick() {
    if (!data) return;
    setBusy(true);
    setTick(null);
    setTickError("");
    patchError("");
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/tick`, {
        method: "POST", credentials: "include", headers: { "idempotency-key": `ui-${crypto.randomUUID()}` },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setTick(PaperTickResponseSchema.parse(await response.json()));
      setReload((value) => value + 1);
    } catch (reason) {
      setTickError(errorText(reason, "Paper tick could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  const agent = data?.agent;
  const journeyStep = !agent ? 3 : agent.status === "draft" ? 3 : (data?.decisions.length ?? 0) > 0 ? 6 : 5;
  const holdings = agent ? recipeParam(agent, "protectedShares") : null;
  const capital = agent ? recipeParam(agent, "initialCapitalUsd") : null;

  return (
    <main className="page-container">
      {status === "signed_out" ? (
        <StateBlock kind="info" title="Connect a wallet">
          <p>Sign in to view this agent. Agents are visible only to the wallet that created them.</p>
        </StateBlock>
      ) : null}
      {status === "error" ? <StateBlock kind="error" title="Wallet session could not be checked">Retry from the wallet control in the header.</StateBlock> : null}
      {status === "loading" || state === "loading" ? <StateBlock kind="loading" title="Loading agent and paper history…" /> : null}
      {status === "signed_in" && state === "error" ? (
        <StateBlock kind="error" title="Agent unavailable" action={<><Button variant="outline" type="button" onClick={() => setReload((value) => value + 1)}>Retry</Button><Link className={buttonVariants({ variant: "outline" })} href="/agents">Back to agents</Link></>}>
          <p>{error}</p>
        </StateBlock>
      ) : null}

      {status === "signed_in" && state !== "error" && agent && data ? (
        <>
          <div className="page-heading-row detail-head">
            <div className="detail-id">
            {agent.templateId in CHARACTERS ? <AgentCharacter className="detail-agent" id={agent.templateId as CharacterId} size={64} title={`${titleCase(agent.templateId)} agent`} /> : null}
            <div>
              <Link className="back-link" href="/agents">← Agents</Link>
              <p className="eyebrow">{titleCase(agent.templateId)} · PAPER ONLY</p>
              <h1>{agent.name}</h1>
              <p className="page-description mono" title={agent.recipeHash}>Recipe {shortHash(agent.recipeHash, 18, 8)}</p>
            </div>
            </div>
            <div className="detail-status">
              <span className={`agent-status agent-status-${agent.status}`}>{agent.status}</span>
              {refreshing ? <span className="refreshing" role="status">Refreshing…</span> : null}
            </div>
          </div>
          <JourneyRail step={journeyStep} />

          <Panel className="next-step" aria-label="Next step">
            {agent.status === "draft" ? (
              <>
                <div>
                  <p className="eyebrow">NEXT · BACKTEST</p>
                  <h2>Backtest this draft before it can launch</h2>
                  <p>A launch needs a complete backtest on 1,441 consecutive closed hourly candles with at least one modeled entry. Open Lab to check coverage and run it.</p>
                </div>
                <Link className={buttonVariants({ variant: "default" })} href={`/lab?agent=${encodeURIComponent(agent.id)}`}>Backtest in Lab</Link>
              </>
            ) : null}
            {agent.status === "running" ? (
              <>
                <div>
                  <p className="eyebrow">NEXT · PAPER TICK</p>
                  <h2>Evaluate the recipe on the latest closed candle</h2>
                  <p>A paper tick runs every rule against current data. A modeled paper order is created only if all rules pass; otherwise the Tape records why it held or skipped.</p>
                </div>
                <Button  type="button" disabled={busy} onClick={() => void runPaperTick()}>{busy ? "Running…" : "Run paper tick"}</Button>
              </>
            ) : null}
            {agent.status === "paused" ? (
              <>
                <div>
                  <p className="eyebrow">PAUSED</p>
                  <h2>This agent is not evaluating</h2>
                  <p>Resume it to run paper ticks again. Resuming requires its matching complete backtest.</p>
                </div>
                <Button  type="button" disabled={busy} onClick={() => void lifecycle("resume")}>Resume</Button>
              </>
            ) : null}
            {agent.status === "stopped" ? (
              <>
                <div>
                  <p className="eyebrow">STOPPED</p>
                  <h2>This agent has ended</h2>
                  <p>Its Tape and positions stay readable. Fork it to start a new draft with the same recipe and no copied paper state.</p>
                </div>
                <Button  type="button" disabled={busy} onClick={() => void forkAgent()}>Fork draft</Button>
              </>
            ) : null}
          </Panel>

          {tick ? (
            <section className="tick-result" role="status" aria-label="Paper tick result">
              <div className="tick-result-head">
                <Chip tone={actionTone(tick.decision.action)}>{tick.decision.action}</Chip>
                <strong>{tick.orderCount} paper order{tick.orderCount === 1 ? "" : "s"}</strong>
                {tick.idempotentReplay ? <Chip>Replay of an earlier tick</Chip> : null}
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setTab("tape")}>Read the trace</Button>
              </div>
              <p>{tick.decision.reason}</p>
            </section>
          ) : null}
          {tickError ? <StateBlock kind="error" title="Paper tick failed"><p>{tickError}</p></StateBlock> : null}
          {error ? <StateBlock kind="error" className="lifecycle-error"><p>{error}</p></StateBlock> : null}

          {agent.status !== "stopped" ? (
            <div className="lifecycle-controls" role="group" aria-label="Agent controls">
              {agent.status === "running" ? <Button variant="outline" type="button" disabled={busy} onClick={() => void lifecycle("pause")}>Pause</Button> : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" type="button" disabled={busy}>More actions</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => void forkAgent()}>Fork as new draft</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setStopOpen(true)}>Stop agent</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
          <Dialog open={stopOpen} onOpenChange={setStopOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Stop this agent?</DialogTitle>
                <DialogDescription>A stopped agent never evaluates again. Its Tape and positions stay readable, and you can fork it into a new draft. This cannot be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStopOpen(false)}>Keep running</Button>
                <Button variant="destructive" disabled={busy} onClick={() => { setStopOpen(false); void lifecycle("stop"); }}>Stop agent</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Tabs value={tab} onValueChange={setTab} className="agent-tabs-root">
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent p-0">
              <TabsTrigger value="overview" className="agent-tab-trigger">Overview</TabsTrigger>
              <TabsTrigger value="positions" className="agent-tab-trigger">Positions ({data.positions.length})</TabsTrigger>
              <TabsTrigger value="orders" className="agent-tab-trigger">Orders ({data.orders.length})</TabsTrigger>
              <TabsTrigger value="tape" className="agent-tab-trigger">Tape ({data.decisions.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
          <Panel className="agent-overview">
            <div className="panel-head"><h2>Recipe overview</h2><Chip tone="ember">Modeled premiums</Chip></div>
            <dl className="kv">
              <div><dt>Underlying</dt><dd className="mono">{agent.recipe.underlyingSymbol}</dd></div>
              <div><dt>Backtest</dt><dd className="mono" title={agent.backtestRunId ?? undefined}>{agent.backtestRunId ? shortHash(agent.backtestRunId, 8, 4) : "Not attached"}</dd></div>
              {holdings ? <div><dt>Virtual reference shares</dt><dd className="mono">{holdings}</dd></div> : null}
              {capital ? <div><dt>Paper capital</dt><dd className="mono">{formatUsd(capital, 0)}</dd></div> : null}
              <div><dt>Updated</dt><dd className="mono"><time dateTime={agent.updatedAt}>{formatUtc(agent.updatedAt)}</time></dd></div>
              <div className="kv-wide">
                <dt>Hook rules ({agent.recipe.hookIds.length})</dt>
                <dd>{agent.recipe.hookIds.length ? <span className="hook-chips">{agent.recipe.hookIds.map((id) => <span className="hook-chip" key={id}>{id}</span>)}</span> : "No rules configured"}</dd>
              </div>
            </dl>
            <p className="panel-note">Paper premiums use a disclosed Black–Scholes model with RV30 × 1.1 and 50 bp slippage. No venue option quote, fee schedule, wallet collateral or live execution is represented.</p>
          </Panel>

            </TabsContent>
            <TabsContent value="positions">
          <Panel>
            <div className="panel-head"><h2>Paper positions</h2><Chip>Paper</Chip></div>
            <PositionGrid positions={data.positions} />
          </Panel>

            </TabsContent>
            <TabsContent value="orders">
          <Panel>
            <div className="panel-head"><h2>Paper orders</h2><Chip>Paper</Chip></div>
            <OrdersTable orders={data.orders} />
          </Panel>

            </TabsContent>
            <TabsContent value="tape">
          <Panel>
            <div className="panel-head"><h2>Decision Tape</h2><Link className={buttonVariants({ variant: "link" })} href={`/tape?agentId=${encodeURIComponent(agent.id)}`}>Open full Tape</Link></div>
            <TapeList decisions={data.decisions} />
          </Panel>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </main>
  );
}
