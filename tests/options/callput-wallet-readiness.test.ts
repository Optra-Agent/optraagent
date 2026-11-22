import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { evaluateDirectWalletReadiness, minimumEthForOneOrder, usSessionState } from "../../lib/venue/callput-wallet-readiness";
import type { CallPutWalletState } from "../../lib/venue/callput-robinhood-write";

const state = (over: Partial<CallPutWalletState> = {}): CallPutWalletState => ({ chainId: 4663, account: "0x3cdb000000000000000000000000000000006dbb" as Address, usdgBalanceRaw: 450_270n, usdgAllowanceRaw: 0n, nativeBalanceWei: 387_000_000_000_000n, executionFeeWei: 60_000_000_000_000n, ...over });
const by = (checks: ReturnType<typeof evaluateDirectWalletReadiness>) => Object.fromEntries(checks.map((check) => [check.id, check]));

describe("direct-wallet readiness", () => {
  it("passes a funded wallet on Robinhood Mainnet and says the first order needs a separate approval", () => {
    const checks = by(evaluateDirectWalletReadiness(state(), 4663));
    expect(Object.values(checks).every((check) => check.ok)).toBe(true);
    expect(checks.allowance!.detail).toContain("separate approval transaction");
    expect(checks.usdg!.detail).toContain("0.450270 USDG");
  });

  it("flags the wrong network, an empty gas balance, no USDG, and a wallet that cannot receive ERC-1155", () => {
    expect(by(evaluateDirectWalletReadiness(state(), 1)).chain!.ok).toBe(false);
    expect(by(evaluateDirectWalletReadiness(state(), undefined)).chain!.detail).toContain("unknown");
    expect(by(evaluateDirectWalletReadiness(state({ nativeBalanceWei: 50_000_000_000_000n }), 4663)).eth!.ok).toBe(false);
    expect(by(evaluateDirectWalletReadiness(state({ usdgBalanceRaw: 0n }), 4663)).usdg!.ok).toBe(false);
    expect(by(evaluateDirectWalletReadiness(state({ accountAcceptsErc1155: false }), 4663)).erc1155!.ok).toBe(false);
  });

  it("sizes the ETH minimum from the live execution fee plus approve and open gas, and states the exact shortfall", () => {
    // fee 0.00006 ETH + (60,000 + 600,000) gas * 0.02 gwei = 0.00006 + 0.0000132 = 0.0000732 ETH
    const gasPrice = 20_000_000n;
    expect(minimumEthForOneOrder(60_000_000_000_000n, gasPrice)).toBe(73_200_000_000_000n);
    expect(minimumEthForOneOrder(60_000_000_000_000n, null)).toBe(60_000_000_000_000n);
    const ok = by(evaluateDirectWalletReadiness(state({ nativeBalanceWei: 73_200_000_000_000n }), 4663, gasPrice));
    expect(ok.eth!.ok).toBe(true);
    const short = by(evaluateDirectWalletReadiness(state({ nativeBalanceWei: 70_000_000_000_000n }), 4663, gasPrice));
    expect(short.eth!.ok).toBe(false);
    expect(short.eth!.detail).toContain("Short by 0.0000032 ETH");
    expect(short.eth!.detail).toContain("0.00007 ETH held");
  });

  it("explains the USDG allowance, the spender and that approval is never automatic", () => {
    const none = by(evaluateDirectWalletReadiness(state(), 4663)).allowance!;
    expect(none.detail).toContain("separate approval transaction");
    expect(none.detail).toContain("never approves automatically");
    expect(none.detail).toContain("0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B");
  });

  it("is not ready before balances are read, and reports an existing approval", () => {
    expect(by(evaluateDirectWalletReadiness(null, 4663)).reads!.ok).toBe(false);
    expect(by(evaluateDirectWalletReadiness(state({ usdgAllowanceRaw: 1_000_000n }), 4663)).allowance!.detail).toContain("1.000000 USDG already approved");
  });
});

describe("US regular session", () => {
  it("is closed on weekends and outside 09:30-16:00 New York time, open inside it", () => {
    expect(usSessionState(new Date("2026-11-22T15:00:00Z")).open).toBe(false); // Sunday
    expect(usSessionState(new Date("2026-11-23T14:29:00Z")).open).toBe(false); // Mon 09:29 EST
    expect(usSessionState(new Date("2026-11-23T14:30:00Z")).open).toBe(true); // Mon 09:30 EST
    expect(usSessionState(new Date("2026-11-23T20:59:00Z")).open).toBe(true); // Mon 15:59 EST
    expect(usSessionState(new Date("2026-11-23T21:00:00Z")).open).toBe(false); // Mon 16:00 EST
    expect(usSessionState(new Date("2026-07-15T13:30:00Z")).open).toBe(true); // Wed 09:30 EDT
    expect(usSessionState(new Date("2026-07-15T13:29:00Z")).open).toBe(false);
  });

  it("warns that keeper behavior outside the session is unobserved", () => {
    expect(usSessionState(new Date("2026-11-22T15:00:00Z")).label).toContain("has not been observed");
  });
});
