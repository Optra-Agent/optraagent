/**
 * Order-specific funding preflight for a direct-wallet CallPut open.
 *
 * Pure: no chain access, no signing, no transfers. It turns the freshly read wallet state, the prepared plan and the
 * gas estimates into exact required-versus-held figures and exact shortfalls, so the owner sees what to fund before any
 * wallet prompt and the Sign button stays disabled while any line fails. Nothing here moves, approves or spends funds.
 */
import { formatEther } from "viem";
import type { Address } from "viem";
import { CALLPUT_APPROVAL_SPENDER, formatUsdgRaw, type CallPutPreparedTransaction, type CallPutWalletState } from "./callput-robinhood-write";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "./callput-robinhood-readonly";

export type PreflightUnit = "ETH" | "USDG";

export type PreflightLine = {
  id: "eth" | "usdg";
  label: string;
  unit: PreflightUnit;
  /** wei for ETH, 6-decimal raw units for USDG. */
  requiredRaw: bigint;
  heldRaw: bigint;
  shortfallRaw: bigint;
  ok: boolean;
  detail: string;
};

export type PreflightAllowance = {
  /** True when the wallet's current USDG allowance to the Controller is below the order's collateral. */
  approvalRequired: boolean;
  spender: Address;
  currentRaw: bigint;
  requiredRaw: bigint;
  detail: string;
};

export type PreflightDestination = { step: number; kind: CallPutPreparedTransaction["kind"]; label: string; to: Address; valueWei: bigint; /** Exact USDG approved, for an approval step. */ usdgAmountRaw: bigint | null };

export type OrderPreflight = {
  /** Every funding line passes and the wallet is on the right chain. Approval being required does not make this false: it is a separate transaction the owner confirms. */
  ready: boolean;
  chainOk: boolean;
  lines: PreflightLine[];
  shortfalls: PreflightLine[];
  allowance: PreflightAllowance;
  destinations: PreflightDestination[];
  /** Why the ETH figure is a floor, when the open transaction's gas could not be estimated yet. */
  gasNote: string | null;
  summary: string;
};

export const formatEth = (wei: bigint) => formatEther(wei);
export const formatUsdg = (raw: bigint) => formatUsdgRaw(raw);
export const formatPreflightAmount = (line: Pick<PreflightLine, "unit">, raw: bigint) => `${line.unit === "ETH" ? formatEth(raw) : formatUsdg(raw)} ${line.unit}`;

export type PreflightInput = {
  wallet: CallPutWalletState;
  connectedChainId: number | undefined;
  /** Collateral the open request pulls from the wallet. */
  amountInRaw: bigint;
  /** The ordered transactions the plan would send (an approval first when the allowance is short). */
  transactions: CallPutPreparedTransaction[];
  /** Estimated network fee ceiling per transaction kind, in wei. `null` means it could not be estimated yet. */
  gasCostWei: Partial<Record<CallPutPreparedTransaction["kind"], bigint | null>>;
};

export function evaluateOrderPreflight(input: PreflightInput): OrderPreflight {
  const { wallet, amountInRaw, transactions } = input;
  const chainOk = input.connectedChainId === CALLPUT_ROBINHOOD_CHAIN_ID;
  const executionFeeWei = transactions.reduce((sum, tx) => sum + tx.value, 0n);

  let gasTotal = 0n;
  const unknownGas: string[] = [];
  for (const tx of transactions) {
    const gas = input.gasCostWei[tx.kind];
    if (typeof gas === "bigint") gasTotal += gas;
    else unknownGas.push(tx.kind);
  }
  const ethRequired = executionFeeWei + gasTotal;
  const ethShort = ethRequired > wallet.nativeBalanceWei ? ethRequired - wallet.nativeBalanceWei : 0n;
  const usdgShort = amountInRaw > wallet.usdgBalanceRaw ? amountInRaw - wallet.usdgBalanceRaw : 0n;
  const gasNote = unknownGas.length
    ? `Gas for ${unknownGas.join(" and ")} cannot be estimated until the earlier step or funding is in place, so the ETH figure is a floor: the execution fee plus the gas that could be estimated.`
    : null;

  const lines: PreflightLine[] = [
    {
      id: "eth",
      label: "ETH for execution fee and gas",
      unit: "ETH",
      requiredRaw: ethRequired,
      heldRaw: wallet.nativeBalanceWei,
      shortfallRaw: ethShort,
      ok: ethShort === 0n,
      detail: `Execution fee ${formatEth(executionFeeWei)} ETH (read live from the PositionManager, not assumed refundable) plus ${formatEth(gasTotal)} ETH estimated network fee ceiling.`,
    },
    {
      id: "usdg",
      label: "USDG collateral",
      unit: "USDG",
      requiredRaw: amountInRaw,
      heldRaw: wallet.usdgBalanceRaw,
      shortfallRaw: usdgShort,
      ok: usdgShort === 0n,
      detail: `The open request pulls ${formatUsdg(amountInRaw)} USDG of estimated collateral (fee included) from this wallet.`,
    },
  ];
  const shortfalls = lines.filter((line) => !line.ok);

  const approvalRequired = wallet.usdgAllowanceRaw < amountInRaw;
  const allowance: PreflightAllowance = {
    approvalRequired,
    spender: CALLPUT_APPROVAL_SPENDER as Address,
    currentRaw: wallet.usdgAllowanceRaw,
    requiredRaw: amountInRaw,
    detail: approvalRequired
      ? `USDG allowance to the CallPut Controller is ${formatUsdg(wallet.usdgAllowanceRaw)} and this order needs ${formatUsdg(amountInRaw)}. A separate approval transaction for exactly ${formatUsdg(amountInRaw)} USDG comes first; you review and confirm it in your wallet. Nothing is approved automatically.`
      : `USDG allowance to the CallPut Controller is ${formatUsdg(wallet.usdgAllowanceRaw)}, enough for this order. No approval transaction is needed.`,
  };

  const destinations: PreflightDestination[] = transactions.map((tx, index) => ({
    step: index + 1,
    kind: tx.kind,
    label: tx.label,
    to: tx.to,
    valueWei: tx.value,
    usdgAmountRaw: tx.kind === "usdg-approval" ? amountInRaw : null,
  }));

  const ready = chainOk && shortfalls.length === 0;
  const summary = !chainOk
    ? `Switch the wallet to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`
    : shortfalls.length
      ? `Not ready. Fund this wallet with at least ${shortfalls.map((line) => formatPreflightAmount(line, line.shortfallRaw)).join(" and ")} more${gasNote ? " (a floor; see the gas note)" : ""}. Signing stays disabled until the preflight passes.`
      : `Preflight passed for this order: ${formatPreflightAmount(lines[0]!, ethRequired)} needed, ${formatPreflightAmount(lines[0]!, wallet.nativeBalanceWei)} held; ${formatPreflightAmount(lines[1]!, amountInRaw)} needed, ${formatPreflightAmount(lines[1]!, wallet.usdgBalanceRaw)} held.`;

  return { ready, chainOk, lines, shortfalls, allowance, destinations, gasNote, summary };
}

/**
 * Wallet-level view (before any order is prepared): what is held, what every order needs at minimum, and what the
 * allowance does. The exact per-order requirement still comes from `evaluateOrderPreflight`.
 */
export function describeWalletFunding(wallet: CallPutWalletState) {
  return {
    ethHeld: `${formatEth(wallet.nativeBalanceWei)} ETH`,
    executionFee: `${formatEth(wallet.executionFeeWei)} ETH`,
    usdgHeld: `${formatUsdg(wallet.usdgBalanceRaw)} USDG`,
    allowance: `${formatUsdg(wallet.usdgAllowanceRaw)} USDG`,
  };
}
