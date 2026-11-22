"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, PublicVerificationSchema } from "../../../lib/domain/contracts";
import type { PublicClaim, PublicVerification } from "../../../lib/domain/contracts";
import { Chip, PageHeader, StateBlock, Panel } from "../ui";
import type { Tone } from "../ui";
import { errorText } from "../format";
import { MAINNET_CHAIN_ID, MAINNET_CONTRACTS, MAINNET_EXTERNAL_CONTRACTS, explorerAddressUrl, explorerTxUrl } from "../../../lib/chain/mainnet-contracts";

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
  public_house_agents: "Running House Agents",
  decision_tape: "Decision Tape",
  historical_backtest: "Historical backtest",
  live_execution: "Live execution",
};

const roadmap = [
  ["AI strategy composition", "Planned", "No AI provider is configured. Rules decide; recipes are built by clicking."],
  ["Community public agents", "Planned", "Only OPTRA's own House Agents are public. A user's agent and its Tape stay private to the wallet that owns them."],
  ["Live options trading", "Wallet-signed opens only", "Needs a verified options execution venue, explicit wallet authorization, enforced risk and transaction limits, and a real order lifecycle with settlement records. A wallet-signed CallPut spread order panel can open positions from your own wallet, one confirmed transaction at a time; close and settle signing are disabled, and no OPTRA agent can submit a real-money order."],
  ["Onchain Uniswap v4 hooks", "Deployed, inactive", "Hooks are inspired by Uniswap v4. One experimental spot-swap guard, OptraGuardHook, is deployed to Robinhood Chain Mainnet (see Mainnet contracts above). It is unaudited, has no pool, holds no funds and is not part of options execution (claim level L0)."],
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

      <Panel aria-label="Mainnet contracts">
        <div className="panel-head"><h2>Mainnet contracts</h2></div>
        <p>OPTRA-owned contracts on Robinhood Chain Mainnet (chain {MAINNET_CHAIN_ID}). Deployment only: unaudited, no pool initialized, no funds held. Source verification is a partial match on the explorer; it is not an audit.</p>
        <ul className="claim-list">
          {MAINNET_CONTRACTS.map((contract) => (
            <li key={contract.address} className="claim">
              <div className="claim-head"><h3>{contract.name}</h3><Chip tone="neutral">Deployed, unaudited</Chip></div>
              <p>{contract.operationalStatus}</p>
              <p>Bytecode: {contract.bytecodeStatus} Runtime keccak <span className="mono break-all">{contract.runtimeKeccak}</span></p>
              <p>Source: {contract.sourceStatus}</p>
              <p>Ownership and configuration read back from the live contract:</p>
              <ul>
                {contract.configuration.map(([label, value]) => (
                  <li key={label}><span>{label}: </span><span className="mono break-all">{value}</span></li>
                ))}
              </ul>
              <a className="claim-link mono" href={explorerAddressUrl(contract.address)} target="_blank" rel="noreferrer">Contract: {contract.address}</a>
              <a className="claim-link mono" href={explorerTxUrl(contract.deploymentTx)} target="_blank" rel="noreferrer">Deployment tx: {contract.deploymentTx} (block {contract.block.toLocaleString("en-US")})</a>
              <span className="claim-link mono">Evidence: {contract.evidencePath}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel aria-label="External CallPut venue contracts">
        <div className="panel-head"><h2>External venue contracts (CallPut)</h2></div>
        <p>Third-party contracts on chain {MAINNET_CHAIN_ID} that OPTRA reads and, for wallet-signed spread orders, sends your transactions to. OPTRA does not own, operate, control or audit them.</p>
        <ul className="claim-list">
          {MAINNET_EXTERNAL_CONTRACTS.map((contract) => (
            <li key={contract.address} className="claim">
              <div className="claim-head"><h3>{contract.name}</h3><Chip tone="neutral">External</Chip></div>
              <p>{contract.role}</p>
              <a className="claim-link mono" href={explorerAddressUrl(contract.address)} target="_blank" rel="noreferrer">{contract.address}</a>
              {contract.implementation ? <span className="claim-link mono">Implementation: {contract.implementation}</span> : null}
            </li>
          ))}
        </ul>
      </Panel>

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
