import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { evaluateOrderPreflight, formatPreflightAmount } from "../../lib/venue/callput-order-preflight";
import type { CallPutPreparedTransaction, CallPutWalletState } from "../../lib/venue/callput-robinhood-write";
import { CALLPUT_ROBINHOOD_CONTRACTS } from "../../lib/venue/callput-robinhood-readonly";

const ACCOUNT = "0x3cdb000000000000000000000000000000006dbb" as Address;
const wallet = (over: Partial<CallPutWalletState> = {}): CallPutWalletState => ({
  chainId: 4663, account: ACCOUNT, usdgBalanceRaw: 1_000_000n, usdgAllowanceRaw: 0n, nativeBalanceWei: 200_000_000_000_000n, executionFeeWei: 60_000_000_000_000n, accountAcceptsErc1155: true, ...over,
});
const approval: CallPutPreparedTransaction = { kind: "usdg-approval", label: "Approve", chainId: 4663, from: ACCOUNT, to: CALLPUT_ROBINHOOD_CONTRACTS.usdg as Address, data: "0x" as Hex, value: 0n };
const open: CallPutPreparedTransaction = { kind: "open-spread", label: "Open", chainId: 4663, from: ACCOUNT, to: CALLPUT_ROBINHOOD_CONTRACTS.positionManager as Address, data: "0x" as Hex, value: 60_000_000_000_000n };
const AMOUNT = 246_168n;

describe("order funding preflight", () => {
  it("passes a funded wallet, and still says the approval is a separate confirmed transaction", () => {
    const result = evaluateOrderPreflight({ wallet: wallet(), connectedChainId: 4663, amountInRaw: AMOUNT, transactions: [approval, open], gasCostWei: { "usdg-approval": 1_000_000_000_000n } });
    expect(result.ready).toBe(true);
    expect(result.allowance.approvalRequired).toBe(true);
    expect(result.allowance.detail).toContain("Nothing is approved automatically");
    expect(result.destinations.map((item) => [item.step, item.kind, item.to, item.usdgAmountRaw])).toEqual([
      [1, "usdg-approval", CALLPUT_ROBINHOOD_CONTRACTS.usdg, AMOUNT],
      [2, "open-spread", CALLPUT_ROBINHOOD_CONTRACTS.positionManager, null],
    ]);
    expect(result.gasNote).toContain("open-spread");
  });

  it("reports exact ETH and USDG shortfalls from the fee plus the estimated gas, and is not ready", () => {
    const result = evaluateOrderPreflight({
      wallet: wallet({ nativeBalanceWei: 50_000_000_000_000n, usdgBalanceRaw: 100_000n, usdgAllowanceRaw: 10n ** 12n }),
      connectedChainId: 4663, amountInRaw: AMOUNT, transactions: [open], gasCostWei: { "open-spread": 15_000_000_000_000n },
    });
    expect(result.ready).toBe(false);
    const eth = result.lines.find((line) => line.id === "eth")!;
    const usdg = result.lines.find((line) => line.id === "usdg")!;
    expect(eth.requiredRaw).toBe(75_000_000_000_000n);
    expect(eth.shortfallRaw).toBe(25_000_000_000_000n);
    expect(usdg.shortfallRaw).toBe(146_168n);
    expect(formatPreflightAmount(usdg, usdg.shortfallRaw)).toBe("0.146168 USDG");
    expect(result.summary).toContain("0.000025 ETH and 0.146168 USDG");
    expect(result.allowance.approvalRequired).toBe(false);
    expect(result.gasNote).toBeNull();
  });

  it("is not ready on the wrong chain even when fully funded", () => {
    const result = evaluateOrderPreflight({ wallet: wallet({ usdgAllowanceRaw: 10n ** 12n }), connectedChainId: 1, amountInRaw: AMOUNT, transactions: [open], gasCostWei: { "open-spread": 1n } });
    expect(result.ready).toBe(false);
    expect(result.chainOk).toBe(false);
    expect(result.summary).toContain("Robinhood Mainnet");
  });
});
