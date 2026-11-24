// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import golden from "../options/fixtures/callput-robinhood-venue-prepared-open.json";
import { CALLPUT_ROBINHOOD_CONTRACTS } from "../../lib/venue/callput-robinhood-readonly";
import { CALLPUT_WRITE_ABIS } from "../../lib/venue/callput-robinhood-write";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as const;
const KEY = `0x${"ab".repeat(32)}` as const;
const mocks = vi.hoisted(() => ({ chainId: 4663, publicClient: null as unknown, walletClient: null as unknown, switchChainAsync: null as unknown as (args: { chainId: number }) => Promise<unknown> }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD", chainId: mocks.chainId, isConnected: true }),
  usePublicClient: () => mocks.publicClient,
  useWalletClient: () => ({ data: mocks.walletClient }),
  useSwitchChain: () => ({ switchChainAsync: (args: { chainId: number }) => mocks.switchChainAsync(args) }),
}));

function feed() {
  const expiry = Math.floor(Date.now() / 1000) + 7 * 86_400;
  const f = golden.feed;
  const row = (id: string, strike: number, mark: number, rp: number) => ({
    underlyingSymbol: "AAPL", side: "put", instrument: `AAPL-${strike}-P`, optionId: id, expiryTimestamp: expiry,
    strikePriceRaw: strike, markPriceRaw: mark, markIvRaw: 0.3, riskPremiumRateForBuy: rp, riskPremiumRateForSell: rp,
    delta: 0, gamma: 0, vega: 0, theta: 0, marketAvailable: true, quoteType: "indicative",
  });
  // optionIds must carry the expiry; rebuild them from the fixture ids with a future expiry.
  const withExpiry = (id: string) => {
    const hex = id.slice(2);
    return `0x${hex.slice(0, 4)}${expiry.toString(16).padStart(10, "0")}${hex.slice(14)}`;
  };
  return {
    venue: "callput", network: "robinhood", chainId: 4663, sourceUrl: "https://app-data-robinhood.s3.ap-southeast-1.amazonaws.com/market-data.json",
    timestampMs: Date.now() - 2_000, lastUpdatedAt: new Date().toISOString(), feedVersion: 1,
    spotIndexRaw: { AAPL: f.spot }, futuresIndexRaw: {},
    options: [
      row(withExpiry(golden.request.longOptionId), 340, f.long.mark, f.long.rpBuy),
      row(withExpiry(golden.request.shortOptionId), 335, f.short.mark, f.short.rpBuy),
    ],
  };
}

function publicClient(receiptLogs: unknown[] = [], o: { usdg?: bigint; eth?: bigint; allowance?: bigint; receiptStatus?: string; request?: unknown[]; tokenBalance?: bigint; rpcFail?: boolean } = {}) {
  return {
    getChainId: vi.fn(async () => { if (o.rpcFail) throw new Error("HTTP request failed. URL: https://rpc.mainnet.chain.robinhood.com"); return 4663; }),
    getBalance: vi.fn(async () => o.eth ?? 10n ** 17n),
    getCode: vi.fn(async () => "0x"),
    estimateGas: vi.fn(async () => 21_000n),
    estimateFeesPerGas: vi.fn(async () => ({ gasPrice: 1_000_000_000n })),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "controller") return CALLPUT_ROBINHOOD_CONTRACTS.controller;
      if (functionName === "executionFee") return 60_000_000_000_000n;
      if (functionName === "balanceOf") return o.usdg ?? 50_000_000n;
      if (functionName === "allowance") return o.allowance ?? 10n ** 12n;
      if (functionName === "openPositionRequests") return o.request;
      if (functionName === "balanceOfBatch") return [o.tokenBalance ?? 0n];
      throw new Error(`unexpected ${functionName}`);
    }),
    waitForTransactionReceipt: vi.fn(async () => ({ status: o.receiptStatus ?? "success", logs: receiptLogs })),
    getTransactionReceipt: vi.fn(async () => ({ status: o.receiptStatus ?? "success", logs: receiptLogs })),
  };
}

async function loadPanel(liveEnabled: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CALLPUT_LIVE_ORDERS", liveEnabled ? "true" : "false");
  return (await import("../../components/app/tape/CallPutOrderPanel")).CallPutOrderPanel;
}

async function configureOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Load market" }));
  await user.selectOptions(await screen.findByLabelText("Expiry"), (await screen.findByLabelText("Expiry")).querySelectorAll("option")[1].getAttribute("value") as string);
  const long = await screen.findByLabelText("Long leg");
  const options = long.querySelectorAll("option");
  expect(options.length).toBe(3);
  await user.selectOptions(long, options[2].value); // 340 strike sorts after 335
  await user.selectOptions(screen.getByLabelText("Short leg"), options[1].value);
  await user.click(screen.getByRole("button", { name: "Prepare order" }));
}

async function prepareOrder(user: ReturnType<typeof userEvent.setup>) {
  await configureOrder(user);
  await screen.findByText("Order review");
}

describe("CallPutOrderPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.chainId = 4663;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";
      if (url.includes("/market?")) return new Response(JSON.stringify(feed()), { status: 200 });
      if (url === "/api/venue/callput/orders" && method === "POST") {
        return new Response(JSON.stringify({ order: { id: "123e4567-e89b-42d3-a456-426614174000" } }), { status: 201 });
      }
      if (url.endsWith("/events")) {
        return new Response(JSON.stringify({ event: { verification: "client-reported-reference" } }), { status: 201 });
      }
      return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.chainId = 4663; mocks.walletClient = null; });

  it("keeps risk text out of the main form and shows the essentials at the review step", async () => {
    const pc = publicClient([]);
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    // Before preparing: no warning box, no real-money paragraph.
    expect(document.querySelector("[role=note]")).toBeNull();
    expect(screen.queryByText(/Real money/)).toBeNull();
    expect(screen.queryByText(/Direct wallet route/)).toBeNull();
    await prepareOrder(user);
    const risk = screen.getByRole("region", { name: "Before you sign" });
    expect(risk.textContent).toMatch(/Real money/);
    expect(risk.textContent).toMatch(/not assumed refundable/);
    expect(risk.textContent).toMatch(/transaction hash is not a fill/i);
    expect(risk.textContent).toMatch(/unaudited/);
    expect(document.querySelector("[role=note]")).toBeNull();
  });

  it("previews a prepared order but cannot sign when the build flag is off", async () => {
    mocks.publicClient = publicClient();
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(false);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);

    expect(screen.getByText("Preview only")).toBeTruthy();
    expect(screen.getByText(/Signing is disabled in this build/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Sign in wallet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("requires per-transaction review, signs once, captures the request key and never claims a fill", async () => {
    const topics = encodeEventTopics({ abi: CALLPUT_WRITE_ABIS.positionManager, eventName: "GenerateRequestKey", args: { account: ACCOUNT, key: KEY, isOpen: true } });
    const pc = publicClient([{ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, topics, data: encodeAbiParameters([], []) }]);
    pc.estimateFeesPerGas.mockImplementationOnce(async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n } as never));
    mocks.publicClient = pc;
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);

    // Allowance is already sufficient in this fixture, so the only transaction is the open request.
    const sign = screen.getByRole("button", { name: "Sign in wallet" }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    expect(sign.disabled).toBe(false);
    await user.click(sign);

    await screen.findByText(KEY);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    const call = (sendTransaction.mock.calls as unknown as Array<[{
      to: string; value: bigint; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasPrice?: bigint;
    }]>)[0][0];
    expect(call).toMatchObject({
      to: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
      value: 60_000_000_000_000n,
      gas: 21_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    });
    expect(call.gasPrice).toBeUndefined();
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/not a fill yet/);
    const intentWrite = vi.mocked(fetch).mock.calls.find(([url, init]) => url === "/api/venue/callput/orders" && init?.method === "POST");
    expect(intentWrite).toBeDefined();
    const persistedIntent = JSON.parse(String(intentWrite?.[1]?.body)).intent;
    expect(persistedIntent).toMatchObject({ kind: "open", chainId: 4663, underlying: "AAPL" });
    expect(persistedIntent).not.toHaveProperty("txHash");
    expect(persistedIntent).not.toHaveProperty("requestKey");
    const stored = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]");
    expect(stored[0]).toMatchObject({ requestKey: KEY, kind: "open", chainId: 4663 });
    await waitFor(() => expect(screen.queryByText("executed-balance-confirmed")).toBeNull());
  });

  it("accepts a valid zero EIP-1559 priority fee and preserves it in the signed request", async () => {
    const topics = encodeEventTopics({ abi: CALLPUT_WRITE_ABIS.positionManager, eventName: "GenerateRequestKey", args: { account: ACCOUNT, key: KEY, isOpen: true } });
    const pc = publicClient([{ address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager, topics, data: encodeAbiParameters([], []) }]);
    pc.estimateFeesPerGas.mockImplementationOnce(async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 0n } as never));
    mocks.publicClient = pc;
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in wallet" }));

    await screen.findByText(KEY);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect((sendTransaction.mock.calls as unknown as Array<[{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }]>)[0][0]).toMatchObject({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 0n,
    });
  });

  it("rejects an EIP-1559 quote whose priority fee is genuinely missing", async () => {
    const pc = publicClient();
    pc.estimateFeesPerGas.mockImplementationOnce(async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: null } as never));
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Panel = await loadPanel(false);
    const user = userEvent.setup();
    render(createElement(Panel));
    await configureOrder(user);

    expect((await screen.findByRole("alert")).textContent).toMatch(/incomplete EIP-1559 fee quote/i);
    expect(screen.queryByText("Order review")).toBeNull();
  });

  it("does not open the wallet prompt when the server cannot persist the order intent", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return url.includes("/market?")
        ? new Response(JSON.stringify(feed()), { status: 200 })
        : new Response(JSON.stringify({ error: { code: "DATABASE_UNAVAILABLE" } }), { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.publicClient = publicClient([eventLog()]);
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await signFirst(user);

    expect(fetchMock).toHaveBeenCalledWith("/api/venue/callput/orders", expect.objectContaining({ method: "POST" }));
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("shows the RPC gas estimate and maximum network fee in the transaction review", async () => {
    const pc = publicClient();
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Panel = await loadPanel(false);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);

    expect(screen.getByText("Estimated gas limit")).toBeTruthy();
    expect(screen.getByText("21000", { exact: true })).toBeTruthy();
    expect(screen.getByText("Estimated network fee ceiling (wei)")).toBeTruthy();
    expect(screen.getByText("21000000000000", { exact: true })).toBeTruthy();
    expect(screen.getByText(/^calldata 0x[0-9a-f]+$/)).toBeTruthy();
    expect(pc.estimateGas).toHaveBeenCalledTimes(1);
  });

  it("refuses to open when the connected wallet changes chains after order preparation", async () => {
    const pc = publicClient();
    const sendTransaction = vi.fn();
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);

    mocks.chainId = 1;
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in wallet" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Switch to Robinhood Mainnet/i);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("shows the full review with the exact ETH shortfall and keeps Sign disabled when native balance cannot cover the execution fee plus estimated gas", async () => {
    const sendTransaction = vi.fn();
    const pc = publicClient([], { eth: 80_000_000_000_000n, allowance: 10n ** 12n });
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);

    // 0.00008 ETH held; the open needs 0.00006 fee + 21000 gas * 1 gwei (0.000021) = 0.000081 ETH, so it is short by 0.000001 ETH.
    const preflight = screen.getByLabelText("Funding preflight");
    expect(preflight.getAttribute("data-preflight")).toBe("fail");
    expect(preflight.querySelector('[data-preflight-line="eth"]')?.textContent).toMatch(/short by 0\.000001 ETH/);
    expect(preflight.querySelector('[data-preflight-line="usdg"]')?.getAttribute("data-ok")).toBe("true");
    expect(screen.getByTestId("preflight-summary").textContent).toMatch(/Fund this wallet with at least 0\.000001 ETH/);
    expect(screen.getByText(/to 0x[0-9a-fA-F]{40} · value 60000000000000 wei/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Sign in wallet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Signing is disabled until the funding preflight passes/)).toBeTruthy();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(pc.estimateGas).toHaveBeenCalledTimes(1);
  });

  it("re-reads balances right before signing and refuses when funding dropped after the review", async () => {
    const pc = publicClient();
    mocks.publicClient = pc;
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    expect(screen.getByLabelText("Funding preflight").getAttribute("data-preflight")).toBe("pass");
    // The wallet is drained after the review was shown.
    pc.getBalance.mockResolvedValue(1_000n);
    await signFirst(user);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Funding preflight failed just before signing/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  const eventLog = () => ({
    address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
    topics: encodeEventTopics({ abi: CALLPUT_WRITE_ABIS.positionManager, eventName: "GenerateRequestKey", args: { account: ACCOUNT, key: KEY, isOpen: true } }),
    data: encodeAbiParameters([], []),
  });

  it("persists a broadcast transaction and recovers its request key without resubmitting after an RPC error", async () => {
    const pc = publicClient([eventLog()]);
    pc.waitForTransactionReceipt.mockRejectedValueOnce(new Error("RPC receipt timeout"));
    const txHash = `0x${"cd".repeat(32)}`;
    const sendTransaction = vi.fn(async () => txHash);
    mocks.publicClient = pc;
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await signFirst(user);

    expect((await screen.findByRole("alert")).textContent).toMatch(/RPC receipt timeout/);
    const savedWhileUnknown = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0];
    expect(savedWhileUnknown.pendingTransaction).toMatchObject({ kind: "open-spread", txHash, status: "submitted" });
    expect((screen.getByRole("button", { name: "Sign in wallet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendTransaction).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Recover transaction" }));
    await screen.findByText(KEY);

    const recovered = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0];
    expect(recovered).toMatchObject({ requestKey: KEY, pendingTransaction: { kind: "open-spread", txHash, status: "confirmed" } });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  async function signFirst(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in wallet" }));
  }

  it("shows a clear message and stores nothing when the wallet rejects the signature", async () => {
    mocks.publicClient = publicClient([eventLog()]);
    const sendTransaction = vi.fn(async () => { throw Object.assign(new Error("User rejected the request."), { code: 4001 }); });
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await signFirst(user);
    expect((await screen.findByRole("alert")).textContent).toBe("You rejected the request in your wallet. Nothing was sent.");
    const savedDraft = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0];
    expect(savedDraft).toMatchObject({ kind: "open", chainId: 4663, serverOrderId: "123e4567-e89b-42d3-a456-426614174000" });
    expect(savedDraft.pendingTransaction).toBeUndefined();
    // retry stays possible: the same transaction is offered again
    expect(screen.getByRole("button", { name: "Sign in wallet" })).toBeTruthy();
  });

  it("persists and displays a reverted transaction without offering it again", async () => {
    mocks.publicClient = publicClient([], { receiptStatus: "reverted" });
    mocks.walletClient = { sendTransaction: vi.fn(async () => `0x${"cd".repeat(32)}`), chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await signFirst(user);
    expect((await screen.findByRole("alert")).textContent).toMatch(/reverted/);
    expect(await screen.findByText("Last transaction")).toBeTruthy();
    expect(screen.getByText("reverted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in wallet" })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0])
      .toMatchObject({ txHash: `0x${"cd".repeat(32)}`, requestKey: null, pendingTransaction: { status: "reverted" } });
  });

  it("refuses to sign an open quote older than 60 seconds", async () => {
    mocks.publicClient = publicClient([eventLog()]);
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 61_000);
    await signFirst(user);
    expect((await screen.findByRole("alert")).textContent).toMatch(/older than 60 seconds/);
    expect(screen.queryByText("Order review")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in wallet" })).toBeNull();
    expect(sendTransaction).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("keeps the exact order review in place when the gas estimate expires before the owner click", async () => {
    const pc = publicClient();
    mocks.publicClient = pc;
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await user.click(screen.getByRole("checkbox"));
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 31_000);
    await user.click(screen.getByRole("button", { name: "Sign in wallet" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/gas estimate is missing or older than 30 seconds/i);
    expect(screen.getByText("Order review")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sign in wallet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendTransaction).not.toHaveBeenCalled();
    const orderWrite = vi.mocked(fetch).mock.calls.find(([url, init]) => url === "/api/venue/callput/orders" && init?.method === "POST");
    expect(orderWrite).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("shows the exact USDG shortfall and the allowance explanation, offers the destinations and keeps Sign disabled when USDG is short", async () => {
    mocks.publicClient = publicClient([], { usdg: 1_000n, allowance: 0n });
    const sendTransaction = vi.fn();
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);

    const usdgLine = screen.getByLabelText("Funding preflight").querySelector('[data-preflight-line="usdg"]');
    expect(usdgLine?.getAttribute("data-ok")).toBe("false");
    expect(usdgLine?.textContent).toMatch(/holds 0\.001000 USDG · short by \d+\.\d{6} USDG/);
    expect(screen.getByTestId("allowance-explainer").textContent).toMatch(/separate approval transaction for exactly .* USDG/);
    expect(screen.getByText(new RegExp(`spender \\(CallPut Controller\\) ${CALLPUT_ROBINHOOD_CONTRACTS.controller}`))).toBeTruthy();
    expect(screen.getByText(/approves exactly \d+\.\d{6} USDG/)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(`to ${CALLPUT_ROBINHOOD_CONTRACTS.usdg}`)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Sign in wallet" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("blocks preparation for an RPC failure without offering a transaction", async () => {
    mocks.publicClient = publicClient([], { rpcFail: true });
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await user.click(screen.getByRole("button", { name: "Load market" }));
    const expiry = await screen.findByLabelText("Expiry");
    await user.selectOptions(expiry, expiry.querySelectorAll("option")[1].getAttribute("value") as string);
    const long = screen.getByLabelText("Long leg");
    const options = long.querySelectorAll("option");
    await user.selectOptions(long, options[2].value);
    await user.selectOptions(screen.getByLabelText("Short leg"), options[1].value);
    await user.click(screen.getByRole("button", { name: "Prepare order" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/HTTP request failed/);
    expect(alert.textContent).not.toMatch(/https?:\/\//);
    expect(screen.queryByRole("button", { name: "Sign in wallet" })).toBeNull();
  });

  it("blocks an order whose estimated collateral exceeds the user's max collateral", async () => {
    mocks.publicClient = publicClient();
    mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    const cap = screen.getByLabelText("Max collateral (USDG)");
    await user.clear(cap);
    await user.type(cap, "0.5");
    await user.click(screen.getByRole("button", { name: "Load market" }));
    const expiry = await screen.findByLabelText("Expiry");
    await user.selectOptions(expiry, expiry.querySelectorAll("option")[1].getAttribute("value") as string);
    const long = screen.getByLabelText("Long leg");
    const options = long.querySelectorAll("option");
    await user.selectOptions(long, options[2].value);
    await user.selectOptions(screen.getByLabelText("Short leg"), options[1].value);
    await user.click(screen.getByRole("button", { name: "Prepare order" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/exceeds the 0\.500000 USDG cap/);
    expect(screen.queryByRole("button", { name: "Sign in wallet" })).toBeNull();
  });

  it("reports the market feed being down without showing any quote", async () => {
    mocks.publicClient = publicClient();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const Panel = await loadPanel(false);
    const user = userEvent.setup();
    render(createElement(Panel));
    await user.click(screen.getByRole("button", { name: "Load market" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/unavailable\. No quote/);
    expect(screen.queryByLabelText("Expiry")).toBeNull();
  });

  describe("request tracking", () => {
    const pending = [ACCOUNT, 16, 1_800_000_000n, 42n, 1n, 1n, 0n, false, BigInt(Math.floor(Date.now() / 1000)), 0, 0n, 0n, 0n, 0n];
    const stored = () => window.localStorage.setItem("optra.callput.robinhood.intents.v1", JSON.stringify([{
      version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL", underlyingAssetIndex: 16,
      longOptionId: golden.request.longOptionId, shortOptionId: golden.request.shortOptionId, expiry: 1_800_000_000, sizeRaw: "1000", minSizeRaw: "780",
      amountInRaw: "900811", createdAtMs: Date.now(), txHash: `0x${"cd".repeat(32)}`, requestKey: KEY,
    }]));

    async function refresh(request: unknown[], extra = {}) {
      stored();
      mocks.publicClient = publicClient([], { request, ...extra });
      const Panel = await loadPanel(false);
      const user = userEvent.setup();
      render(createElement(Panel));
      await user.click(await screen.findByRole("button", { name: "Refresh status" }));
    }

    it("restores a server-persisted transaction and rechecks its request onchain after local storage is empty", async () => {
      const txHash = `0x${"cd".repeat(32)}` as const;
      const orderId = "123e4567-e89b-42d3-a456-426614174010";
      const clientIntentId = "123e4567-e89b-42d3-a456-426614174011";
      const serverOrder = {
        id: orderId,
        clientIntentId,
        account: ACCOUNT,
        chainId: 4663,
        kind: "open",
        intent: {
          version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL",
          underlyingAssetIndex: 16, longOptionId: golden.request.longOptionId, shortOptionId: golden.request.shortOptionId,
          expiry: 1_800_000_000, sizeRaw: "1000", minSizeRaw: "780", amountInRaw: "900811", createdAtMs: Date.now(),
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        events: [
          { id: "event-1", orderId, eventId: "123e4567-e89b-42d3-a456-426614174012", referenceKind: "transaction", transactionKind: "open-spread", transactionHash: txHash, requestKey: null, createdAt: new Date().toISOString(), verification: "client-reported-reference" },
          { id: "event-2", orderId, eventId: "123e4567-e89b-42d3-a456-426614174013", referenceKind: "request-key", transactionKind: "open-spread", transactionHash: txHash, requestKey: KEY, createdAt: new Date(Date.now() + 1).toISOString(), verification: "client-reported-reference" },
        ],
      };
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return url === "/api/venue/callput/orders"
          ? new Response(JSON.stringify({ orders: [serverOrder] }), { status: 200 })
          : new Response(JSON.stringify({ event: { verification: "client-reported-reference" } }), { status: 200 });
      }));
      mocks.publicClient = publicClient([eventLog()], { request: pending });
      const sendTransaction = vi.fn();
      mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
      const Panel = await loadPanel(false);
      const user = userEvent.setup();
      render(createElement(Panel));

      expect(await screen.findByText(KEY)).toBeTruthy();
      expect(JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0])
        .toMatchObject({ serverOrderId: orderId, txHash, requestKey: KEY });
      await user.click(await screen.findByRole("button", { name: "Recover transaction" }));
      expect(await screen.findByText("pending")).toBeTruthy();
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it("does not downgrade a locally confirmed open receipt when hydrating server references", async () => {
      const txHash = `0x${"cd".repeat(32)}` as const;
      const orderId = "123e4567-e89b-42d3-a456-426614174014";
      const clientIntentId = "123e4567-e89b-42d3-a456-426614174015";
      const createdAtMs = Date.now();
      window.localStorage.setItem("optra.callput.robinhood.intents.v1", JSON.stringify([{
        version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL",
        underlyingAssetIndex: 16, longOptionId: golden.request.longOptionId, shortOptionId: golden.request.shortOptionId,
        expiry: 1_800_000_000, sizeRaw: "1000", minSizeRaw: "780", amountInRaw: "900811", createdAtMs,
        clientIntentId, serverOrderId: orderId, txHash, requestKey: KEY,
        pendingTransaction: { kind: "open-spread", txHash, status: "confirmed", eventId: "123e4567-e89b-42d3-a456-426614174016", historySynced: true },
        requestKeyEventId: "123e4567-e89b-42d3-a456-426614174017", requestKeySynced: true,
      }]));
      const serverOrder = {
        id: orderId, clientIntentId, account: ACCOUNT, chainId: 4663, kind: "open",
        intent: {
          version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL",
          underlyingAssetIndex: 16, longOptionId: golden.request.longOptionId, shortOptionId: golden.request.shortOptionId,
          expiry: 1_800_000_000, sizeRaw: "1000", minSizeRaw: "780", amountInRaw: "900811", createdAtMs,
        },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        events: [
          { id: "event-1", orderId, eventId: "123e4567-e89b-42d3-a456-426614174016", referenceKind: "transaction", transactionKind: "open-spread", transactionHash: txHash, requestKey: null, createdAt: new Date().toISOString(), verification: "client-reported-reference" },
          { id: "event-2", orderId, eventId: "123e4567-e89b-42d3-a456-426614174017", referenceKind: "request-key", transactionKind: "open-spread", transactionHash: txHash, requestKey: KEY, createdAt: new Date(Date.now() + 1).toISOString(), verification: "client-reported-reference" },
        ],
      };
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ orders: [serverOrder] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      mocks.publicClient = publicClient();
      mocks.walletClient = { sendTransaction: vi.fn(), chain: { id: 4663 } };
      const Panel = await loadPanel(false);
      render(createElement(Panel));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        const hydrated = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0];
        expect(hydrated).toMatchObject({
          serverOrderId: orderId,
          txHash,
          requestKey: KEY,
          pendingTransaction: { status: "confirmed", txHash },
          requestKeySynced: true,
        });
      });
    });

    it("shows a pending request as pending, not filled", async () => {
      await refresh(pending);
      expect(await screen.findByText("pending")).toBeTruthy();
      expect(screen.getByText(/No fill is claimed/)).toBeTruthy();
    });

    it("shows a cancelled request as cancelled with no fill", async () => {
      await refresh([...pending.slice(0, 9), 1, ...pending.slice(10)]);
      expect(await screen.findByText("cancelled")).toBeTruthy();
      expect(screen.getByText(/No fill/)).toBeTruthy();
    });

    it("keeps an Executed request unconfirmed until the wallet balance covers it, then confirms", async () => {
      const executed = [...pending.slice(0, 9), 2, 500n, 7n, 5n, 500n];
      await refresh(executed, { tokenBalance: 0n });
      expect(await screen.findByText("executed-balance-unconfirmed")).toBeTruthy();
      cleanup();
      await refresh(executed, { tokenBalance: 500n });
      expect(await screen.findByText("executed-balance-confirmed")).toBeTruthy();
    });

    it("shows a missing record and an RPC error without altering the stored request", async () => {
      await refresh(pending.map((value, index) => (index === 8 ? 0n : value)));
      expect(await screen.findByText("request-not-found")).toBeTruthy();
      cleanup();
      await refresh(pending, { rpcFail: true });
      expect((await screen.findByRole("alert")).textContent).toMatch(/HTTP request failed/);
      expect(JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]")[0].requestKey).toBe(KEY);
    });
  });
});

describe("CallPutOrderPanel wallet network and duplicate protection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.chainId = 4663;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/market?")) return new Response(JSON.stringify(feed()), { status: 200 });
      if (url === "/api/venue/callput/orders" && (init?.method ?? "GET") === "POST") return new Response(JSON.stringify({ order: { id: "123e4567-e89b-42d3-a456-426614174000" } }), { status: 201 });
      return new Response(JSON.stringify({ orders: [] }), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.chainId = 4663; mocks.walletClient = null; });

  it("shows the connected network and offers no switch when the wallet is on Robinhood Mainnet", async () => {
    mocks.publicClient = publicClient();
    mocks.walletClient = { chain: { id: 4663 } };
    const Panel = await loadPanel(false);
    render(createElement(Panel));
    const status = screen.getByTestId("wallet-network-status");
    expect(status.getAttribute("data-network")).toBe("ok");
    expect(status.textContent).toMatch(/Robinhood Mainnet · 4663/);
    expect(screen.queryByRole("button", { name: /Switch to Robinhood Mainnet/ })).toBeNull();
  });

  it("blocks on a wrong network and asks the wallet to switch to Robinhood Mainnet", async () => {
    mocks.chainId = 1;
    mocks.publicClient = publicClient();
    const switchChainAsync = vi.fn(async () => undefined);
    mocks.switchChainAsync = switchChainAsync;
    mocks.walletClient = { chain: { id: 4663 }, sendTransaction: vi.fn() };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    const status = screen.getByTestId("wallet-network-status");
    expect(status.getAttribute("data-network")).toBe("wrong");
    expect(status.textContent).toMatch(/Wrong network · chain 1/);
    expect(status.textContent).toMatch(/Signing is blocked until the wallet is on that network/);
    await user.click(screen.getByRole("button", { name: "Switch to Robinhood Mainnet" }));
    await waitFor(() => expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 4663 }));
  });

  it("reports a rejected network switch plainly and changes nothing", async () => {
    mocks.chainId = 1;
    mocks.publicClient = publicClient();
    mocks.switchChainAsync = vi.fn().mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    mocks.walletClient = { chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await user.click(screen.getByRole("button", { name: "Switch to Robinhood Mainnet" }));
    expect((await screen.findByText(/You rejected the request in your wallet/)).textContent).toMatch(/Nothing was sent/);
  });

  it("refuses a second open while an identical earlier request is unresolved, and sends nothing", async () => {
    mocks.publicClient = publicClient();
    const sendTransaction = vi.fn(async () => `0x${"cd".repeat(32)}`);
    mocks.walletClient = { sendTransaction, chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    // The same wallet already submitted this exact spread a minute ago and the keeper has not resolved it.
    const key = "optra.callput.robinhood.intents.v1";
    const fetchCalls = vi.mocked(fetch).mock.calls.length;
    // Seed a submitted twin using the leg and size currently selected in the panel.
    const long = (screen.getByLabelText("Long leg") as HTMLSelectElement).value;
    const short = (screen.getByLabelText("Short leg") as HTMLSelectElement).value;
    window.localStorage.setItem(key, JSON.stringify([{
      version: 1, chainId: 4663, account: ACCOUNT, kind: "open", strategy: "BuyPutSpread", underlying: "AAPL", underlyingAssetIndex: 1,
      longOptionId: long, shortOptionId: short, expiry: 1, sizeRaw: "1000000000000000000", minSizeRaw: "780000000000000000", amountInRaw: "1",
      createdAtMs: Date.now() - 60_000, txHash: `0x${"11".repeat(32)}`, requestKey: KEY, clientIntentId: "00000000-0000-4000-8000-0000000000aa", lastState: "pending",
    }]));
    window.dispatchEvent(new Event("optra-callput-intents"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Sign in wallet" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/identical order for this wallet is still unresolved/);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCalls);
  });
});
