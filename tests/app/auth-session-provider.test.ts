// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockConnector = {
  id: string;
  name: string;
  uid: string;
  getProvider: ReturnType<typeof vi.fn>;
  getAccounts: ReturnType<typeof vi.fn>;
  getChainId: ReturnType<typeof vi.fn>;
};
type MockConnection = {
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
  address?: string;
  chainId?: number;
  connector?: MockConnector;
};

const mocks = vi.hoisted(() => ({
  connection: null as unknown as MockConnection,
  connectors: [] as MockConnector[],
  connectAsync: vi.fn(),
  disconnectAsync: vi.fn(),
  signMessageAsync: vi.fn(),
  switchChainAsync: vi.fn(),
}));

vi.mock("wagmi", () => ({
  ProviderNotFoundError: class ProviderNotFoundError extends Error {},
  useAccount: () => mocks.connection,
  useConnection: () => mocks.connection,
  useConnect: () => ({ connectAsync: mocks.connectAsync, connectors: mocks.connectors }),
  useDisconnect: () => ({ disconnectAsync: mocks.disconnectAsync }),
  useSignMessage: () => ({ signMessageAsync: mocks.signMessageAsync }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
}));

import { AuthSessionProvider, useAuthSession } from "../../components/app/AuthSessionProvider";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
const EXPIRES_AT = "2026-11-19T03:00:00.000Z";
const signature = `0x${"11".repeat(65)}`;

let selectedConnector: MockConnector;
let sessionState: ReturnType<typeof useAuthSession> | null;
let fetchMock: ReturnType<typeof vi.fn>;

function SessionProbe() {
  const value = useAuthSession();
  useEffect(() => { sessionState = value; }, [value]);
  return null;
}

function responseFor(url: string, method: string): Response {
  if (url === "/api/me" && method === "GET") return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  if (url === "/api/auth/challenge") return Response.json({ nonce: "a".repeat(32), message: "Sign in to Optra." });
  if (url === "/api/auth/verify") {
    return Response.json({ user: { id: "user-1", address: ADDRESS }, expiresAt: EXPIRES_AT });
  }
  if (url === "/api/auth/logout") return new Response(null, { status: 204 });
  throw new Error(`Unexpected request: ${method} ${url}`);
}

function renderProvider() {
  return render(createElement(AuthSessionProvider, null, createElement(SessionProbe)));
}

describe("wallet session lifecycle", () => {
  beforeEach(() => {
    sessionState = null;
    selectedConnector = {
      id: "metaMask",
      name: "MetaMask",
      uid: "metaMask",
      getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }),
      getAccounts: vi.fn().mockImplementation(async () => [mocks.connection?.address ?? ADDRESS]),
      getChainId: vi.fn().mockImplementation(async () => mocks.connection?.chainId ?? 4663),
    };
    mocks.connection = {
      status: "connected",
      address: ADDRESS,
      chainId: 4663,
      connector: selectedConnector,
    };
    mocks.connectors = [selectedConnector];
    mocks.connectAsync.mockReset().mockRejectedValue(Object.assign(new Error("Connector already connected."), {
      name: "ConnectorAlreadyConnectedError",
    }));
    mocks.disconnectAsync.mockReset().mockResolvedValue(undefined);
    mocks.signMessageAsync.mockReset().mockResolvedValue(signature);
    mocks.switchChainAsync.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(String(input), init?.method ?? "GET")),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reuses an already-connected MetaMask connector to sign in when the server session is missing", async () => {
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });

    expect(mocks.connectAsync).not.toHaveBeenCalled();
    expect(mocks.signMessageAsync).toHaveBeenCalledExactlyOnceWith({ connector: selectedConnector, message: "Sign in to Optra." });
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), (init as RequestInit | undefined)?.method ?? "GET"])).toContainEqual(["/api/auth/challenge", "POST"]);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), (init as RequestInit | undefined)?.method ?? "GET"])).toContainEqual(["/api/auth/verify", "POST"]);
    expect(sessionState?.status).toBe("signed_in");
    expect(sessionState?.session?.user.address).toBe(ADDRESS);
  });

  it("reuses an already-connected Phantom EVM connector without connecting twice", async () => {
    selectedConnector.name = "Phantom EVM";
    mocks.connection = { ...mocks.connection, connector: selectedConnector };
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    await act(async () => {
      await sessionState?.connectWallet("Phantom EVM");
    });

    expect(mocks.connectAsync).not.toHaveBeenCalled();
    expect(mocks.signMessageAsync).toHaveBeenCalledExactlyOnceWith({ connector: selectedConnector, message: "Sign in to Optra." });
    expect(sessionState?.status).toBe("signed_in");
  });

  it("restores a valid server session from /api/me without requesting a wallet signature", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/me") {
        return Promise.resolve(Response.json({ user: { id: "user-1", address: ADDRESS }, expiresAt: EXPIRES_AT }));
      }
      return Promise.resolve(responseFor(String(input), init?.method ?? "GET"));
    });
    renderProvider();

    await waitFor(() => expect(sessionState?.status).toBe("signed_in"));

    expect(mocks.connectAsync).not.toHaveBeenCalled();
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
    expect(sessionState?.session?.user.address).toBe(ADDRESS);
  });

  it("reports a missing wallet extension without creating an authentication challenge", async () => {
    mocks.connection = { status: "disconnected" };
    mocks.connectAsync.mockRejectedValue(Object.assign(new Error("Provider not found."), { name: "ProviderNotFoundError" }));
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });

    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/auth/challenge")).toBe(false);
    expect(sessionState?.error).toMatch(/No compatible EVM wallet/);
  });

  it("does not create a session after the user rejects the signature request", async () => {
    mocks.signMessageAsync.mockRejectedValue(new Error("User rejected the request."));
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/auth/verify")).toBe(false);
    expect(sessionState?.session).toBeNull();
    expect(sessionState?.status).toBe("signed_out");
    expect(sessionState?.error).toMatch(/request was rejected/i);
  });

  it("waits for a reconnecting wallet instead of prompting again", async () => {
    mocks.connection = { status: "reconnecting", connector: selectedConnector };
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });

    expect(mocks.connectAsync).not.toHaveBeenCalled();
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/challenge", expect.anything());
    expect(sessionState?.error).toMatch(/still being restored/i);
  });

  it("does not request a signature on the wrong network", async () => {
    mocks.connection = { ...mocks.connection, chainId: 1 };
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });

    expect(mocks.connectAsync).not.toHaveBeenCalled();
    expect(mocks.signMessageAsync).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/auth/challenge")).toBe(false);
    expect(sessionState?.error).toMatch(/4663/);
  });

  it("clears an expired server session when /api/me returns 401", async () => {
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));
    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });
    expect(sessionState?.status).toBe("signed_in");

    await act(async () => {
      await sessionState?.refresh();
    });

    expect(sessionState?.status).toBe("signed_out");
    expect(sessionState?.session).toBeNull();
  });

  it.each(["account", "network"] as const)("invalidates the authenticated session after a wallet %s change", async (change) => {
    const view = renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));
    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });
    expect(sessionState?.status).toBe("signed_in");

    mocks.connection = change === "account"
      ? { ...mocks.connection, address: "0x0000000000000000000000000000000000000001" }
      : { ...mocks.connection, chainId: 1 };
    await act(async () => {
      view.rerender(createElement(AuthSessionProvider, null, createElement(SessionProbe)));
    });

    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));
    expect(sessionState?.session).toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/auth/logout" && (init as RequestInit | undefined)?.method === "POST")).toBe(true);
  });

  it("ignores duplicate sign-in requests while a signature is pending", async () => {
    let resolveSignature!: (value: string) => void;
    mocks.signMessageAsync.mockImplementation(() => new Promise<string>((resolve) => { resolveSignature = resolve; }));
    renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    let firstSignIn!: Promise<void>;
    await act(async () => {
      firstSignIn = sessionState!.connectWallet("MetaMask");
    });
    await waitFor(() => expect(mocks.signMessageAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      await sessionState?.connectWallet("MetaMask");
    });
    expect(mocks.signMessageAsync).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/auth/challenge")).toHaveLength(1);

    await act(async () => {
      resolveSignature(signature);
      await firstSignIn;
    });
    expect(sessionState?.status).toBe("signed_in");
  });

  it("does not verify a signature if the connected account changes while signing", async () => {
    let resolveSignature!: (value: string) => void;
    mocks.signMessageAsync.mockImplementation(() => new Promise<string>((resolve) => { resolveSignature = resolve; }));
    const view = renderProvider();
    await waitFor(() => expect(sessionState?.status).toBe("signed_out"));

    let pendingSignIn!: Promise<void>;
    await act(async () => {
      pendingSignIn = sessionState!.connectWallet("MetaMask");
    });
    await waitFor(() => expect(mocks.signMessageAsync).toHaveBeenCalledTimes(1));

    mocks.connection = { ...mocks.connection, address: "0x0000000000000000000000000000000000000001" };
    await act(async () => {
      view.rerender(createElement(AuthSessionProvider, null, createElement(SessionProbe)));
    });
    await act(async () => {
      resolveSignature(signature);
      await pendingSignIn;
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/auth/verify")).toBe(false);
    expect(sessionState?.status).toBe("signed_out");
    expect(sessionState?.error).toMatch(/wallet or network changed/i);
  });
});
