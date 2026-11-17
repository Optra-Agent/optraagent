"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, PublicVerificationSchema } from "../../../lib/domain/contracts";
import type { PublicClaim, PublicVerification } from "../../../lib/domain/contracts";
import { Chip, PageHeader, StateBlock, Panel } from "../ui";
import type { Tone } from "../ui";
import { errorText } from "../format";

const statusLabel: Record<PublicClaim["status"], { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "azure" },
  limited: { label: "Limited", tone: "neutral" },
  preview: { label: "Preview", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "ember" },
  disabled: { label: "Disabled", tone: "ember" },
};

const claimTitle: Record<string, string> = {
  market_data: "Market data",
  hook_catalog: "Hook catalog",
  house_agents: "House Agents",
  historical_backtest: "Historical backtest",
  live_execution: "Live execution",
};

const roadmap = [
  ["AI strategy composition", "Planned", "No AI provider is configured. Rules decide; recipes are built by clicking."],
  ["Public agents and Tape", "Planned", "There is no public visibility model, so public lists return empty."],
  ["Live options trading", "Not enabled", "Needs a verified options execution venue, explicit wallet authorization, enforced risk and transaction limits, and a real order lifecycle with settlement records. Nothing can submit a real-money order today."],
  ["Onchain Uniswap v4 hooks", "Not deployed", "Hooks are inspired by Uniswap v4. An experimental spot-swap guard exists in the repository and passes local tests. No Optra contract is deployed to Robinhood Testnet or Mainnet, and it is not part of options execution (claim level L0)."],
  ["Listing, Floor, MCP, x402", "Planned", "Roadmap items with no route or service yet."],
] as const;

export function VerifyScreen() {
  const [verification, setVerification] = useState<PublicVerification | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/v1/verify", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        let body: unknown = null;
        try { body = await response.json(); } catch { /* reported as an invalid response */ }
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(body);
          throw new Error(parsed.success ? parsed.data.error.message : "Verification claims are temporarily unavailable.");
        }
        return PublicVerificationSchema.parse(body);
      })
      .then((result) => {
        setVerification(result);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorText(reason, "Verification claims are temporarily unavailable."));
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="BUILT, NOT PROMISED"
        title="Verify"
        description="Every statement below comes from the server's public verification payload, with a link to the evidence behind it. Nothing here is hand-written marketing."
      />

      {status === "loading" ? <StateBlock kind="loading" title="Loading verification claims…" /> : null}
      {status === "error" ? <StateBlock kind="error" title="Claims unavailable"><p>{error}</p></StateBlock> : null}
      {verification ? (
        <>
          <dl className="metric-row" aria-label="Safety switches">
            <div className="metric"><dt>Live trading</dt><dd>{verification.liveTradingEnabled ? "Enabled" : "Disabled"}</dd></div>
            <div className="metric"><dt>Uniswap v4 claim level</dt><dd className="mono">{verification.v4ClaimLevel}</dd></div>
            <div className="metric"><dt>Claims reported</dt><dd className="mono">{verification.claims.length}</dd></div>
          </dl>
          <Panel  aria-label="Verified claims">
            <div className="panel-head"><h2>Claims and evidence</h2></div>
            <ul className="claim-list">
              {verification.claims.map((claim) => {
                const meta = statusLabel[claim.status];
                return (
                  <li key={claim.id} className="claim">
                    <div className="claim-head">
                      <h3>{claimTitle[claim.id] ?? claim.id.replaceAll("_", " ")}</h3>
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                    </div>
                    <p>{claim.statement}</p>
                    <a className="claim-link mono" href={claim.evidencePath} target="_blank" rel="noreferrer">Evidence: {claim.evidencePath}</a>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </>
      ) : null}

      <Panel  aria-label="Not yet shipped">
        <div className="panel-head"><h2>Not shipped yet</h2></div>
        <ul className="claim-list">
          {roadmap.map(([title, label, text]) => (
            <li key={title} className="claim">
              <div className="claim-head"><h3>{title}</h3><Chip>{label}</Chip></div>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
