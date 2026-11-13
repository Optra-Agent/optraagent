"use client";

import { useAccount } from "wagmi";
import { Check, ChevronRight, Network, ShieldCheck, TriangleAlert, Wallet } from "lucide-react";
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
        <DialogContent className="wallet-dialog max-w-md">
          <DialogHeader>
            <span className="wallet-badge" aria-hidden="true"><Wallet /></span>
            <DialogTitle className="font-display text-2xl">Choose an EVM wallet</DialogTitle>
            <DialogDescription>
              You sign one message to log in. No transaction is sent and no funds move.
            </DialogDescription>
          </DialogHeader>
          <ol className="wallet-steps" aria-label="Sign-in steps">
            <li data-on={busy ? "0" : "1"}><span>1</span>Choose a wallet</li>
            <li data-on={busy ? "1" : "0"}><span>2</span>Sign the message</li>
            <li data-on="0"><span><Check aria-hidden /></span>Start paper trading</li>
          </ol>
          <div className="wallet-options" aria-label="Wallet options">
            <button type="button" className="wallet-option" aria-label="MetaMask" disabled={busy} onClick={() => void connectWallet("MetaMask")}>
              <span className="wallet-mark wallet-mark-mm" aria-hidden="true">M</span>
              <span className="wallet-option-text"><b>MetaMask</b><small>Browser extension</small></span>
              <ChevronRight aria-hidden />
            </button>
            <button type="button" className="wallet-option" aria-label="Phantom EVM" disabled={busy} onClick={() => void connectWallet("Phantom EVM")}>
              <span className="wallet-mark wallet-mark-ph" aria-hidden="true">P</span>
              <span className="wallet-option-text"><b>Phantom EVM</b><small>Browser extension</small></span>
              <ChevronRight aria-hidden />
            </button>
          </div>
          {busy ? <p className="wallet-status" role="status"><span className="wallet-spin" aria-hidden="true" />Waiting for your wallet. Approve the request in its window.</p> : null}
          {error ? (
            <div className="wallet-error" role="alert">
              <p className="wallet-error-title"><TriangleAlert aria-hidden />{/rejected/i.test(error) ? "Request rejected" : /No compatible/i.test(error) ? "No wallet found" : /network|Switch|4663/i.test(error) ? "Wrong network" : "Sign-in did not finish"}</p>
              <p className="inline-error">{error}</p>
              {/No compatible/i.test(error) ? <p className="wallet-hint">Install MetaMask or Phantom, reload this page, then try again.</p> : null}
              {/network|Switch|4663/i.test(error) && walletStatus === "connected" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void switchToRobinhoodChain()}><Network aria-hidden />Switch to Robinhood Chain</Button> : null}
            </div>
          ) : null}
          <p className="wallet-foot"><ShieldCheck aria-hidden />Network: Robinhood Chain (4663). Signing proves wallet ownership only.</p>
          {status === "error" ? <Button variant="link" size="sm" className="h-auto justify-start p-0" onClick={() => void refresh()}>Retry session check</Button> : null}
        </DialogContent>
      </Dialog>

      {error && !walletMenuOpen ? <p role="alert" className="inline-error floating">{error}</p> : null}
      {status === "error" && !walletMenuOpen ? <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void refresh()}>Retry session check</Button> : null}
    </div>
  );
}
