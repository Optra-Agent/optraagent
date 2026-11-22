"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { Button } from "@/components/ui/button";
import { Chip, Panel } from "../ui";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "@/lib/venue/callput-robinhood-readonly";
import { readCallPutWalletState, type CallPutWalletState } from "@/lib/venue/callput-robinhood-write";
import { readCallPutAccountGates } from "@/lib/venue/callput-account-gates";
import { accountBlockReason, describeAccountGates, type AccountGateFacts } from "@/lib/venue/callput-account-gates-text";
import { evaluateDirectWalletReadiness, usSessionState } from "@/lib/venue/callput-wallet-readiness";

/**
 * Read-only readiness of the CONNECTED wallet for a direct-wallet CallPut order, plus the separate CallPut Account route
 * for that same wallet. It reads the chain and signs nothing.
 */
export function CallPutWalletReadiness() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const [wallet, setWallet] = useState<CallPutWalletState | null>(null);
  const [account, setAccount] = useState<AccountGateFacts | null>(null);
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!address || !publicClient) return;
    const client = publicClient as PublicClient;
    let active = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [state, gates, gas] = await Promise.allSettled([readCallPutWalletState(client, address), readCallPutAccountGates(client, address), client.getGasPrice()]);
        if (!active) return;
        setGasPrice(gas.status === "fulfilled" ? gas.value : null);
        setWallet(state.status === "fulfilled" ? state.value : null);
        setAccount(gates.status === "fulfilled" ? gates.value : null);
        if (state.status === "rejected") setError(state.reason instanceof Error ? state.reason.message : "Wallet balances could not be read.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [address, publicClient, nonce]);

  if (!isConnected || !address) {
    return (
      <Panel aria-label="Wallet readiness" className="mb-5 p-5 sm:p-6">
        <div className="panel-head"><div><p className="eyebrow">WALLET READINESS</p><h2>Connected wallet</h2></div><Chip tone="neutral">Not connected</Chip></div>
        <p className="panel-note">Connect MetaMask with the wallet button at the top. This panel then shows the full connected address, its Robinhood Mainnet balances, and whether it is ready for a direct-wallet order.</p>
      </Panel>
    );
  }

  const checks = evaluateDirectWalletReadiness(wallet, chainId, gasPrice);
  const ready = checks.every((check) => check.ok);
  const session = usSessionState(new Date());
  const reason = account ? accountBlockReason(account) : null;
  const report = [
    "OPTRA wallet readiness (read-only)",
    `Connected address: ${address}`,
    `Chain: ${chainId ?? "unknown"} (required ${CALLPUT_ROBINHOOD_CHAIN_ID})`,
    ...checks.map((check) => `${check.ok ? "OK" : "NO"} ${check.id}: ${check.detail}`),
    `US session: ${session.label}`,
    account ? `CallPut Account route: ${describeAccountGates(account)}${reason ? `; would refuse: ${reason}` : ""}` : "CallPut Account route: not read",
  ].join("\n");

  return (
    <Panel aria-label="Wallet readiness" className="mb-5 p-5 sm:p-6">
      <div className="panel-head">
        <div><p className="eyebrow">WALLET READINESS</p><h2>Connected wallet</h2></div>
        <Chip tone={ready ? "ember" : "neutral"}>{loading ? "Reading…" : ready ? "Ready to prepare" : "Not ready"}</Chip>
      </div>
      <p className="mono break-all text-sm" aria-label="Connected address" data-testid="connected-address">{address}</p>
      <p className="panel-note">This is the wallet that signs and owns the position on the direct-wallet route. It is not OPTRA&apos;s deployment signer, and nothing here sends a transaction.</p>
      <ul className="gate-evidence" aria-label="Readiness checks">
        {checks.map((check) => <li key={check.id}>{check.ok ? "OK" : "Not yet"} · {check.detail}</li>)}
      </ul>
      <p className="panel-note">{session.label}</p>
      <div className="gate-evidence">
        <p><strong>Direct wallet (used by the order panel below):</strong> your wallet is the account. No CallPut Account is involved.</p>
        <p><strong>CallPut Account route (separate, for delegated or automated trading):</strong> {account ? (reason === null ? "this wallet's Account can open today." : `this wallet's Account would be refused today: ${reason}.`) : "not read."}{account ? ` Account address for THIS wallet: ${account.account}.` : ""}</p>
      </div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="ack-actions">
        <Button type="button" variant="outline" disabled={loading} onClick={refresh}>Refresh</Button>
        <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>{copied ? "Copied" : "Copy readiness report"}</Button>
      </div>
    </Panel>
  );
}
