"use client";

import { useEffect, useState } from "react";
import { useAuthSession } from "../AuthSessionProvider";
import { Chip, Panel } from "../ui";
import { Button } from "@/components/ui/button";

type Gate = { id: string; title: string; pass: boolean; detail: string; remediation: string | null };
type GateStatus = {
  allPass: boolean;
  canEnableLive: boolean;
  gates: Gate[];
  venue: { checkedAt: string; summary: { total: number; verified: number; partial: number; open: number; blocked: number }; rows: Array<{ id: string; item: string; status: string; finding: string }> };
  caps: { capitalPerLiveAgentUsd: number; newExposurePerUserPerDayUsd: number; liveAgentsPerUser: number; maxPremiumPerPositionUsd: number; openPositionsPerAgent: number; maxSlippagePercent: number };
  acknowledgement: { version: string; statements: Array<{ id: string; text: string }> };
};

/** PM §16.3 "Enable live": G1–G7 with a status and a remediation per row. It reports; it cannot arm anything. */
export function LiveGatesPanel() {
  const { status: session } = useAuthSession();
  const [data, setData] = useState<GateStatus | null>(null);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (session !== "signed_in") return;
    const controller = new AbortController();
    void fetch("/api/live/gates", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Live gate status is unavailable.");
        return (await response.json()) as GateStatus;
      })
      .then((body) => { setData(body); setError(""); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Live gate status is unavailable."); });
    return () => controller.abort();
  }, [session, refreshCount]);

  async function acknowledge() {
    if (!data) return;
    setBusy(true);
    try {
      const response = await fetch("/api/live/gates/acknowledge", { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: data.acknowledgement.version, statementIds: checked }) });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The acknowledgement could not be recorded.");
      }
      setRefreshCount((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The acknowledgement could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const g7 = data?.gates.find((gate) => gate.id === "G7");
  const passing = data?.gates.filter((gate) => gate.pass).length ?? 0;
  const everyChecked = data !== null && data.acknowledgement.statements.every((statement) => checked.includes(statement.id));
  return (
    <Panel aria-label="Enable live">
      <div className="panel-head">
        <div><p className="eyebrow">GUARDED LIVE BETA</p><h2>Enable live</h2></div>
        <Chip tone={data?.allPass ? "ember" : "neutral"}>{data ? `${passing} of ${data.gates.length} gates pass` : "Not evaluated"}</Chip>
      </div>
      {session !== "signed_in" ? (
        <p className="panel-note">Connect a wallet to see which live-trading gates you meet. Your agents keep running on paper either way.</p>
      ) : !data ? (
        <p className="panel-note" role="status">{error || "Evaluating gates…"}</p>
      ) : (
        <>
          <ul className="picker-list" aria-label="Live gates">
            {data.gates.map((gate) => (
              <li key={gate.id}>
                <span className="picker-name">{gate.id} · {gate.title}</span>
                <span className="agent-status">{gate.pass ? "Pass" : "Not met"}</span>
                <span className="picker-meta">{gate.detail}{gate.remediation ? ` To fix: ${gate.remediation}` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="panel-note">Venue checklist V1–V{data.venue.summary.total}: {data.venue.summary.verified} verified, {data.venue.summary.partial} partial, {data.venue.summary.open} open, {data.venue.summary.blocked} blocked (checked {data.venue.checkedAt}).</p>
          <details>
            <summary className="panel-note">Venue checklist detail</summary>
            <ul className="picker-list" aria-label="Venue checklist">
              {data.venue.rows.map((row) => (
                <li key={row.id}><span className="picker-name">{row.id} · {row.item}</span><span className="agent-status">{row.status}</span><span className="picker-meta">{row.finding}</span></li>
              ))}
            </ul>
          </details>
          {g7 && !g7.pass ? (
            <fieldset className="picker-list">
              <legend className="panel-note">Options risk acknowledgement</legend>
              {data.acknowledgement.statements.map((statement) => (
                <label key={statement.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={checked.includes(statement.id)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, statement.id] : current.filter((id) => id !== statement.id))} />
                  {statement.text}
                </label>
              ))}
              <Button type="button" variant="outline" disabled={!everyChecked || busy} onClick={() => void acknowledge()}>Record acknowledgement</Button>
            </fieldset>
          ) : null}
          <p className="panel-note">Beta caps: ${data.caps.capitalPerLiveAgentUsd} per live agent, ${data.caps.newExposurePerUserPerDayUsd} new exposure per day, {data.caps.liveAgentsPerUser} live agent, ${data.caps.maxPremiumPerPositionUsd} per position, {data.caps.openPositionsPerAgent} open positions, never naked short. The engine&apos;s own limits are stricter.</p>
          <div className="panel-actions">
            <Button type="button" disabled>{data.canEnableLive ? "Enable live (arm the grant outside this screen)" : "Enable live (every gate must pass)"}</Button>
          </div>
          {!data.gates.find((gate) => gate.id === "G3")?.pass ? <p className="panel-note">Live trading is not open yet. Your agent keeps running on paper.</p> : null}
          {error ? <p role="alert" className="form-error">{error}</p> : null}
        </>
      )}
    </Panel>
  );
}
