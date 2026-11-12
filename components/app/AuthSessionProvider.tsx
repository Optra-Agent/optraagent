"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProviderNotFoundError, useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { SessionSchema, type Session } from "../../lib/domain/contracts";
import { walletOptions } from "../../lib/chain/wallets";

type SessionStatus = "loading" | "signed_out" | "signed_in" | "error";
type AuthSessionContextValue = {
  session: Session | null;
  status: SessionStatus;
  error: string | null;
  busy: boolean;
  connectWallet: (walletLabel: string) => Promise<void>;
  switchToRobinhoodChain: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AuthSessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { address, chainId, status: walletStatus } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const latestSessionAddress = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/me", { credentials: "include", cache: "no-store" });
      setError(null);
      if (response.status === 401) {
        setSession(null);
        latestSessionAddress.current = null;
        setStatus("signed_out");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Could not check the wallet session."));
      const current = SessionSchema.parse(await response.json());
      setSession(current);
      latestSessionAddress.current = current.user.address.toLowerCase();
      setStatus("signed_in");
    } catch (exception) {
      setStatus("error");
      setError(exception instanceof Error ? exception.message : "Could not check the wallet session.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const logout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Could not close the wallet session."));
      setSession(null);
      latestSessionAddress.current = null;
      setStatus("signed_out");
      if (walletStatus === "connected") await disconnectAsync();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Could not close the wallet session.");
    } finally {
      setBusy(false);
    }
  }, [disconnectAsync, walletStatus]);

  const connectWallet = useCallback(async (walletLabel: string) => {
    const wallet = walletOptions.find((option) => option.label === walletLabel);
    if (!wallet) {
      setError("Choose MetaMask or Phantom EVM to continue.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const connectorIndex = walletOptions.findIndex((option) => option.label === wallet.label);
      const connector = connectors[connectorIndex];
      if (!connector) throw new Error("Wallet connector is unavailable.");
      await connector.getProvider();
      const connection = await connectAsync({ connector });
      if (connection.chainId !== 4663) {
        setError("Switch your wallet to Robinhood Chain (4663), then sign in again.");
        return;
      }

      const address = connection.accounts[0];
      if (!address) throw new Error("The wallet did not return an account.");
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!challengeResponse.ok) throw new Error(await responseError(challengeResponse, "Could not start wallet sign-in."));
      const challenge = await challengeResponse.json() as { nonce: string; message: string };
      const signature = await signMessageAsync({ message: challenge.message });
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, nonce: challenge.nonce, signature }),
      });
      if (!verifyResponse.ok) throw new Error(await responseError(verifyResponse, "Wallet sign-in could not be verified."));
      const authenticated = SessionSchema.parse(await verifyResponse.json());
      setSession(authenticated);
      latestSessionAddress.current = authenticated.user.address.toLowerCase();
      setStatus("signed_in");
      setError(null);
    } catch (exception) {
      if (exception instanceof ProviderNotFoundError || (exception instanceof Error && exception.name === "ProviderNotFoundError")) {
        setError("No compatible EVM wallet was found. Install MetaMask or Phantom EVM.");
      } else if (exception instanceof Error && /rejected|denied/i.test(exception.message)) {
        setError("The wallet request was rejected. No session was created.");
      } else {
        setError(exception instanceof Error ? exception.message : "Wallet sign-in failed.");
      }
      setStatus("signed_out");
    } finally {
      setBusy(false);
    }
  }, [connectAsync, connectors, signMessageAsync]);

  const switchToRobinhoodChain = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await switchChainAsync({ chainId: 4663 });
    } catch {
      setError("Could not switch networks. Add Robinhood Chain (4663) in your wallet, then reconnect.");
    } finally {
      setBusy(false);
    }
  }, [switchChainAsync]);

  useEffect(() => {
    if (walletStatus !== "connected" || !address || !session) return;
    const connectedAddress = address.toLowerCase();
    const expectedAddress = latestSessionAddress.current ?? session.user.address.toLowerCase();
    if (connectedAddress === expectedAddress && chainId === 4663) return;

    setSession(null);
    latestSessionAddress.current = null;
    setStatus("signed_out");
    setError("The connected wallet or network changed. Sign in again to continue.");
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  }, [address, chainId, session, walletStatus]);

  const value = useMemo<AuthSessionContextValue>(() => ({
    session,
    status,
    error,
    busy,
    connectWallet,
    switchToRobinhoodChain,
    logout,
    refresh,
  }), [session, status, error, busy, connectWallet, switchToRobinhoodChain, logout, refresh]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error("useAuthSession must be used within AuthSessionProvider.");
  return context;
}
