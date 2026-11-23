"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import { useAuthSession } from "../AuthSessionProvider";
import { Chip, Panel } from "../ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type Gate = { id: string; title: string; pass: boolean; detail: string; remediation: string | null; evidence: string[] };
type GateStatus = {
  allPass: boolean;
  canEnableLive: boolean;
  gates: Gate[];
  venue: { checkedAt: string; summary: { total: number; verified: number; partial: number; open: number; blocked: number }; rows: Array<{ id: string; item: string; status: string; finding: string; evidence: string }> };
  caps: { capitalPerLiveAgentUsd: number; newExposurePerUserPerDayUsd: number; liveAgentsPerUser: number; maxPremiumPerPositionUsd: number; openPositionsPerAgent: number; maxSlippagePercent: number };
  acknowledgement: { version: string; statements: Array<{ id: string; text: string }> };
};

/** PM §16.3 "Enable live": G1–G7 with status, evidence and remediation. It reports; it cannot arm anything. */
export function LiveGatesPanel() {
  const { status: session } = useAuthSession();
  const [data, setData] = useState<GateStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/live/gates/acknowledge", { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: data.acknowledgement.version, statementIds: checked }) });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The acknowledgement could not be recorded.");
      }
      setNotice("Acknowledgement recorded. It is saved to your wallet account and survives a refresh.");
      setChecked([]);
      setRefreshCount((count) => count + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The acknowledgement could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string, value: boolean) => setChecked((current) => (value ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id)));
  const g7 = data?.gates.find((gate) => gate.id === "G7");
  const passing = data?.gates.filter((gate) => gate.pass).length ?? 0;
  const everyChecked = data !== null && data.acknowledgement.statements.every((statement) => checked.includes(statement.id));
  return (
    <Panel id="enable-live" aria-label="Enable live" className="scroll-mt-20">
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
          <ol className="gate-list" aria-label="Live gates">
            {data.gates.map((gate) => (
              <li key={gate.id} className="gate-row" data-pass={gate.pass}>
                <span className="gate-id" aria-hidden="true">{gate.id}</span>
                <div className="gate-body">
                  <div className="gate-head">
                    <h3 aria-label={`${gate.id} ${gate.title}`}>{gate.title}</h3>
                    <span className="gate-chip" data-pass={gate.pass}>{gate.pass ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{gate.pass ? "Pass" : "Not met"}</span>
                  </div>
                  <p className="gate-detail">{gate.detail}</p>
                  {gate.remediation ? <p className="gate-fix"><strong>To unblock</strong> {gate.remediation}</p> : null}
                  {gate.evidence.length > 0 ? (
                    <details className="gate-evidence">
                      <summary>Evidence ({gate.evidence.length})</summary>
                      <ul>{gate.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {g7 && !g7.pass ? (
            <fieldset className="ack" aria-describedby="ack-help">
              <legend>Options risk acknowledgement</legend>
              <p id="ack-help" className="ack-help">Read each statement and tick it yourself. Nothing is ticked for you, and recording is only possible when all three are ticked.</p>
              {data.acknowledgement.statements.map((statement) => {
                const id = `ack-${statement.id}`;
                return (
                  <Label key={statement.id} htmlFor={id} className="ack-row" data-disabled={busy}>
                    <Checkbox id={id} checked={checked.includes(statement.id)} disabled={busy} onCheckedChange={(value) => toggle(statement.id, value === true)} />
                    <span>{statement.text}</span>
                  </Label>
                );
              })}
              <div className="ack-actions">
                <Button type="button" disabled={!everyChecked || busy} onClick={() => void acknowledge()}>
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}{busy ? "Recording…" : "Record acknowledgement"}
                </Button>
                <span className="ack-count" aria-live="polite">{checked.length} of {data.acknowledgement.statements.length} ticked</span>
              </div>
            </fieldset>
          ) : null}
          {g7?.pass ? <p className="ack-done" role="status"><CheckCircle2 aria-hidden="true" />Risk acknowledgement on record. {g7.evidence[0] ?? ""}</p> : null}
          {notice ? <p className="ack-done" role="status"><CheckCircle2 aria-hidden="true" />{notice}</p> : null}
          {error ? <p role="alert" className="form-error">{error}</p> : null}

          <p className="panel-note">Venue checklist V1–V{data.venue.summary.total}: {data.venue.summary.verified} verified, {data.venue.summary.partial} partial, {data.venue.summary.open} open, {data.venue.summary.blocked} blocked (checked {data.venue.checkedAt}).</p>
          <details className="gate-evidence">
            <summary>Venue checklist detail</summary>
            <ul aria-label="Venue checklist">
              {data.venue.rows.map((row) => (
                <li key={row.id}><strong>{row.id} · {row.item}</strong> <span className="gate-chip" data-pass={row.status === "verified"}>{row.status}</span><br />{row.finding}</li>
              ))}
            </ul>
          </details>
          <p className="panel-note">Beta caps: ${data.caps.capitalPerLiveAgentUsd} per live agent, ${data.caps.newExposurePerUserPerDayUsd} new exposure per day, {data.caps.liveAgentsPerUser} live agent, ${data.caps.maxPremiumPerPositionUsd} per position, {data.caps.openPositionsPerAgent} open positions, never naked short. The engine&apos;s own limits are stricter.</p>
          <div className="panel-actions">
            <Button type="button" disabled>{data.canEnableLive ? "Enable live (arm the grant outside this screen)" : "Enable live (every gate must pass)"}</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
