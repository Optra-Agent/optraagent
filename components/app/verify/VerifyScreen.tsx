"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, PublicVerificationSchema } from "../../../lib/domain/contracts";
import type { PublicClaim, PublicVerification } from "../../../lib/domain/contracts";
import { Chip, PageHeader, StateBlock, Panel } from "../ui";
import type { Tone } from "../ui";
import { errorText } from "../format";
import { LIVE_ENGINE_BUILT, LIVE_ENGINE_STATUS, LIVE_REQUIREMENTS } from "../live-requirements";
import { TRADING_CAPABILITY_CLAIM_IDS, TRADING_CAPABILITY_TITLES } from "../../../lib/public/trading-capabilities";
import { MAINNET_CHAIN_ID, MAINNET_CONTRACTS, MAINNET_EXTERNAL_CONTRACTS, explorerAddressUrl, explorerTxUrl } from "../../../lib/chain/mainnet-contracts";

const statusLabel: Record<PublicClaim["status"], { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "azure" },
  limited: { label: "Limited", tone: "neutral" },
  preview: { label: "Preview", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "ember" },
  disabled: { label: "Gated", tone: "ember" },
};

const claimTitle: Record<string, string> = {
  market_data: "Market data",
  hook_catalog: "Hook catalog",
  house_agents: "House Agent templates",
  public_house_agents: "Running House Agents",
  decision_tape: "Decision Tape",
  historical_backtest: "Historical backtest",
};

type Capability = { title: string; label: string; tone: Tone; text: string; evidence?: string };

/** What is true today, grouped by product state. These are different states, not one list of missing features. */
const availableNow: readonly Capability[] = [
  { title: "Paper trading with House Agents", label: "Available now", tone: "azure", text: "OPTRA-owned House Agents evaluate recorded Robinhood Chain prices every hour with virtual capital and modeled premiums. Users backtest, launch and run their own paper agents. The running count is in the claims below, read from the database." },
  { title: "Decision Tape", label: "Available now", tone: "azure", text: "Every evaluation, including holds and skips, is persisted with its candle, rule trace and data provenance. It stays empty while the US market is closed; no decision is generated outside the regular session." },
  { title: "Manual CallPut trading", label: "Wallet-signed", tone: "azure", text: "Spread orders are quoted, reviewed and signed in your own wallet, one confirmed transaction at a time, with an exact funding preflight. Close and settle work the same way. Close and settle passed 23 of 23 checks on a Mainnet fork; no live open, close or settle has been verified yet." },
];

const builtUnderAcceptance: readonly Capability[] = [
  { title: "Autonomous Agent Engine", label: LIVE_ENGINE_STATUS, tone: "neutral", text: `Built: ${LIVE_ENGINE_BUILT.join("; ").toLowerCase()}. It passed 25 of 25 checks on a Mainnet fork (repository evidence: docs/evidence/callput/live-agent-fork-acceptance-20261122.log). Production real-money execution is inactive and no OPTRA agent places an order. Activation needs: ${LIVE_REQUIREMENTS.map((item) => item.title.charAt(0).toLowerCase() + item.title.slice(1)).join("; ")}.` },
  { title: "OptraGuardHook (Uniswap v4-inspired spot-swap guard)", label: "Deployed, unaudited", tone: "neutral", text: "One experimental guard is deployed to Robinhood Chain Mainnet (see Mainnet contracts below). It is unaudited, uninitialized with no pool, holds no funds and is not part of options execution. The Uniswap v4 claim level is L0." },
];

const roadmap: readonly Capability[] = [
  { title: "AI strategy composition", label: "Planned", tone: "neutral", text: "No AI provider is configured. Rules decide; recipes are built by clicking." },
  { title: "Community public agents", label: "Planned", tone: "neutral", text: "Only OPTRA's own House Agents are public. A user's agent and its Tape stay private to the wallet that owns them." },
  { title: "Listing, Floor, MCP, x402", label: "Planned", tone: "neutral", text: "Roadmap items with no route or service yet." },
];

function CapabilityPanel({ name, heading, items }: { name: string; heading: string; items: readonly Capability[] }) {
  return (
    <Panel aria-label={name}>
      <div className="panel-head"><h2>{heading}</h2></div>
      <ul className="claim-list">
        {items.map((item) => (
          <li key={item.title} className="claim">
            <div className="claim-head"><h3>{item.title}</h3><Chip tone={item.tone}>{item.label}</Chip></div>
            <p>{item.text}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

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
        description="The capability summary is written by OPTRA. Every claim under Technical verification comes from the server's public verification payload, with a link to the evidence behind it."
      />

      {status === "loading" ? <StateBlock kind="loading" title="Loading verification claims…" /> : null}
      {status === "error" ? <StateBlock kind="error" title="Claims unavailable"><p>{error}</p></StateBlock> : null}
      <CapabilityPanel name="Available now" heading="Available now" items={availableNow} />
      <CapabilityPanel name="Built and under acceptance" heading="Built and under acceptance" items={builtUnderAcceptance} />
      <CapabilityPanel name="Roadmap" heading="Roadmap" items={roadmap} />
      <div className="panel-head"><h2>Technical verification</h2></div>

      {verification ? (
        <>
          <dl className="metric-row" aria-label="Trading status">
            {TRADING_CAPABILITY_CLAIM_IDS.map((id) => {
              const claim = verification.claims.find((entry) => entry.id === id);
              return <div className="metric" key={id}><dt>{TRADING_CAPABILITY_TITLES[id]}</dt><dd className="status-text">{claim ? (claim.label ?? statusLabel[claim.status].label) : "Not reported"}</dd></div>;
            })}
            <div className="metric"><dt>Autonomous execution switch</dt><dd className="status-text">{verification.liveTradingEnabled ? "On" : "Off"}</dd></div>
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
                      <h3>{claimTitle[claim.id] ?? TRADING_CAPABILITY_TITLES[claim.id] ?? claim.id.replaceAll("_", " ")}</h3>
                      <Chip tone={meta.tone}>{claim.label ?? meta.label}</Chip>
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

    </main>
  );
}
