"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProviderNotFoundError, useConnection, useConnect, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { SessionSchema, type Session } from "../../lib/domain/contracts";
import { walletOptions } from "../../lib/chain/wallets";

type SessionStatus = "loading" | "signed_out" | "signed_in" | "error";
type ConnectionSnapshot = {
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
  address?: `0x${string}`;
  chainId?: number;
  connector?: { uid: string };
};
type AuthSessionContextValue = {
  session: Session | null;
  status: SessionStatus;
  error: string | null;
  busy: boolean;
  connectWallet: (walletLabel: string) => Promise<void>;
  switchToRobinhoodChain: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  walletMenuOpen: boolean;
  setWalletMenuOpen: (open: boolean) => void;
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
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const connection = useConnection();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const latestSessionAddress = useRef<string | null>(null);
  const connectionRef = useRef<ConnectionSnapshot>(connection);
  const signInInFlightRef = useRef(false);
  useEffect(() => {
    connectionRef.current = {
      status: connection.status,
      address: connection.address,
      chainId: connection.chainId,
      connector: connection.connector,
    };
  }, [connection]);

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
      if (connection.status === "connected") await disconnectAsync();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Could not close the wallet session.");
    } finally {
      setBusy(false);
    }
  }, [connection.status, disconnectAsync]);

  const connectWallet = useCallback(async (walletLabel: string) => {
    const wallet = walletOptions.find((option) => option.label === walletLabel);
    if (!wallet) {
      setError("Choose MetaMask or Phantom EVM to continue.");
      return;
    }

    if (signInInFlightRef.current) return;
    signInInFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const connector = connectors.find((candidate) => candidate.name === wallet.label);
      if (!connector) throw new Error("Wallet connector is unavailable.");

      let address: `0x${string}` | undefined;
      let chainId: number | undefined;
      const current = connectionRef.current;
      if (current.status === "connected" && current.connector?.uid === connector.uid) {
        address = current.address;
        chainId = current.chainId;
      } else if (current.status === "connecting" || current.status === "reconnecting") {
        throw new Error("Your wallet connection is still being restored. Try again when it is ready.");
      } else {
        try {
          const connected = await connectAsync({ connector });
          address = connected.accounts[0];
          chainId = connected.chainId;
          connectionRef.current = { status: "connected", address, chainId, connector };
        } catch (exception) {
          if (!(exception instanceof Error) || exception.name !== "ConnectorAlreadyConnectedError") throw exception;

          const latest = connectionRef.current;
          if (latest.status === "connected" && latest.connector?.uid === connector.uid) {
            address = latest.address;
            chainId = latest.chainId;
          } else {
            throw new Error("Your wallet is already connected. Wait for its connection state to finish restoring, then sign in again.");
          }
        }
      }

      if (!address || chainId === undefined) throw new Error("The wallet connection changed. Try again.");
      if (chainId !== 4663) {
        setError("Switch your wallet to Robinhood Chain (4663), then sign in again.");
        return;
      }

      const expectedAddress = address.toLowerCase();
      const isExpectedConnectionActive = async () => {
        const active = connectionRef.current;
        if (active.status !== "connected"
          || active.connector?.uid !== connector.uid
          || !active.address
          || active.address.toLowerCase() !== expectedAddress
          || active.chainId !== chainId) return false;

        const [accounts, activeChainId] = await Promise.all([connector.getAccounts(), connector.getChainId()]);
        return accounts[0]?.toLowerCase() === expectedAddress
          && activeChainId === chainId;
      };

      if (!await isExpectedConnectionActive()) {
        throw new Error("The connected wallet or network changed. Sign in again.");
      }

      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!challengeResponse.ok) throw new Error(await responseError(challengeResponse, "Could not start wallet sign-in."));
      const challenge = await challengeResponse.json() as { nonce: string; message: string };
      if (!await isExpectedConnectionActive()) {
        throw new Error("The connected wallet or network changed. Sign in again.");
      }
      const signature = await signMessageAsync({ connector, message: challenge.message });
      if (!await isExpectedConnectionActive()) {
        throw new Error("The connected wallet or network changed. Sign in again.");
      }

      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, nonce: challenge.nonce, signature }),
      });
      if (!verifyResponse.ok) throw new Error(await responseError(verifyResponse, "Wallet sign-in could not be verified."));
      const authenticated = SessionSchema.parse(await verifyResponse.json());
      if (!await isExpectedConnectionActive()) {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        throw new Error("The connected wallet or network changed. Sign in again.");
      }
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
      signInInFlightRef.current = false;
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
    if (connection.status !== "connected" || !session) return;
    const connectedAddress = connection.address.toLowerCase();
    const expectedAddress = latestSessionAddress.current ?? session.user.address.toLowerCase();
    if (connectedAddress === expectedAddress && connection.chainId === 4663) return;

    setSession(null);
    latestSessionAddress.current = null;
    setStatus("signed_out");
    setError("The connected wallet or network changed. Sign in again to continue.");
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  }, [connection, session]);

  const value = useMemo<AuthSessionContextValue>(() => ({
    session,
    status,
    error,
    busy,
    connectWallet,
    switchToRobinhoodChain,
    logout,
    refresh,
    walletMenuOpen,
    setWalletMenuOpen,
  }), [session, status, error, busy, connectWallet, switchToRobinhoodChain, logout, refresh, walletMenuOpen]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error("useAuthSession must be used within AuthSessionProvider.");
  return context;
}
