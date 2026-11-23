"use client";

import { useEffect, useState } from "react";
import { PublicVerificationSchema } from "../../../lib/domain/contracts";
import type { PublicClaim } from "../../../lib/domain/contracts";
import { TRADING_CAPABILITY_CLAIM_IDS, TRADING_CAPABILITY_TITLES } from "../../../lib/public/trading-capabilities";
import { Panel } from "../ui";

/** The three trading capabilities exactly as the public verification response reports them (the same source as Landing and Verify). */
export function TradingCapabilityStrip() {
  const [claims, setClaims] = useState<PublicClaim[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/v1/verify", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return PublicVerificationSchema.parse(await response.json());
      })
      .then((result) => setClaims(result.claims.filter((claim) => TRADING_CAPABILITY_CLAIM_IDS.includes(claim.id))))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  return (
    <Panel aria-label="Trading capabilities">
      <div className="panel-head"><div><p className="eyebrow">WHAT WORKS TODAY</p><h2>Trading capabilities</h2></div></div>
      {claims ? (
        <dl className="metric-row" aria-label="Trading capability status">
          {TRADING_CAPABILITY_CLAIM_IDS.map((id) => {
            const claim = claims.find((entry) => entry.id === id);
            return <div className="metric" key={id}><dt>{TRADING_CAPABILITY_TITLES[id]}</dt><dd className="status-text">{claim?.label ?? "Not reported"}</dd></div>;
          })}
        </dl>
      ) : (
        <p className="panel-note" role="status">{failed ? "Capability status is temporarily unavailable. Wallet-signed actions below still show their own review and risk checks." : "Loading capability status…"}</p>
      )}
      <p className="panel-note">Every open, close and settle needs your explicit confirmation in your own wallet. A submitted transaction is not a fill until the venue&apos;s request reads Executed. Autonomous execution is separate and is not active.</p>
    </Panel>
  );
}
