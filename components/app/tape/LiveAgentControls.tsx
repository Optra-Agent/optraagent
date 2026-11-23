"use client";

import { useEffect, useState } from "react";
import { useAuthSession } from "../AuthSessionProvider";
import { Chip, Panel } from "../ui";
import { Button } from "@/components/ui/button";
import { LiveAgentConfigure } from "./LiveAgentConfigure";
import { LiveAgentJourney } from "./LiveAgentJourney";
import { describeLiveRequest } from "@/lib/venue/callput-live-agent-request-text";
import { explorerTxUrl } from "@/lib/chain/mainnet-contracts";
import { accountBlockReason, describeAccountGates, type AccountGateFacts } from "@/lib/venue/callput-account-gates-text";

type LiveAgentStatus = {
  liveTradingEnabled: boolean;
  submissionRoute: string;
  control: { stopped: boolean; reason: string | null };
  accountGates?: ({ status: "ok" } & AccountGateFacts) | { status: "unavailable" } | { status: "not-configured" };
  venueDelegation?: { status: "ok"; fetchedAt: string; findings: Array<{ id: string; ok: boolean; detail: string }> } | { status: "unavailable" } | { status: "not-configured" };
  grants: Array<{ id: string; agentId: string; tradingAddress: string; route: string; status: "proposed" | "active" | "revoked"; expiresAt: string; missingEvidence: string[] }>;
  requests: Array<{ id: string; state: string; collateralRaw: string; transactionHash: string | null; requestKey: string | null; createdAt: string }>;
};

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const usdg = (raw: string) => `${(Number(raw) / 1e6).toFixed(2)} USDG`;

/** Owner controls for the automated CallPut agent: current state, emergency stop, and grant revocation. */
export function LiveAgentControls() {
  const { status: session } = useAuthSession();
  const [data, setData] = useState<LiveAgentStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (session !== "signed_in") return;
    const controller = new AbortController();
    void fetch("/api/venue/callput/live-agent", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Live Agent status is unavailable.");
        return (await response.json()) as LiveAgentStatus;
      })
      .then((body) => {
        setData(body);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Live Agent status is unavailable.");
      });
    return () => controller.abort();
  }, [session, refreshCount]);

  async function post(path: string, label: string) {
    setBusy(label);
    try {
      const response = await fetch(path, { method: "POST", credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(`${label} failed. Try again.`);
      setRefreshCount((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${label} failed.`);
    } finally {
      setBusy("");
    }
  }

  const active = data?.grants.filter((grant) => grant.status === "active") ?? [];
  return (
    <Panel id="live-agent" aria-label="Live Agent controls" className="scroll-mt-20">
      <div className="panel-head">
        <div><p className="eyebrow">AUTOMATED CALLPUT AGENT</p><h2>Agent controls</h2></div>
        <Chip tone={data && !data.control.stopped && active.length > 0 ? "ember" : "neutral"}>{data && !data.control.stopped && active.length > 0 ? "Armed" : "Stopped"}</Chip>
      </div>
      {session !== "signed_in" ? (
        <p className="panel-note">Connect a wallet to see and control your agent grants. The agent cannot place orders while it is stopped.</p>
      ) : !data ? (
        <p className="panel-note" role="status">{error || "Loading agent controls…"}</p>
      ) : (
        <>
          <dl className="metric-row" aria-label="Live Agent state">
            <div className="metric"><dt>Autonomous execution</dt><dd>{data.liveTradingEnabled ? "Enabled on this deployment" : "Off on this deployment"}</dd></div>
            <div className="metric"><dt>Submission route</dt><dd>{data.submissionRoute === "not-configured" ? "Not configured" : data.submissionRoute}</dd></div>
            <div className="metric"><dt>State</dt><dd>{data.control.stopped ? `Stopped${data.control.reason ? `: ${data.control.reason}` : ""}` : "Running"}</dd></div>
          </dl>
          <p className="panel-note">The autonomous execution engine is built and inactive: it can place an order only with an authorized session grant, all seven live gates passing and production acceptance. Until then every real order is approved by you in your own wallet, one transaction at a time (open, close and settle on this page).</p>
          <LiveAgentJourney liveTradingEnabled={data.liveTradingEnabled} control={data.control} account={data.accountGates?.status === "ok" ? { address: data.accountGates.account, created: data.accountGates.accountCreated, registered: data.accountGates.accountRegistered } : null} accountUsable={data.accountGates?.status === "ok" ? data.accountGates.accountUsable : null} grants={data.grants} requests={data.requests} />
          {data.accountGates?.status === "ok" ? (
            <p className="panel-note" aria-label="CallPut account gates">
              {accountBlockReason(data.accountGates) === null
                ? "CallPut's account factory would let your Account open today."
                : `CallPut's account factory would refuse an open today: ${accountBlockReason(data.accountGates)}. Read from the chain just now: ${describeAccountGates(data.accountGates)}.`}
            </p>
          ) : null}
          {data.venueDelegation?.status === "ok" ? (
            <details>
              <summary className="panel-note">What CallPut says it enforces for delegated sessions (read from CallPut {data.venueDelegation.fetchedAt.slice(0, 16).replace("T", " ")} UTC)</summary>
              <ul className="picker-list" aria-label="CallPut session properties">
                {data.venueDelegation.findings.map((finding) => (
                  <li key={finding.id}><span className="picker-name">{finding.ok ? "Yes" : "No"}</span><span className="picker-meta">{finding.detail}</span></li>
                ))}
              </ul>
              <p className="panel-note">This describes CallPut&apos;s own service, not an OPTRA permission. OPTRA holds no session key and has no grant.</p>
            </details>
          ) : data.venueDelegation?.status === "unavailable" ? (
            <p className="panel-note">CallPut&apos;s session details could not be read right now.</p>
          ) : null}
          {data.grants.length === 0 ? <p className="empty-line">No grants. A grant is proposed first and cannot trade until its venue, on-chain, audit and owner evidence is recorded.</p> : (
            <ul className="picker-list" aria-label="Agent grants">
              {data.grants.map((grant) => (
                <li key={grant.id}>
                  <span className="picker-name">{grant.agentId} · {grant.route}</span>
                  <span className="picker-meta mono">{short(grant.tradingAddress)} · expires {grant.expiresAt.slice(0, 10)}{grant.missingEvidence.length > 0 && grant.status !== "revoked" ? ` · missing ${grant.missingEvidence.length} evidence items` : ""}</span>
                  <span className="agent-status">{grant.status}</span>
                  {grant.status !== "revoked" ? <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => void post(`/api/venue/callput/live-agent/grants/${grant.id}/revoke`, "Revoke")}>Revoke</Button> : null}
                </li>
              ))}
            </ul>
          )}
          {data.requests.length > 0 ? (
            <ul className="picker-list" aria-label="Agent requests">
              {data.requests.slice(0, 5).map((request) => {
                const view = describeLiveRequest(request.state);
                return (
                  <li key={request.id} data-tone={view.tone}>
                    <span className="picker-name">{view.title}</span>
                    <span className="picker-meta mono">{usdg(request.collateralRaw)}{request.requestKey ? ` · ${short(request.requestKey)}` : ""}</span>
                    <span className="picker-meta">{view.meaning}</span>
                    {view.recovery ? <span className="picker-meta" role="note"><strong>What to do:</strong> {view.recovery}{request.transactionHash ? <> <a className="claim-link" href={explorerTxUrl(request.transactionHash)} target="_blank" rel="noreferrer">Open the transaction</a></> : null}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <LiveAgentConfigure tradingAddress={data.accountGates?.status === "ok" ? data.accountGates.account : null} accountUsable={data.accountGates?.status === "ok" ? data.accountGates.accountUsable : null} onProposed={() => setRefreshCount((count) => count + 1)} />
          <div className="panel-actions">
            <Button type="button" variant="outline" disabled={busy !== "" || data.control.stopped} onClick={() => void post("/api/venue/callput/live-agent/stop", "Emergency stop")}>Emergency stop</Button>
          </div>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </>
      )}
    </Panel>
  );
}
