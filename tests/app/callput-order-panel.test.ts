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
const mocks = vi.hoisted(() => ({ publicClient: null as unknown, walletClient: null as unknown }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000dEaD", chainId: 4663, isConnected: true }),
  usePublicClient: () => mocks.publicClient,
  useWalletClient: () => ({ data: mocks.walletClient }),
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
  };
}

async function loadPanel(liveEnabled: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CALLPUT_LIVE_ORDERS", liveEnabled ? "true" : "false");
  return (await import("../../components/app/tape/CallPutOrderPanel")).CallPutOrderPanel;
}

async function prepareOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Load market" }));
  await user.selectOptions(await screen.findByLabelText("Expiry"), (await screen.findByLabelText("Expiry")).querySelectorAll("option")[1].getAttribute("value") as string);
  const long = await screen.findByLabelText("Long leg");
  const options = long.querySelectorAll("option");
  expect(options.length).toBe(3);
  await user.selectOptions(long, options[2].value); // 340 strike sorts after 335
  await user.selectOptions(screen.getByLabelText("Short leg"), options[1].value);
  await user.click(screen.getByRole("button", { name: "Prepare order" }));
  await screen.findByText("Order review");
}

describe("CallPutOrderPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(feed()), { status: 200 })));
  });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.walletClient = null; });

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
    const call = (sendTransaction.mock.calls as unknown as Array<[{ to: string; value: bigint }]>)[0][0];
    expect(call.to).toBe(CALLPUT_ROBINHOOD_CONTRACTS.positionManager);
    expect(call.value).toBe(60_000_000_000_000n);
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/not a fill yet/);
    const stored = JSON.parse(window.localStorage.getItem("optra.callput.robinhood.intents.v1") ?? "[]");
    expect(stored[0]).toMatchObject({ requestKey: KEY, kind: "open", chainId: 4663 });
    await waitFor(() => expect(screen.queryByText("executed-balance-confirmed")).toBeNull());
  });

  const eventLog = () => ({
    address: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
    topics: encodeEventTopics({ abi: CALLPUT_WRITE_ABIS.positionManager, eventName: "GenerateRequestKey", args: { account: ACCOUNT, key: KEY, isOpen: true } }),
    data: encodeAbiParameters([], []),
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
    expect(window.localStorage.getItem("optra.callput.robinhood.intents.v1")).toBeNull();
    // retry stays possible: the same transaction is offered again
    expect(screen.getByRole("button", { name: "Sign in wallet" })).toBeTruthy();
  });

  it("does not store a request or claim success when the mined transaction reverts", async () => {
    mocks.publicClient = publicClient([], { receiptStatus: "reverted" });
    mocks.walletClient = { sendTransaction: vi.fn(async () => `0x${"cd".repeat(32)}`), chain: { id: 4663 } };
    const Panel = await loadPanel(true);
    const user = userEvent.setup();
    render(createElement(Panel));
    await prepareOrder(user);
    await signFirst(user);
    expect((await screen.findByRole("alert")).textContent).toMatch(/reverted/);
    expect(screen.queryByText("Last submitted request")).toBeNull();
    expect(window.localStorage.getItem("optra.callput.robinhood.intents.v1")).toBeNull();
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
    expect(sendTransaction).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it.each([
    ["insufficient USDG", { usdg: 1_000n }, /USDG balance/],
    ["insufficient ETH for the execution fee", { eth: 1_000n }, /Native ETH/],
    ["an RPC failure", { rpcFail: true }, /HTTP request failed/],
  ])("blocks preparation for %s without offering a transaction", async (_name, overrides, pattern) => {
    mocks.publicClient = publicClient([], overrides);
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
    expect(alert.textContent).toMatch(pattern);
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
