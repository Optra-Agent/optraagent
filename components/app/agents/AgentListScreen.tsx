"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiErrorSchema, AgentListResponseSchema } from "../../../lib/domain/contracts";
import type { Agent } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";
import { formatUtc, shortHash, titleCase, errorText } from "../format";
import { JourneyRail, PageHeader, Skeleton, StateBlock, Panel } from "../ui";
import { TemplateCatalog } from "./TemplateCatalog";
import { HouseAgentCreator } from "./HouseAgentCreator";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Wallet } from "lucide-react";

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    return parsed.success ? parsed.data.error.message : "Your agent list is temporarily unavailable.";
  } catch {
    return "Your agent list is temporarily unavailable.";
  }
}

const nextAction: Record<Agent["status"], string> = {
  draft: "Backtest it in Lab, then launch on paper.",
  running: "Run a paper tick or read its Tape.",
  paused: "Resume it from the agent page.",
  stopped: "Stopped. Fork it to start a new draft.",
};

export function AgentListScreen() {
  const { session, status, setWalletMenuOpen } = useAuthSession();
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
        setResult({ key: requestKey, status: "error", agents: [], error: errorText(reason, "Your agent list is temporarily unavailable.") });
      });
    return () => controller.abort();
  }, [requestKey, status]);

  const journeyStep = status !== "signed_in" ? 1 : agents.some((agent) => agent.status !== "draft") ? 5 : agents.length > 0 ? 3 : 2;

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="PAPER ONLY"
        title="Agents"
        description="Rule-driven strategies with recorded inputs and explainable decisions. Start from a House Agent, backtest it, then run it on paper."
        actions={status === "signed_in" ? <Button variant="outline" type="button" disabled={loadStatus === "loading"} onClick={() => setReload((value) => value + 1)}>Refresh</Button> : null}
      />
      <JourneyRail step={journeyStep} />

      {status === "loading" ? <StateBlock kind="loading" title="Checking wallet session…" /> : null}
      {status === "error" ? <StateBlock kind="error" title="Wallet session could not be checked">Retry from the wallet control in the header.</StateBlock> : null}
      {status === "signed_out" ? (
        <div className="connect-card" role="region" aria-label="Wallet session">
          <span className="connect-icon" aria-hidden="true"><Wallet /></span>
          <div className="connect-copy">
            <h2>Connect to start</h2>
            <p>Connect a wallet to view your agents.</p>
            <p className="subtle">MetaMask and Phantom EVM on Robinhood Chain. Signing in proves wallet ownership only and never sends a transaction.</p>
          </div>
          <Button type="button" onClick={() => { setWalletMenuOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Choose a wallet</Button>
        </div>
      ) : null}

      {status === "signed_in" ? (
        <section className="agents-owned" aria-label="Your agents">
          <div className="section-heading">
            <div><p className="eyebrow">YOUR DESK</p><h2>Your agents</h2></div>
            {loadStatus === "ready" && agents.length > 0 ? <span>{agents.length} saved</span> : null}
          </div>
          {loadStatus === "loading" ? <div className="state-panel" role="status"><Skeleton lines={3} /></div> : null}
          {loadStatus === "error" ? <StateBlock kind="error" title="Agents could not be loaded" action={<Button variant="outline" type="button" onClick={() => setReload((value) => value + 1)}>Retry</Button>}>{error}</StateBlock> : null}
          {loadStatus === "ready" && agents.length === 0 ? (
            <StateBlock kind="empty" title="No saved agents">
              <p>Create the paper-ready Protective Put draft below, then run its verified backtest in Lab before launch.</p>
              <p className="subtle mono">Signed in as {session?.user.address}</p>
            </StateBlock>
          ) : null}
          {loadStatus === "ready" && agents.length > 0 ? (
            <div className="agent-grid">
              {agents.map((agent) => (
                <Card className="agent-card" key={agent.id}>
                  <div className="agent-card-head">
                    <div><p className="eyebrow">{titleCase(agent.templateId)}</p><h2>{agent.name}</h2></div>
                    <span className={`agent-status agent-status-${agent.status}`}>{agent.status}</span>
                  </div>
                  <p className="agent-next">{nextAction[agent.status]}</p>
                  <dl className="kv kv-tight">
                    <div><dt>Recipe</dt><dd className="mono" title={agent.recipeHash}>{shortHash(agent.recipeHash)}</dd></div>
                    <div><dt>Updated</dt><dd className="mono"><time dateTime={agent.updatedAt}>{formatUtc(agent.updatedAt)}</time></dd></div>
                  </dl>
                  <div className="agent-card-actions">
                    <Link className={buttonVariants({ variant: "outline" })} href={`/agents/${encodeURIComponent(agent.id)}`}>Open agent</Link>
                    {agent.status === "draft" ? <Link className={buttonVariants({ variant: "default" })} href={`/lab?agent=${encodeURIComponent(agent.id)}`}>Backtest in Lab</Link> : null}
                  </div>
                </Card>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="agents-layout">
        <TemplateCatalog />
        {status === "signed_in" ? <HouseAgentCreator /> : (
          <Panel className="creator creator-locked" id="configure" aria-label="Configure Protective Put draft">
            <div className="panel-head"><div><p className="eyebrow">STEP 2 · CONFIGURE</p><h2>Protective Put draft</h2></div></div>
            <p className="panel-lede">Sign in with a wallet to set the underlying, virtual reference shares and paper capital. Your draft is saved to your account only.</p>
          </Panel>
        )}
      </div>
    </main>
  );
}
