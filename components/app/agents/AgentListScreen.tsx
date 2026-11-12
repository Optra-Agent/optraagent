"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiErrorSchema, AgentListResponseSchema } from "../../../lib/domain/contracts";
import type { Agent } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";
import { TemplateCatalog } from "./TemplateCatalog";
import { HouseAgentCreator } from "./HouseAgentCreator";

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    return parsed.success ? parsed.data.error.message : "Your agent list is temporarily unavailable.";
  } catch {
    return "Your agent list is temporarily unavailable.";
  }
}

export function AgentListScreen() {
  const { session, status } = useAuthSession();
  const [result, setResult] = useState<{ key: string; status: "ready" | "error"; agents: Agent[]; error: string }>({ key: "", status: "ready", agents: [], error: "" });
  const [reload, setReload] = useState(0);
  const requestKey = `${session?.user.id ?? ""}:${reload}`;
  const loadStatus = result.key === requestKey ? result.status : "loading";
  const agents = result.key === requestKey ? result.agents : [];
  const error = result.key === requestKey ? result.error : "";

  useEffect(() => {
    if (status !== "signed_in") return;
    const controller = new AbortController();
    void fetch("/api/agents", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return AgentListResponseSchema.parse(await response.json());
      })
      .then((result) => {
        setResult({ key: requestKey, status: "ready", agents: result.agents, error: "" });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, status: "error", agents: [], error: reason instanceof Error ? reason.message : "Your agent list is temporarily unavailable." });
      });
    return () => controller.abort();
  }, [requestKey, status]);

  return (
    <main className="page-container">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">PAPER ONLY</p>
          <h1>Agents</h1>
          <p className="page-description">Rule-driven strategies with recorded inputs and explainable decisions.</p>
        </div>
        {status === "signed_in" ? <button className="button button-secondary" type="button" disabled={loadStatus === "loading"} onClick={() => setReload((value) => value + 1)}>Refresh</button> : null}
      </div>

      {status === "loading" ? <section className="state-panel" role="status">Checking wallet session…</section> : null}
      {status === "error" ? <section className="state-panel" role="alert">Wallet session could not be checked. Retry from the wallet control above.</section> : null}
      {status === "signed_out" ? (
        <section className="state-panel">
          <h2>No agent session</h2>
          <p>Connect a wallet to view your agents.</p>
        </section>
      ) : null}
      {status === "signed_in" ? <HouseAgentCreator /> : null}
      {status === "signed_in" && loadStatus === "loading" ? <section className="state-panel" role="status">Loading your agents…</section> : null}
      {status === "signed_in" && loadStatus === "error" ? <section className="state-panel" role="alert">{error}</section> : null}
      {status === "signed_in" && loadStatus === "ready" && agents.length === 0 ? (
        <section className="state-panel">
          <h2>No saved agents</h2>
          <p>Create the paper-ready Protective Put draft, then run its verified backtest in Lab before launch.</p>
          <p className="subtle">Signed in as {session?.user.address}</p>
        </section>
      ) : null}
      {status === "signed_in" && loadStatus === "ready" && agents.length > 0 ? (
        <div className="agent-grid" aria-label="Your agents">
          {agents.map((agent) => (
            <article className="state-panel agent-card" key={agent.id}>
              <div className="market-status-row">
                <div><p className="eyebrow">{agent.templateId.replaceAll("_", " ")}</p><h2>{agent.name}</h2></div>
                <span className={`agent-status agent-status-${agent.status}`}>{agent.status}</span>
              </div>
              <p className="market-note">Recipe {agent.recipeHash}</p>
              <Link className="button button-secondary agent-detail-link" href={`/agents/${encodeURIComponent(agent.id)}`}>Open agent</Link>
            </article>
          ))}
        </div>
      ) : null}
      <TemplateCatalog />
    </main>
  );
}
