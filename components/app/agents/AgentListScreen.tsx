"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, AgentListResponseSchema } from "../../../lib/domain/contracts";
import type { Agent } from "../../../lib/domain/contracts";
import { useAuthSession } from "../AuthSessionProvider";
import { errorText } from "../format";
import { JourneyRail, PageHeader, StateBlock, Panel } from "../ui";
import { AgentGallery } from "./AgentGallery";
import { HouseAgentCreator } from "./HouseAgentCreator";
import { Button } from "@/components/ui/button";
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
    <main className="page-container ag-page">
      <PageHeader
        eyebrow="PAPER ONLY"
        title="Agents"
        description="Rule-driven strategies with recorded inputs and explainable decisions. Start from a House Agent, backtest it, then run it on paper."
        actions={status === "signed_in" ? null : <a className="ag-build" href="#configure">Build your agent</a>}
      />
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

      <AgentGallery owned={agents} ownedStatus={status === "signed_in" ? loadStatus : "ready"} ownedError={error} signedIn={status === "signed_in"} onRetry={() => setReload((value) => value + 1)} />

      <div className="ag-configure">
        <JourneyRail step={journeyStep} />
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
