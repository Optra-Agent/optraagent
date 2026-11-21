"use client";

import { useEffect, useState } from "react";
import { useAuthSession } from "../AuthSessionProvider";
import { Chip, Panel } from "../ui";
import { Button } from "@/components/ui/button";

type LiveAgentStatus = {
  liveTradingEnabled: boolean;
  submissionRoute: string;
  control: { stopped: boolean; reason: string | null };
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
    <Panel aria-label="Live Agent controls">
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
              {data.requests.slice(0, 5).map((request) => (
                <li key={request.id}><span className="picker-name">{request.state}</span><span className="picker-meta mono">{usdg(request.collateralRaw)}{request.requestKey ? ` · ${short(request.requestKey)}` : ""}</span></li>
              ))}
            </ul>
          ) : null}
          <div className="panel-actions">
            <Button type="button" variant="outline" disabled={busy !== "" || data.control.stopped} onClick={() => void post("/api/venue/callput/live-agent/stop", "Emergency stop")}>Emergency stop</Button>
          </div>
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </>
      )}
    </Panel>
  );
}
