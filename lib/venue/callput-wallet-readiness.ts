/**
 * Pure checks for "is this connected wallet ready for a direct-wallet CallPut order", and the US regular-session state.
 * No chain access and no signing. Exact per-order requirements (collateral, approval amount, fee) are computed by the
 * order panel when an order is prepared; these checks only say whether the wallet is in a state where preparing one
 * makes sense.
 */
import { formatEther } from "viem";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "./callput-robinhood-readonly";
import { CALLPUT_APPROVAL_SPENDER, formatUsdgRaw, type CallPutWalletState } from "./callput-robinhood-write";
import { marketSessionState } from "../engine/us-market-session";

export type ReadinessCheck = { id: string; ok: boolean; detail: string };

const eth = (wei: bigint) => formatEther(wei);
const usdg = (raw: bigint) => formatUsdgRaw(raw);

/**
 * Gas used by the two Mainnet-fork rehearsal transactions (docs/CallPut-Fork-Rehearsal-and-Candidate-Order-20261122.md):
 * USDG approve 57,976 and createOpenPosition 584,027. Rounded up. These size the ETH minimum shown BEFORE an order is
 * prepared; the order review replaces them with a fresh `eth_estimateGas` for the actual transaction.
 */
export const CALLPUT_APPROVE_GAS_ESTIMATE = 60_000n;
export const CALLPUT_OPEN_GAS_ESTIMATE = 600_000n;

/** Execution fee plus approve and open gas at `gasPriceWei`. With no gas price the floor is the execution fee alone. */
export function minimumEthForOneOrder(executionFeeWei: bigint, gasPriceWei: bigint | null): bigint {
  return executionFeeWei + (gasPriceWei === null ? 0n : (CALLPUT_APPROVE_GAS_ESTIMATE + CALLPUT_OPEN_GAS_ESTIMATE) * gasPriceWei);
}

/**
 * The wallet should hold the minimum ETH for one order (execution fee plus gas for an approval and the open request).
 * That minimum only says whether preparing an order is worthwhile; the exact figure and any shortfall come from the order review.
 */
export function evaluateDirectWalletReadiness(state: CallPutWalletState | null, connectedChainId: number | undefined, gasPriceWei: bigint | null = null): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [{ id: "chain", ok: connectedChainId === CALLPUT_ROBINHOOD_CHAIN_ID, detail: connectedChainId === CALLPUT_ROBINHOOD_CHAIN_ID ? `Wallet is on Robinhood Mainnet (${CALLPUT_ROBINHOOD_CHAIN_ID}).` : `Wallet is on chain ${connectedChainId ?? "unknown"}; orders need Robinhood Mainnet (${CALLPUT_ROBINHOOD_CHAIN_ID}).` }];
  if (!state) return [...checks, { id: "reads", ok: false, detail: "Balances and allowance have not been read yet." }];
  const needed = minimumEthForOneOrder(state.executionFeeWei, gasPriceWei);
  const short = needed > state.nativeBalanceWei ? needed - state.nativeBalanceWei : 0n;
  checks.push({
    id: "eth",
    ok: short === 0n,
    detail: `${eth(state.nativeBalanceWei)} ETH held. One order needs at least ${eth(needed)} ETH: the ${eth(state.executionFeeWei)} ETH execution fee (read live from the PositionManager, not assumed refundable)${gasPriceWei === null ? "" : ` plus gas for an approval and the open request at the current gas price`}.${short > 0n ? ` Short by ${eth(short)} ETH.` : ""} The order review replaces this with a fresh estimate for the exact order.`,
  });
  checks.push({ id: "usdg", ok: state.usdgBalanceRaw > 0n, detail: `${usdg(state.usdgBalanceRaw)} USDG held. Collateral is the order's own USDG amount, shown exactly with any shortfall in the order review; a wallet with no USDG cannot open anything.` });
  checks.push({
    id: "allowance",
    ok: true,
    detail: state.usdgAllowanceRaw > 0n
      ? `${usdg(state.usdgAllowanceRaw)} USDG already approved to the CallPut Controller (${CALLPUT_APPROVAL_SPENDER}). An order larger than this needs a new approval.`
      : `No USDG is approved yet. The Controller (${CALLPUT_APPROVAL_SPENDER}) pulls collateral with transferFrom, so the first order needs a separate approval transaction for exactly that order's USDG amount. You review and confirm it in your wallet before the order itself; OPTRA never approves automatically.`,
  });
  const receiverDetail = state.accountAcceptsErc1155 === true
    ? "The wallet has no receiver contract code or its CallPut position-token receiver behavior is verified."
    : state.accountAcceptsErc1155 === false
      ? "The CallPut position-token receiver check failed; order preparation is blocked."
      : "CallPut contract-wallet receiver compatibility is unverified; order preparation is blocked until the deployed token callback path is verified.";
  checks.push({ id: "erc1155", ok: state.accountAcceptsErc1155 === true, detail: receiverDetail });
  return checks;
}

export type UsSession = { open: boolean; label: string };

/**
 * Reuses the scheduler's exchange calendar so holidays and early closes match the actual eligibility logic.
 */
export function usSessionState(now: Date): UsSession {
  const session = marketSessionState(now.getTime());
  if (session.open) return { open: true, label: "US regular session is open." };
  const reason = session.closedReason === "holiday" ? "for an exchange holiday"
    : session.closedReason === "weekend" ? "for the weekend"
      : session.closedReason === "before_open" ? "before the regular open"
        : "after the regular session close";
  return { open: false, label: `US regular session is closed ${reason}. CallPut's keeper behavior outside it has not been observed, so a request may sit pending.` };
}
