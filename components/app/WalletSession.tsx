"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useAuthSession } from "./AuthSessionProvider";
import { shortAddress } from "./format";

export function WalletSession() {
  const { chainId, status: walletStatus } = useAccount();
  const { session, status, error, busy, connectWallet, switchToRobinhoodChain, logout, refresh, walletMenuOpen: showWalletOptions, setWalletMenuOpen: setShowWalletOptions } = useAuthSession();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showWalletOptions) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowWalletOptions(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (boxRef.current && event.target instanceof Node && !boxRef.current.contains(event.target)) setShowWalletOptions(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [showWalletOptions, setShowWalletOptions]);

  if (status === "loading") return <div className="session-box session-loading" role="status">Checking wallet session…</div>;

  if (session) {
    return (
      <div className="session-box">
        <p className="session-address" title={session.user.address}>
          <span className="session-dot" aria-hidden="true" />
          <span className="session-prefix">Signed in · </span>
          <span className="mono">{shortAddress(session.user.address)}</span>
        </p>
        <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => void logout()}>
          {busy ? "Signing out…" : "Disconnect wallet"}
        </button>
        {error ? <p role="alert" className="inline-error floating">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="session-box" ref={boxRef}>
      {walletStatus === "connected" && chainId !== 4663 ? (
        <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={() => void switchToRobinhoodChain()}>
          Switch to Robinhood Chain
        </button>
      ) : null}
      <button
        className="button button-primary button-sm"
        type="button"
        aria-expanded={showWalletOptions}
        aria-controls="wallet-popover"
        disabled={busy}
        onClick={() => setShowWalletOptions(!showWalletOptions)}
      >
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
      {showWalletOptions ? (
        <div className="wallet-popover" id="wallet-popover">
          <p className="wallet-popover-title">Choose an EVM wallet</p>
          <p className="wallet-popover-note">You sign one message to log in. No transaction is sent and no funds move. Network: Robinhood Chain (4663).</p>
          <div className="wallet-options" aria-label="Wallet options">
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void connectWallet("MetaMask")}>
              MetaMask
            </button>
            <button className="button button-secondary" type="button" disabled={busy} onClick={() => void connectWallet("Phantom EVM")}>
              Phantom EVM
            </button>
          </div>
          {error ? <p role="alert" className="inline-error">{error}</p> : null}
          {status === "error" ? <button className="text-button" type="button" onClick={() => void refresh()}>Retry session check</button> : null}
        </div>
      ) : null}
      {error && !showWalletOptions ? <p role="alert" className="inline-error floating">{error}</p> : null}
      {status === "error" && !showWalletOptions ? <button className="text-button" type="button" onClick={() => void refresh()}>Retry session check</button> : null}
    </div>
  );
}
