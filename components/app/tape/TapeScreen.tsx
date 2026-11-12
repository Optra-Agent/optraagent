"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, PaperPositionsResponseSchema, TapeResponseSchema } from "../../../lib/domain/contracts";
import type { AgentDecision, PaperOrder, PaperPosition } from "../../../lib/domain/contracts";

type TapeData = { decisions: AgentDecision[]; orders: PaperOrder[]; positions: PaperPosition[] };
type LoadState = "idle" | "loading" | "ready" | "error";

async function parseResponse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function getErrorMessage(body: unknown): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : "Paper history is temporarily unavailable.";
}

export function TapeScreen({ agentId }: { agentId: string }) {
  const [data, setData] = useState<TapeData>({ decisions: [], orders: [], positions: [] });
  const [state, setState] = useState<LoadState>(agentId ? "loading" : "idle");
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

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
      setError(reason instanceof Error ? reason.message : "Paper history is temporarily unavailable.");
      setState("error");
    });
    return () => controller.abort();
  }, [agentId, refreshCount]);

  return (
    <main className="page-container">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">APPEND-ONLY · PAPER</p>
          <h1>Optra Tape</h1>
          <p className="page-description">Persisted agent decisions, source provenance, rule traces, and open paper positions.</p>
        </div>
        {agentId ? <button className="button button-secondary" type="button" disabled={state === "loading"} onClick={refresh}>Refresh Tape</button> : null}
      </div>

      {!agentId ? (
        <section className="state-panel">
          <h2>No agent selected</h2>
          <p>Open Tape from an agent detail page to inspect its persisted decisions.</p>
        </section>
      ) : null}
      {state === "loading" ? <p role="status">Loading persisted paper history…</p> : null}
      {state === "error" ? <section className="state-panel" role="alert">{error}</section> : null}
      {state === "ready" ? (
        <>
          <section className="state-panel tape-panel" aria-label="Paper positions">
            <div className="market-status-row"><h2>Positions</h2><span>PAPER</span></div>
            {data.positions.length === 0 ? <p>No paper positions.</p> : (
              <div className="tape-list">
                {data.positions.map((position) => (
                  <article className="tape-row" key={position.id}>
                    <strong>{position.symbol}</strong>
                    <span>{position.quantity} · {position.status}</span>
                    <span>Mark {position.markPriceUsd} USD</span>
                    <span>Unrealized P/L {position.unrealizedPnlUsd} USD</span>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="state-panel tape-panel" aria-label="Paper orders">
            <div className="market-status-row"><h2>Paper orders</h2><span>MODELED · PAPER</span></div>
            {data.orders.length === 0 ? <p>No paper orders.</p> : (
              <div className="tape-list">
                {data.orders.map((order) => (
                  <article className="tape-row" key={order.id}>
                    <div className="market-status-row"><strong>{order.side.toUpperCase()} {order.quantity} {order.symbol} {order.optionType.toUpperCase()}</strong><span>{order.status}</span></div>
                    <span>Strike ${order.strikeUsd} · expiry {order.expiryAt}</span>
                    <span>Model premium ${order.modelPremiumUsd} · paper fill ${order.priceUsd}</span>
                    <span>IV {order.impliedVolatility} · {order.slippageBps} bp slippage · venue fees excluded</span>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="state-panel tape-panel" aria-label="Decision Tape">
            <div className="market-status-row"><h2>Decision Tape</h2><span>PAPER</span></div>
            {data.decisions.length === 0 ? <p>No persisted decisions.</p> : (
              <div className="tape-list">
                {data.decisions.map((decision) => (
                  <article className="tape-row" key={decision.id}>
                    <div className="market-status-row">
                      <strong>{decision.action.toUpperCase()}</strong>
                      <time dateTime={decision.createdAt}>{decision.createdAt}</time>
                    </div>
                    <p>{decision.reason}</p>
                    <p className="market-note">Source: {decision.snapshotSource} · Recipe {decision.recipeHash}</p>
                    {decision.hookResults.length > 0 ? (
                      <details>
                        <summary>Decision trace ({decision.hookResults.length})</summary>
                        <ul>
                          {decision.hookResults.map((result, index) => <li key={`${result.hookId}:${index}`}>{result.hookId} · {result.status}: {result.reason}</li>)}
                        </ul>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
