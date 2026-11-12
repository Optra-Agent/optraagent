"use client";

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
import type { AgentDecision, AgentDetail, PaperOrder, PaperPosition } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";

type DetailState = "idle" | "loading" | "ready" | "error";
type DetailData = { agent: AgentDetail; decisions: AgentDecision[]; orders: PaperOrder[]; positions: PaperPosition[] };

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    return parsed.success ? parsed.data.error.message : "The agent request could not be completed.";
  } catch {
    return "The agent request could not be completed.";
  }
}

export function AgentDetailScreen({ agentId }: { agentId: string }) {
  const router = useRouter();
  const { session, status } = useAuthSession();
  const [result, setResult] = useState<{ key: string; status: "ready" | "error"; data: DetailData | null; error: string }>({ key: "", status: "ready", data: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [tickMessage, setTickMessage] = useState("");
  const [reload, setReload] = useState(0);
  const requestKey = `${status}:${session?.user.id ?? ""}:${agentId}:${reload}`;
  const state: DetailState = status !== "signed_in" ? "idle" : result.key === requestKey ? result.status : "loading";
  const data = result.key === requestKey ? result.data : null;
  const error = result.key === requestKey ? result.error : "";

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
      setResult({ key: requestKey, status: "ready", data: { agent, decisions: tape.decisions, orders: tape.orders, positions: positions.positions }, error: "" });
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setResult({ key: requestKey, status: "error", data: null, error: reason instanceof Error ? reason.message : "The agent could not be loaded." });
    });
    return () => controller.abort();
  }, [agentId, requestKey, status]);

  async function lifecycle(action: "pause" | "resume" | "stop") {
    if (!data) return;
    setBusy(true);
    setResult((current) => current.key === requestKey ? { ...current, error: "" } : current);
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
      const message = reason instanceof Error ? reason.message : "The agent state could not be updated.";
      setResult((current) => current.key === requestKey ? { ...current, error: message } : current);
    } finally {
      setBusy(false);
    }
  }

  async function forkAgent() {
    setBusy(true);
    setResult((current) => current.key === requestKey ? { ...current, error: "" } : current);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/fork`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const forked = AgentDetailSchema.parse(await response.json());
      router.push(`/agents/${encodeURIComponent(forked.id)}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The agent could not be forked.";
      setResult((current) => current.key === requestKey ? { ...current, error: message } : current);
    } finally {
      setBusy(false);
    }
  }

  async function runPaperTick() {
    if (!data) return;
    setBusy(true);
    setTickMessage("");
    setResult((current) => current.key === requestKey ? { ...current, error: "" } : current);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/tick`, {
        method: "POST", credentials: "include", headers: { "idempotency-key": `ui-${crypto.randomUUID()}` },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = PaperTickResponseSchema.parse(await response.json());
      setTickMessage(`${result.decision.action.toUpperCase()} · ${result.orderCount} paper order(s) · ${result.decision.reason}`);
      setReload((value) => value + 1);
    } catch (reason) {
      setTickMessage(reason instanceof Error ? reason.message : "Paper tick could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-container">
      {status === "signed_out" ? <section className="state-panel"><h1>Connect a wallet</h1><p>Sign in to view this agent.</p></section> : null}
      {status === "error" ? <section className="state-panel" role="alert">Wallet session could not be checked. Retry from the wallet control above.</section> : null}
      {status === "loading" || state === "loading" ? <section className="state-panel" role="status">Loading agent and paper history…</section> : null}
      {status === "signed_in" && state === "error" ? (
        <section className="state-panel" role="alert"><h1>Agent unavailable</h1><p>{error}</p><button className="button button-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></section>
      ) : null}
      {status === "signed_in" && state === "ready" && data ? (
        <>
          <div className="page-heading-row">
            <div>
              <Link className="back-link" href="/agents">← Agents</Link>
              <p className="eyebrow">{data.agent.templateId.replaceAll("_", " ")} · PAPER ONLY</p>
              <h1>{data.agent.name}</h1>
              <p className="page-description">Recipe {data.agent.recipeHash}</p>
            </div>
            <div className="lifecycle-controls" aria-label="Agent controls">
              {data.agent.status === "running" ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void lifecycle("pause")}>Pause</button> : null}
              {data.agent.status === "paused" ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void lifecycle("resume")}>Resume</button> : null}
              {data.agent.status === "running" ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void runPaperTick()}>{busy ? "Running…" : "Run paper tick"}</button> : null}
              {data.agent.status !== "stopped" ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void lifecycle("stop")}>Stop</button> : null}
              <button className="button button-primary" type="button" disabled={busy} onClick={() => void forkAgent()}>Fork draft</button>
            </div>
          </div>
          {error ? <section className="state-panel lifecycle-error" role="alert">{error}</section> : null}
          {tickMessage ? <section className="state-panel" role="status">{tickMessage}</section> : null}
          <nav className="agent-tabs" aria-label="Agent sections">
            <a href="#overview">Overview</a><a href="#positions">Positions</a><a href="#tape">Tape</a>
          </nav>
          <section id="overview" className="state-panel agent-overview">
            <div className="market-status-row"><h2>Agent status</h2><span className={`agent-status agent-status-${data.agent.status}`}>{data.agent.status}</span></div>
            <dl className="agent-metadata">
              <div><dt>Underlying</dt><dd>{data.agent.recipe.underlyingSymbol}</dd></div>
              <div><dt>Backtest</dt><dd>{data.agent.backtestRunId ?? "Not attached"}</dd></div>
              <div><dt>Hook rules</dt><dd>{data.agent.recipe.hookIds.length ? data.agent.recipe.hookIds.join(", ") : "No rules configured"}</dd></div>
              <div><dt>Updated</dt><dd><time dateTime={data.agent.updatedAt}>{data.agent.updatedAt}</time></dd></div>
            </dl>
            <p className="market-note">Paper premiums use a disclosed Black–Scholes model with RV30 × 1.1. No venue option quote, fee schedule, wallet collateral, or live execution is represented.</p>
          </section>
          <section id="positions" className="state-panel tape-panel">
            <h2>Paper positions</h2>
            {data.positions.length === 0 ? <p>No paper positions.</p> : (
              <div className="tape-list">{data.positions.map((position) => <article className="tape-row" key={position.id}><strong>{position.symbol} {position.optionType.toUpperCase()} · ${position.strikeUsd}</strong><span>{position.quantity} one-share model unit(s) · {position.status}</span><span>Expiry {position.expiryAt} · mark ${position.markPriceUsd}</span><span>Unrealized P/L ${position.unrealizedPnlUsd}</span></article>)}</div>
            )}
          </section>
          <section id="orders" className="state-panel tape-panel">
            <div className="market-status-row"><h2>Paper orders</h2><span>PAPER</span></div>
            {data.orders.length === 0 ? <p>No paper orders.</p> : <div className="tape-list">{data.orders.map((order) => <article className="tape-row" key={order.id}><strong>{order.side.toUpperCase()} {order.quantity} modeled put unit(s)</strong><span>{order.symbol} ${order.strikeUsd} · {order.expiryAt}</span><span>Model ${order.modelPremiumUsd} · paper fill ${order.priceUsd} · {order.slippageBps} bp slippage</span></article>)}</div>}
          </section>
          <section id="tape" className="state-panel tape-panel">
            <div className="market-status-row"><h2>Decision Tape</h2><span>PAPER</span></div>
            {data.decisions.length === 0 ? <p>No persisted decisions.</p> : (
              <div className="tape-list">{data.decisions.map((decision) => (
                <article className="tape-row" key={decision.id}>
                  <div className="market-status-row"><strong>{decision.action.toUpperCase()}</strong><time dateTime={decision.createdAt}>{decision.createdAt}</time></div>
                  <p>{decision.reason}</p>
                  <p className="market-note">Source: {decision.snapshotSource} · Recipe {decision.recipeHash}</p>
                  {decision.hookResults.length ? <details><summary>Decision trace ({decision.hookResults.length})</summary><ul>{decision.hookResults.map((result, index) => <li key={`${result.hookId}:${index}`}>{result.hookId} · {result.status}: {result.reason}</li>)}</ul></details> : null}
                </article>
              ))}</div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
