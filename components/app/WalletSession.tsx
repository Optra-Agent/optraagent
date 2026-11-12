"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useAuthSession } from "./AuthSessionProvider";

export function WalletSession() {
  const { chainId, status: walletStatus } = useAccount();
  const { session, status, error, busy, connectWallet, switchToRobinhoodChain, logout, refresh } = useAuthSession();
  const [showWalletOptions, setShowWalletOptions] = useState(false);

  if (status === "loading") return <div className="session-box" role="status">Checking wallet session…</div>;

  if (session) {
    return (
      <div className="session-box">
        <p className="session-address">Signed in · {session.user.address.slice(0, 6)}…{session.user.address.slice(-4)}</p>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => void logout()}>
          {busy ? "Signing out…" : "Disconnect wallet"}
        </button>
        {error ? <p role="alert" className="inline-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="session-box">
      {walletStatus === "connected" && chainId !== 4663 ? (
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => void switchToRobinhoodChain()}>
          Switch to Robinhood Chain
        </button>
      ) : null}
      <button className="button button-primary" type="button" disabled={busy} onClick={() => setShowWalletOptions((visible) => !visible)}>
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
      {showWalletOptions ? (
        <div className="wallet-options" aria-label="Wallet options">
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => void connectWallet("MetaMask")}>
            MetaMask
          </button>
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => void connectWallet("Phantom EVM")}>
            Phantom EVM
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="inline-error">{error}</p> : null}
      {status === "error" ? <button className="text-button" type="button" onClick={() => void refresh()}>Retry session check</button> : null}
    </div>
  );
}
