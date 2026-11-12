"use client";

import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthSession } from "./AuthSessionProvider";
import { shortAddress } from "./format";

export function WalletSession() {
  const { chainId, status: walletStatus } = useAccount();
  const { session, status, error, busy, connectWallet, switchToRobinhoodChain, logout, refresh, walletMenuOpen, setWalletMenuOpen } = useAuthSession();

  if (status === "loading") return <div className="session-box session-loading" role="status">Checking wallet session…</div>;

  if (session) {
    return (
      <div className="session-box">
        <p className="session-address" title={session.user.address}>
          <span className="session-dot" aria-hidden="true" />
          <span>Signed in · </span>
          <span className="mono">{shortAddress(session.user.address)}</span>
        </p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void logout()}>
          {busy ? "Signing out…" : "Disconnect wallet"}
        </Button>
        {error ? <p role="alert" className="inline-error floating">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="session-box">
      {walletStatus === "connected" && chainId !== 4663 ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void switchToRobinhoodChain()}>
          Switch to Robinhood Chain
        </Button>
      ) : null}
      <Button size="sm" aria-haspopup="dialog" disabled={busy} onClick={() => setWalletMenuOpen(true)}>
        {busy ? "Connecting…" : "Connect wallet"}
      </Button>

      <Dialog open={walletMenuOpen} onOpenChange={setWalletMenuOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Choose an EVM wallet</DialogTitle>
            <DialogDescription>
              You sign one message to log in. No transaction is sent and no funds move. Network: Robinhood Chain (4663).
            </DialogDescription>
          </DialogHeader>
          <div className="wallet-options" aria-label="Wallet options">
            <Button variant="outline" disabled={busy} onClick={() => void connectWallet("MetaMask")}>MetaMask</Button>
            <Button variant="outline" disabled={busy} onClick={() => void connectWallet("Phantom EVM")}>Phantom EVM</Button>
          </div>
          {error ? <p role="alert" className="inline-error">{error}</p> : null}
          {status === "error" ? <Button variant="link" size="sm" className="h-auto justify-start p-0" onClick={() => void refresh()}>Retry session check</Button> : null}
        </DialogContent>
      </Dialog>

      {error && !walletMenuOpen ? <p role="alert" className="inline-error floating">{error}</p> : null}
      {status === "error" && !walletMenuOpen ? <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void refresh()}>Retry session check</Button> : null}
    </div>
  );
}
