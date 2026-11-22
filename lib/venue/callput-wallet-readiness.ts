/**
 * Pure checks for "is this connected wallet ready for a direct-wallet CallPut order", and the US regular-session state.
 * No chain access and no signing. Exact per-order requirements (collateral, approval amount, fee) are computed by the
 * order panel when an order is prepared; these checks only say whether the wallet is in a state where preparing one
 * makes sense.
 */
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "./callput-robinhood-readonly";
import type { CallPutWalletState } from "./callput-robinhood-write";

export type ReadinessCheck = { id: string; ok: boolean; detail: string };

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);
const usdg = (raw: bigint) => (Number(raw) / 1e6).toFixed(6);

/**
 * `gasMarginMultiple`: the wallet should hold the execution fee plus room for gas on an approval and an order. Gas on
 * Robinhood Chain is not estimated here; the multiple only flags a wallet that is obviously too empty.
 */
export function evaluateDirectWalletReadiness(state: CallPutWalletState | null, connectedChainId: number | undefined, gasMarginMultiple = 3n): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [{ id: "chain", ok: connectedChainId === CALLPUT_ROBINHOOD_CHAIN_ID, detail: connectedChainId === CALLPUT_ROBINHOOD_CHAIN_ID ? `Wallet is on Robinhood Mainnet (${CALLPUT_ROBINHOOD_CHAIN_ID}).` : `Wallet is on chain ${connectedChainId ?? "unknown"}; orders need Robinhood Mainnet (${CALLPUT_ROBINHOOD_CHAIN_ID}).` }];
  if (!state) return [...checks, { id: "reads", ok: false, detail: "Balances and allowance have not been read yet." }];
  const needed = state.executionFeeWei * gasMarginMultiple;
  checks.push({ id: "eth", ok: state.nativeBalanceWei >= needed, detail: `${eth(state.nativeBalanceWei)} ETH held; the execution fee is ${eth(state.executionFeeWei)} ETH and ${eth(needed)} ETH is the minimum margin to cover it plus gas.` });
  checks.push({ id: "usdg", ok: state.usdgBalanceRaw > 0n, detail: `${usdg(state.usdgBalanceRaw)} USDG held. The order panel computes the exact collateral for the order you prepare.` });
  checks.push({ id: "allowance", ok: true, detail: state.usdgAllowanceRaw > 0n ? `${usdg(state.usdgAllowanceRaw)} USDG already approved to the CallPut Controller.` : "No USDG is approved yet. The first order needs a separate approval transaction that you confirm before the order itself." });
  checks.push({ id: "erc1155", ok: state.accountAcceptsErc1155 !== false, detail: state.accountAcceptsErc1155 === false ? "This wallet has contract code that rejects ERC-1155 option tokens, so every fill would revert and the execution fee would be lost." : "This wallet can receive ERC-1155 option tokens." });
  return checks;
}

export type UsSession = { open: boolean; label: string };

/**
 * The US cash session is 09:30-16:00 America/New_York, Monday to Friday. Exchange holidays and early closes are NOT
 * modelled. CallPut's keeper behavior outside that session has not been observed by OPTRA.
 */
export function usSessionState(now: Date): UsSession {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const open = !["Sat", "Sun"].includes(weekday) && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  return { open, label: open ? "US regular session is open (holidays not modelled)." : "US regular session is closed. CallPut's keeper behavior outside it has not been observed, so a request may sit pending." };
}
