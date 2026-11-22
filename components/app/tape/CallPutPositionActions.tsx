"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "@/lib/venue/callput-robinhood-readonly";
import { readCallPutRobinhoodRequest } from "@/lib/venue/callput-robinhood-requests";
import { discoverCallPutPositions, type DiscoveredPosition } from "@/lib/venue/callput-position-discovery";
import {
  CALLPUT_ROBINHOOD_UNDERLYINGS,
  extractCallPutRequestKey,
  extractCallPutSettlement,
  prepareCallPutClose,
  prepareCallPutSettle,
  readCallPutPositionState,
  reconcileCallPutClose,
  reconcileCallPutSettlement,
  type CallPutCloseReconciliation,
  type CallPutPreparedTransaction,
  type CallPutPositionState,
  type CallPutSettlementEvent,
  type CallPutSettlementReconciliation,
  type CallPutUnderlyingSymbol,
} from "@/lib/venue/callput-robinhood-write";
import {
  appendCallPutOrderReference,
  createCallPutLedgerId,
  createCallPutOrderIntent,
  listCallPutOrderIntents,
} from "@/lib/venue/callput-order-ledger-client";
import type { CallPutOrderIntentRecord } from "@/lib/venue/callput-order-ledger";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import { callPutPositionActionEnabled } from "./CallPutOrderPanel";
import { Chip, Panel } from "../ui";

const ACTION_STORAGE_KEY = "optra.callput.robinhood.position-actions.v1";
const ACTION_EVENT = "optra-callput-position-actions";
const MAX_ACTIONS = 50;

type StoredAction = {
  version: 1;
  id: string;
  clientIntentId?: string;
  serverOrderId?: string;
  chainId: typeof CALLPUT_ROBINHOOD_CHAIN_ID;
  account: Address;
  kind: "close" | "settle";
  underlying: CallPutUnderlyingSymbol;
  underlyingAssetIndex: number;
  optionTokenId: string;
  positionBalanceBeforeRaw: string;
  sizeRaw: string | null;
  minAmountOutRaw: string | null;
  minOutWhenSwapRaw: string;
  createdAtMs: number;
  txHash: Hex | null;
  requestKey: Hex | null;
  requestKeyEventId?: string;
  requestKeySynced?: boolean;
  settlement: { sizeRaw: string; amountOutRaw: string; settlePriceRaw: string } | null;
  pendingTransaction: {
    kind: CallPutPreparedTransaction["kind"];
    txHash: Hex;
    status: "submitted" | "confirmed" | "reverted";
    eventId?: string;
    historySynced?: boolean;
  } | null;
  reconciliation: { state: string; evidence: string; fillConfirmed: boolean } | null;
};

type GasQuote = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint | null;
  legacyGasPrice: bigint | null;
  totalCostWei: bigint;
};

type PositionPlan = {
  id: string;
  kind: "close" | "settle";
  underlying: CallPutUnderlyingSymbol;
  optionTokenId: bigint;
  position: CallPutPositionState;
  sizeRaw: bigint | null;
  minAmountOutRaw: bigint | null;
  minOutWhenSwapRaw: bigint;
  transactions: CallPutPreparedTransaction[];
  gas: GasQuote;
  preparedAtMs: number;
};

type PositionReconciliation = CallPutCloseReconciliation | CallPutSettlementReconciliation;

function nowMs(): number {
  return Date.now();
}

function subscribeActions(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(ACTION_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ACTION_EVENT, onChange);
  };
}

function readActionsRaw(): string {
  return window.localStorage.getItem(ACTION_STORAGE_KEY) ?? "[]";
}

function parseActions(raw: string): StoredAction[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StoredAction =>
      item?.version === 1 &&
      item.chainId === CALLPUT_ROBINHOOD_CHAIN_ID &&
      typeof item.id === "string" &&
      typeof item.account === "string" &&
      isAddress(item.account) &&
      (item.kind === "close" || item.kind === "settle") &&
      typeof item.optionTokenId === "string" &&
      typeof item.positionBalanceBeforeRaw === "string",
    );
  } catch {
    return [];
  }
}

function saveAction(action: StoredAction) {
  const others = parseActions(readActionsRaw()).filter((item) => item.id !== action.id);
  window.localStorage.setItem(ACTION_STORAGE_KEY, JSON.stringify([action, ...others].slice(0, MAX_ACTIONS)));
  window.dispatchEvent(new Event(ACTION_EVENT));
}

function createActionId(): string {
  return createCallPutLedgerId();
}

function errorText(error: unknown): string {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (code === 4001 || (error instanceof Error && /user rejected|rejected the request/i.test(error.message))) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  const short = (error as { shortMessage?: unknown } | null)?.shortMessage;
  if (typeof short === "string" && short) return short.replace(/https?:\/\/[^\s)]+/gi, "[endpoint]");
  if (error instanceof Error) return error.message.replace(/https?:\/\/[^\s)]+/gi, "[endpoint]") || "Position action failed.";
  return "Position action failed.";
}

function parsePositiveRaw(value: string, label: string): bigint {
  const text = value.trim();
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a positive raw integer.`);
  const parsed = BigInt(text);
  if (parsed <= 0n || parsed >= (1n << 256n)) throw new RangeError(`${label} is outside the supported uint256 range.`);
  return parsed;
}

async function estimateGas(client: PublicClient, transaction: CallPutPreparedTransaction): Promise<GasQuote> {
  const [gasLimit, fees] = await Promise.all([
    client.estimateGas({ account: transaction.from, to: transaction.to, data: transaction.data, value: transaction.value }),
    client.estimateFeesPerGas(),
  ]);
  const eip1559 = fees.maxFeePerGas !== undefined && fees.maxFeePerGas !== null;
  if (eip1559 && fees.maxPriorityFeePerGas == null) throw new Error("The RPC returned an incomplete EIP-1559 fee quote; no transaction is offered.");
  const maxFeePerGas = eip1559 ? fees.maxFeePerGas! : fees.gasPrice ?? await client.getGasPrice();
  const maxPriorityFeePerGas = eip1559 ? fees.maxPriorityFeePerGas! : null;
  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    legacyGasPrice: fees.gasPrice ?? null,
    totalCostWei: gasLimit * maxFeePerGas,
  };
}

function gasRequest(gas: GasQuote) {
  return gas.maxPriorityFeePerGas === null
    ? { gas: gas.gasLimit, gasPrice: gas.legacyGasPrice ?? gas.maxFeePerGas }
    : { gas: gas.gasLimit, maxFeePerGas: gas.maxFeePerGas, maxPriorityFeePerGas: gas.maxPriorityFeePerGas };
}

function makeStoredAction(plan: PositionPlan, txHash: Hex | null, pendingTransaction: StoredAction["pendingTransaction"]): StoredAction {
  return {
    version: 1,
    id: plan.id,
    chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
    account: getAddress(plan.position.account),
    kind: plan.kind,
    underlying: plan.underlying,
    underlyingAssetIndex: CALLPUT_ROBINHOOD_UNDERLYINGS[plan.underlying].index,
    optionTokenId: plan.optionTokenId.toString(),
    positionBalanceBeforeRaw: plan.position.positionBalanceRaw.toString(),
    sizeRaw: plan.sizeRaw?.toString() ?? null,
    minAmountOutRaw: plan.minAmountOutRaw?.toString() ?? null,
    minOutWhenSwapRaw: plan.minOutWhenSwapRaw.toString(),
    createdAtMs: plan.preparedAtMs,
    txHash,
    requestKey: null,
    settlement: null,
    pendingTransaction,
    reconciliation: null,
  };
}

function persistedActionIntent(plan: PositionPlan): CallPutOrderIntentRecord {
  const common = {
    version: 1 as const,
    chainId: CALLPUT_ROBINHOOD_CHAIN_ID as typeof CALLPUT_ROBINHOOD_CHAIN_ID,
    account: getAddress(plan.position.account),
    id: plan.id,
    underlying: plan.underlying,
    underlyingAssetIndex: CALLPUT_ROBINHOOD_UNDERLYINGS[plan.underlying].index,
    optionTokenId: plan.optionTokenId.toString(),
    positionBalanceBeforeRaw: plan.position.positionBalanceRaw.toString(),
    minOutWhenSwapRaw: plan.minOutWhenSwapRaw.toString(),
    createdAtMs: plan.preparedAtMs,
  };
  if (plan.kind === "close") {
    if (plan.sizeRaw === null || plan.minAmountOutRaw === null) throw new Error("Close order sizing is incomplete.");
    return { ...common, kind: "close", sizeRaw: plan.sizeRaw.toString(), minAmountOutRaw: plan.minAmountOutRaw.toString() };
  }
  return { ...common, kind: "settle", sizeRaw: null, minAmountOutRaw: null };
}

function mergeRecoveredAction(existing: StoredAction | undefined, recovered: StoredAction): StoredAction {
  if (!existing) return recovered;
  const existingPending = existing.pendingTransaction;
  const recoveredPending = recovered.pendingTransaction;
  const sameTransaction = Boolean(existingPending && recoveredPending && existingPending.txHash.toLowerCase() === recoveredPending.txHash.toLowerCase());
  const pendingTransaction = existingPending && sameTransaction
    ? {
      ...recoveredPending,
      ...existingPending,
      eventId: recoveredPending?.eventId ?? existingPending.eventId,
      historySynced: Boolean(recoveredPending?.historySynced || existingPending.historySynced),
    }
    : existingPending?.historySynced === false
      ? existingPending
      : recoveredPending ?? existingPending;
  const keepLocalRequest = Boolean(existing.requestKey && !existing.requestKeySynced);
  const requestKey = keepLocalRequest ? existing.requestKey : recovered.requestKey ?? existing.requestKey;
  return {
    ...recovered,
    clientIntentId: recovered.clientIntentId ?? existing.clientIntentId,
    serverOrderId: recovered.serverOrderId ?? existing.serverOrderId,
    txHash: existing.txHash ?? recovered.txHash,
    requestKey,
    requestKeyEventId: keepLocalRequest ? existing.requestKeyEventId : recovered.requestKeyEventId ?? existing.requestKeyEventId,
    requestKeySynced: requestKey === recovered.requestKey ? Boolean(recovered.requestKeySynced) : Boolean(existing.requestKeySynced),
    settlement: existing.settlement ?? recovered.settlement,
    pendingTransaction,
    reconciliation: existing.reconciliation ?? recovered.reconciliation,
  };
}

function readStoredSettlement(action: StoredAction): CallPutSettlementEvent | null {
  if (!action.settlement) return null;
  return {
    account: action.account,
    underlyingAssetIndex: action.underlyingAssetIndex,
    optionTokenId: BigInt(action.optionTokenId),
    size: BigInt(action.settlement.sizeRaw),
    amountOut: BigInt(action.settlement.amountOutRaw),
    settlePrice: BigInt(action.settlement.settlePriceRaw),
  };
}

export function CallPutPositionActions() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const busy = useRef(false);
  const actionsRaw = useSyncExternalStore(subscribeActions, readActionsRaw, () => "[]");
  const accountActions = useMemo(() => parseActions(actionsRaw)
    .filter((item) => address && item.account.toLowerCase() === address.toLowerCase()), [actionsRaw, address]);
  const latestAction = accountActions[0] ?? null;
  const pendingAction = accountActions.find((item) => item.pendingTransaction?.status === "submitted") ?? null;

  const [underlying, setUnderlying] = useState<CallPutUnderlyingSymbol>("AAPL");
  const [kind, setKind] = useState<"close" | "settle">("close");
  const [optionTokenIdText, setOptionTokenIdText] = useState("");
  const [sizeRawText, setSizeRawText] = useState("");
  const [minAmountOutRawText, setMinAmountOutRawText] = useState("");
  const [minOutWhenSwapRawText, setMinOutWhenSwapRawText] = useState("");
  const [plan, setPlan] = useState<PositionPlan | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [reconciliation, setReconciliation] = useState<PositionReconciliation | null>(null);
  const [serverOrderId, setServerOrderId] = useState<string | null>(null);
  const [positions, setPositions] = useState<DiscoveredPosition[] | null>(null);
  const [discoverNonce, setDiscoverNonce] = useState(0);

  useEffect(() => {
    if (!address) return;
    const connectedAddress = address;
    let active = true;
    void listCallPutOrderIntents().then((orders) => {
      if (!active) return;
      const owned = orders
        .filter((order) => (order.kind === "close" || order.kind === "settle") && isAddress(order.account) && order.account.toLowerCase() === connectedAddress.toLowerCase())
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-MAX_ACTIONS);
      for (const order of owned) {
        if ((order.kind !== "close" && order.kind !== "settle") || order.intent.kind !== order.kind) continue;
        const events = [...order.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const transaction = events.filter((event) => event.referenceKind === "transaction").at(-1);
        const request = events.filter((event) => event.referenceKind === "request-key" && event.transactionKind === "close-position").at(-1);
        const action: StoredAction = {
          version: 1,
          id: order.clientIntentId,
          clientIntentId: order.clientIntentId,
          serverOrderId: order.id,
          chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
          account: getAddress(order.intent.account),
          kind: order.intent.kind,
          underlying: order.intent.underlying,
          underlyingAssetIndex: order.intent.underlyingAssetIndex,
          optionTokenId: order.intent.optionTokenId,
          positionBalanceBeforeRaw: order.intent.positionBalanceBeforeRaw,
          sizeRaw: order.intent.sizeRaw,
          minAmountOutRaw: order.intent.minAmountOutRaw,
          minOutWhenSwapRaw: order.intent.minOutWhenSwapRaw,
          createdAtMs: order.intent.createdAtMs,
          txHash: (request?.transactionHash ?? transaction?.transactionHash ?? null) as Hex | null,
          requestKey: (request?.requestKey as Hex | undefined) ?? null,
          requestKeyEventId: request?.eventId,
          requestKeySynced: Boolean(request),
          settlement: null,
          pendingTransaction: transaction ? {
            kind: transaction.transactionKind,
            txHash: transaction.transactionHash as Hex,
            status: "submitted",
            eventId: transaction.eventId,
            historySynced: true,
          } : null,
          reconciliation: null,
        };
        const existing = parseActions(readActionsRaw()).find((item) => item.id === action.id && item.account.toLowerCase() === connectedAddress.toLowerCase());
        saveAction(mergeRecoveredAction(existing, action));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [address]);

  // Discovery: only positions the chain confirms (open request Executed for this wallet and a positive token balance).
  useEffect(() => {
    if (!address || !publicClient) return;
    const connectedAddress = address;
    const client = publicClient as PublicClient;
    let active = true;
    void listCallPutOrderIntents().then(async (orders) => {
      const refs = orders
        .filter((order) => order.kind === "open" && isAddress(order.account) && order.account.toLowerCase() === connectedAddress.toLowerCase())
        .flatMap((order) => {
          const key = [...order.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).filter((event) => event.referenceKind === "request-key").at(-1)?.requestKey;
          return key && order.intent.kind === "open" ? [{ requestKey: key as Hex, underlying: order.intent.underlying }] : [];
        });
      const found = await discoverCallPutPositions(client, connectedAddress, refs, nowMs());
      if (active) setPositions(found);
    }).catch(() => { if (active) setPositions(null); });
    return () => { active = false; };
  }, [address, publicClient, discoverNonce]);

  function selectPosition(position: DiscoveredPosition) {
    setUnderlying(position.underlying);
    setKind(position.action === "settle" ? "settle" : "close");
    setOptionTokenIdText(position.optionTokenId.toString());
    setSizeRawText(position.action === "settle" ? "" : position.balanceRaw.toString());
    resetPlan();
  }

  function resetPlan() {
    setPlan(null);
    setReviewed(false);
    setMessage("");
    setError("");
    setServerOrderId(null);
  }

  async function prepare() {
    resetPlan();
    if (!publicClient || !address || !isConnected) {
      setError("Connect a wallet before preparing a position action.");
      return;
    }
    if (pendingAction) {
      setError("A previously submitted transaction still needs receipt recovery. Do not submit another transaction.");
      return;
    }
    setWorking(true);
    try {
      if (chainId !== CALLPUT_ROBINHOOD_CHAIN_ID) {
        throw new Error(`Switch your wallet to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}).`);
      }
      const optionTokenId = parsePositiveRaw(optionTokenIdText, "Option token ID");
      const minOutWhenSwapRaw = parsePositiveRaw(minOutWhenSwapRawText, "Minimum swap output");
      const sizeRaw = kind === "close" ? parsePositiveRaw(sizeRawText, "Close size") : null;
      const minAmountOutRaw = kind === "close" ? parsePositiveRaw(minAmountOutRawText, "Minimum amount out") : null;
      const manager = kind === "close" ? "position" : "settle";
      const position = await readCallPutPositionState(publicClient, address, underlying, optionTokenId, manager);
      const prepared = kind === "close"
        ? prepareCallPutClose({
          underlying,
          optionTokenId,
          sizeRaw: sizeRaw as bigint,
          minAmountOutRaw: minAmountOutRaw as bigint,
          minOutWhenSwapRaw,
          position,
          nowMs: nowMs(),
        })
        : prepareCallPutSettle({ underlying, optionTokenId, minOutWhenSwapRaw, position, nowMs: nowMs() });
      const firstTransaction = prepared.transactions[0];
      if (!firstTransaction) throw new Error("No transaction was prepared for this position action.");
      const gas = await estimateGas(publicClient, firstTransaction);
      const requiredNativeBalance = firstTransaction.value + gas.totalCostWei;
      if (position.nativeBalanceWei < requiredNativeBalance) {
        throw new Error(`Insufficient native balance for execution fee plus estimated gas. Required at least ${requiredNativeBalance} wei; wallet has ${position.nativeBalanceWei} wei.`);
      }
      setPlan({
        id: createActionId(),
        kind,
        underlying,
        optionTokenId,
        position,
        sizeRaw,
        minAmountOutRaw,
        minOutWhenSwapRaw,
        transactions: prepared.transactions,
        gas,
        preparedAtMs: nowMs(),
      });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setWorking(false);
    }
  }

  async function refreshAction(action: StoredAction, client: PublicClient) {
    if (action.kind === "close" && action.requestKey) {
      const request = await readCallPutRobinhoodRequest(client, "close", action.requestKey);
      const position = await readCallPutPositionState(client, action.account, action.underlying, BigInt(action.optionTokenId), "position");
      const result = reconcileCallPutClose({
        request,
        requestKey: action.requestKey,
        account: action.account,
        optionTokenId: BigInt(action.optionTokenId),
        preBalanceRaw: BigInt(action.positionBalanceBeforeRaw),
        balanceAfterRaw: position.positionBalanceRaw,
        nowMs: nowMs(),
      });
      saveAction({ ...action, reconciliation: result });
      setReconciliation(result);
      setMessage("Close status refreshed from PositionManager and the wallet position-token balance.");
      return;
    }
    if (action.kind === "settle" && action.settlement) {
      const position = await readCallPutPositionState(client, action.account, action.underlying, BigInt(action.optionTokenId), "settle");
      const result = reconcileCallPutSettlement({
        settlement: readStoredSettlement(action),
        preBalanceRaw: BigInt(action.positionBalanceBeforeRaw),
        balanceAfterRaw: position.positionBalanceRaw,
      });
      saveAction({ ...action, reconciliation: result });
      setReconciliation(result);
      setMessage(result.evidence);
    }
  }

  async function sign() {
    if (!plan || !publicClient || !walletClient || !address || busy.current || pendingAction) return;
    if (!callPutPositionActionEnabled(plan.kind)) {
      setError(`Signing is disabled in this build for ${plan.kind}. Nothing was sent.`);
      return;
    }
    const walletChainId = (walletClient as unknown as { chain?: { id?: number } }).chain?.id;
    if (chainId !== CALLPUT_ROBINHOOD_CHAIN_ID || (walletChainId !== undefined && walletChainId !== CALLPUT_ROBINHOOD_CHAIN_ID)) {
      setError(`Switch your wallet to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`);
      return;
    }
    if (nowMs() - plan.preparedAtMs > 30_000) {
      setPlan(null);
      setReviewed(false);
      setError("The gas estimate is older than 30 seconds. Prepare again to refresh the transaction and gas estimate.");
      return;
    }
    const transaction = plan.transactions[0];
    if (!transaction || !reviewed) return;
    busy.current = true;
    setWorking(true);
    setError("");
    setMessage("Saving position action to server history…");
    try {
      const persistedOrderId = serverOrderId ?? (await createCallPutOrderIntent({
        clientIntentId: plan.id,
        intent: persistedActionIntent(plan),
      })).orderId;
      setServerOrderId(persistedOrderId);
      const draft = { ...makeStoredAction(plan, null, null), clientIntentId: plan.id, serverOrderId: persistedOrderId };
      saveAction(draft);
      if (nowMs() - plan.preparedAtMs > 30_000) {
        setPlan(null);
        setReviewed(false);
        setError("The gas estimate expired while saving the action. Prepare again before signing.");
        return;
      }
      if (await publicClient.getChainId() !== CALLPUT_ROBINHOOD_CHAIN_ID) {
        throw new Error(`Switch your wallet to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`);
      }
      const currentWalletChain = (walletClient as unknown as { chain?: { id?: number } }).chain?.id;
      if (currentWalletChain !== CALLPUT_ROBINHOOD_CHAIN_ID) {
        throw new Error(`Switch your wallet to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`);
      }
      const currentNativeBalance = await publicClient.getBalance({ address: getAddress(address) });
      if (currentNativeBalance < transaction.value + plan.gas.totalCostWei) {
        throw new Error("Native balance no longer covers this transaction's value plus estimated gas. Prepare again after funding the wallet.");
      }
      setMessage("Waiting for wallet approval…");
      const transactionEventId = createCallPutLedgerId();
      const hash = await walletClient.sendTransaction({
        account: getAddress(address),
        chain: robinhoodMainnet,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        ...gasRequest(plan.gas),
      });
      const pendingTransaction = { kind: transaction.kind, txHash: hash, status: "submitted" as const, eventId: transactionEventId, historySynced: false };
      let stored: StoredAction = { ...makeStoredAction(plan, hash, pendingTransaction), clientIntentId: plan.id, serverOrderId: persistedOrderId };
      saveAction(stored);
      let transactionHistorySynced = false;
      try {
        await appendCallPutOrderReference(persistedOrderId, {
          eventId: transactionEventId,
          referenceKind: "transaction",
          transactionKind: transaction.kind,
          transactionHash: hash,
        });
        transactionHistorySynced = true;
      } catch {
        // Keep the broadcast hash locally and retry its idempotent history event during recovery.
      }
      const trackedPending = { ...pendingTransaction, historySynced: transactionHistorySynced };
      stored = { ...stored, pendingTransaction: trackedPending };
      saveAction(stored);
      setMessage(`Submitted ${hash}. Waiting for confirmation${transactionHistorySynced ? "…" : "; server history sync is pending."}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        saveAction({ ...stored, txHash: hash, pendingTransaction: { ...trackedPending, status: "reverted" } });
        setMessage("");
        throw new Error("The transaction reverted on-chain. No position change is confirmed.");
      }
      if (transaction.kind === "option-token-approval") {
        saveAction({ ...stored, txHash: hash, pendingTransaction: { ...trackedPending, status: "confirmed" } });
        setPlan(null);
        setReviewed(false);
        setServerOrderId(null);
        setMessage("Token approval confirmed. Prepare again to re-read the position and refresh gas before closing or settling.");
        return;
      }
      if (plan.kind === "close") {
        const requestKey = extractCallPutRequestKey(receipt, { account: address, isOpen: false });
        const requestKeyEventId = stored.requestKeyEventId ?? createCallPutLedgerId();
        stored = { ...stored, txHash: hash, requestKey, requestKeyEventId, requestKeySynced: false, pendingTransaction: { ...trackedPending, status: "confirmed" } };
        saveAction(stored);
        try {
          await appendCallPutOrderReference(persistedOrderId, {
            eventId: requestKeyEventId,
            referenceKind: "request-key",
            transactionKind: "close-position",
            transactionHash: hash,
            requestKey,
          });
          stored = { ...stored, requestKeySynced: true };
          saveAction(stored);
        } catch {
          // Receipt-derived request key stays in local history for a later idempotent sync retry.
        }
        setMessage(`Close request submitted. Keeper processing is not a fill yet.${stored.requestKeySynced ? "" : " Server history sync is pending."}`);
      } else {
        const settlement = extractCallPutSettlement(receipt, {
          account: address,
          underlyingAssetIndex: CALLPUT_ROBINHOOD_UNDERLYINGS[plan.underlying].index,
          optionTokenId: plan.optionTokenId,
        });
        const settled: StoredAction = {
          ...stored,
          txHash: hash,
          pendingTransaction: { ...trackedPending, status: "confirmed" },
          settlement: {
            sizeRaw: settlement.size.toString(),
            amountOutRaw: settlement.amountOut.toString(),
            settlePriceRaw: settlement.settlePrice.toString(),
          },
        };
        saveAction(settled);
        setMessage(`Settlement event recovered: ${settlement.size} raw position units; amount out ${settlement.amountOut} raw USDG.`);
        await refreshAction(settled, publicClient);
      }
      setPlan(null);
      setReviewed(false);
    } catch (failure) {
      setError(errorText(failure));
      setMessage("");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function recoverOrRefresh() {
    if (!publicClient || !latestAction) return;
    setWorking(true);
    setError("");
    try {
      let action = pendingAction ?? latestAction;
      let pending = action.pendingTransaction;
      if (pending?.eventId && !pending.historySynced && action.serverOrderId) {
        try {
          await appendCallPutOrderReference(action.serverOrderId, {
            eventId: pending.eventId,
            referenceKind: "transaction",
            transactionKind: pending.kind,
            transactionHash: pending.txHash,
          });
          pending = { ...pending, historySynced: true };
          action = { ...action, pendingTransaction: pending };
          saveAction(action);
        } catch {
          // Keep receipt recovery available while the server history service is offline.
        }
      }
      if (pending?.status === "submitted") {
        const receipt = await publicClient.getTransactionReceipt({ hash: pending.txHash });
        if (receipt.status !== "success") {
          action = { ...action, pendingTransaction: { ...pending, status: "reverted" } };
          saveAction(action);
          setMessage("The submitted transaction reverted. No CallPut position change is confirmed.");
          return;
        }
        if (pending.kind === "option-token-approval") {
          action = { ...action, pendingTransaction: { ...pending, status: "confirmed" } };
          saveAction(action);
          setMessage("Token approval confirmed. Re-prepare before signing a close or settlement.");
          return;
        }
        if (action.kind === "close") {
          const requestKey = extractCallPutRequestKey(receipt, { account: action.account, isOpen: false });
          const requestKeyEventId = action.requestKeyEventId ?? createCallPutLedgerId();
          action = {
            ...action,
            requestKey,
            requestKeyEventId,
            requestKeySynced: false,
            txHash: pending.txHash,
            pendingTransaction: { ...pending, status: "confirmed" },
          };
          saveAction(action);
          setMessage("Close request recovered from its receipt. It is not a fill yet.");
        } else {
          const settlement = extractCallPutSettlement(receipt, {
            account: action.account,
            underlyingAssetIndex: action.underlyingAssetIndex,
            optionTokenId: BigInt(action.optionTokenId),
          });
          action = {
            ...action,
            txHash: pending.txHash,
            pendingTransaction: { ...pending, status: "confirmed" },
            settlement: { sizeRaw: settlement.size.toString(), amountOutRaw: settlement.amountOut.toString(), settlePriceRaw: settlement.settlePrice.toString() },
          };
          saveAction(action);
        }
      }
      if (action.kind === "close" && action.requestKey && action.requestKeyEventId && !action.requestKeySynced && action.txHash && action.serverOrderId) {
        try {
          await appendCallPutOrderReference(action.serverOrderId, {
            eventId: action.requestKeyEventId,
            referenceKind: "request-key",
            transactionKind: "close-position",
            transactionHash: action.txHash,
            requestKey: action.requestKey,
          });
          action = { ...action, requestKeySynced: true };
          saveAction(action);
        } catch {
          // The receipt-derived key remains available locally for another sync attempt.
        }
      }
      await refreshAction(action, publicClient);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setWorking(false);
    }
  }

  const transaction = plan?.transactions[0] ?? null;
  const approvalRequired = transaction?.kind === "option-token-approval";

  return (
    <Panel aria-label="CallPut position actions" className="mb-5 p-5 sm:p-6">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Close or settle a position</summary>
        <div className="mt-4 grid gap-3">
          <p className="text-sm text-muted-foreground">Direct-wallet actions only. Your connected EVM wallet remains the account and signer. CallPut Account sessions and autonomous execution are not enabled. Close and settlement outputs are not quoted; you set raw minimum-output floors, and a keeper may execute at a different price.</p>
          {address && positions !== null ? (
            <div className="grid gap-2" aria-label="Your filled positions">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Your filled positions</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setDiscoverNonce((value) => value + 1)}>Refresh</Button>
              </div>
              {positions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No filled position found. A position is listed only after the venue&apos;s keeper filled an open order placed from this wallet here and the wallet holds the option token. A submitted transaction is not a position.</p>
              ) : (
                <ul className="grid gap-2">
                  {positions.map((position) => (
                    <li key={position.requestKey} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-xs">
                      <span className="mono break-all">{position.underlying} · token {position.optionTokenId.toString().slice(0, 10)}… · balance {position.balanceRaw.toString()} raw · expires {new Date(position.expiry * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC<br />{position.reason}</span>
                      <Button type="button" variant="outline" size="sm" disabled={position.action === "none"} onClick={() => selectPosition(position)}>{position.action === "settle" ? "Prepare settle" : position.action === "close" ? "Prepare close" : "Not eligible yet"}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="cp-position-underlying" className="text-sm font-medium">Underlying</label>
              <NativeSelect id="cp-position-underlying" value={underlying} onChange={(event) => { setUnderlying(event.target.value as CallPutUnderlyingSymbol); resetPlan(); }}>
                {(Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS) as CallPutUnderlyingSymbol[]).map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="cp-position-action" className="text-sm font-medium">Action</label>
              <NativeSelect id="cp-position-action" value={kind} onChange={(event) => { setKind(event.target.value as "close" | "settle"); resetPlan(); }}>
                <option value="close">Close before expiry</option>
                <option value="settle">Settle after expiry</option>
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="cp-position-token-id" className="text-sm font-medium">Option token ID (decimal)</label>
            <Input id="cp-position-token-id" inputMode="numeric" value={optionTokenIdText} onChange={(event) => { setOptionTokenIdText(event.target.value); resetPlan(); }} autoComplete="off" spellCheck={false} />
          </div>
          {kind === "close" ? <div className="grid gap-1.5">
            <label htmlFor="cp-position-close-size" className="text-sm font-medium">Close size (raw underlying units)</label>
            <Input id="cp-position-close-size" inputMode="numeric" value={sizeRawText} onChange={(event) => { setSizeRawText(event.target.value); resetPlan(); }} autoComplete="off" spellCheck={false} />
          </div> : null}
          {kind === "close" ? <div className="grid gap-1.5">
            <label htmlFor="cp-position-min-out" className="text-sm font-medium">Minimum amount out (raw USDG)</label>
            <Input id="cp-position-min-out" inputMode="numeric" value={minAmountOutRawText} onChange={(event) => { setMinAmountOutRawText(event.target.value); resetPlan(); }} autoComplete="off" spellCheck={false} />
          </div> : null}
          <div className="grid gap-1.5">
            <label htmlFor="cp-position-min-swap" className="text-sm font-medium">Minimum swap output (raw)</label>
            <Input id="cp-position-min-swap" inputMode="numeric" value={minOutWhenSwapRawText} onChange={(event) => { setMinOutWhenSwapRawText(event.target.value); resetPlan(); }} autoComplete="off" spellCheck={false} />
          </div>
          <p className="text-xs text-muted-foreground">Position size and minimums are raw on-chain units, not decimal-adjusted quotes. This action does not infer slippage or promise proceeds.</p>
          <div>
            <Button type="button" variant="outline" onClick={() => void prepare()} disabled={working || !isConnected || Boolean(pendingAction)}>
              {kind === "close" ? "Prepare close" : "Prepare settlement"}
            </Button>
            {!isConnected ? <p role="status" className="mt-2 text-sm text-muted-foreground">Connect an EVM wallet to read positions.</p> : null}
            {isConnected && chainId !== CALLPUT_ROBINHOOD_CHAIN_ID ? <p role="status" className="mt-2 text-sm text-muted-foreground">Switch to Robinhood Mainnet (chain {CALLPUT_ROBINHOOD_CHAIN_ID}) to continue.</p> : null}
          </div>

          {plan && transaction ? <div className="grid gap-3 border-t border-border pt-4" aria-live="polite">
            <h3 className="text-sm font-semibold">Position transaction review</h3>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Wallet position balance before request (raw)</dt><dd className="mono">{plan.position.positionBalanceRaw.toString()}</dd></div>
              {plan.kind === "close" ? <div><dt className="text-xs text-muted-foreground">Close size (raw)</dt><dd className="mono">{plan.sizeRaw?.toString()}</dd></div> : null}
              {plan.minAmountOutRaw !== null ? <div><dt className="text-xs text-muted-foreground">Minimum amount out (raw USDG)</dt><dd className="mono">{plan.minAmountOutRaw.toString()}</dd></div> : null}
              <div><dt className="text-xs text-muted-foreground">Native transaction value (wei)</dt><dd className="mono">{transaction.value.toString()}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Estimated gas limit</dt><dd className="mono">{plan.gas.gasLimit.toString()}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Estimated network fee ceiling (wei)</dt><dd className="mono">{plan.gas.totalCostWei.toString()}</dd></div>
              {plan.transactions.length > 1 ? <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Next transaction estimate</dt><dd>Will be refreshed after approval confirmation; re-prepare before signing.</dd></div> : null}
            </dl>
            {plan.kind === "settle" ? <p className="text-xs text-muted-foreground">The venue deducts a position fee from the settlement payout (about 1.4% in the fork rehearsal), so the USDG you receive is below the option&apos;s intrinsic value. The wallet receives the net amount reported by the settlement event.</p> : null}
            <div className="rounded-md border border-border p-3 text-sm">
              <p>{transaction.label}</p>
              <p className="mono mt-1 break-all text-xs text-muted-foreground">to {transaction.to} · value {transaction.value.toString()} wei</p>
              <p className="mono mt-1 break-all text-xs text-muted-foreground">calldata {transaction.data}</p>
              {approvalRequired ? <p className="mt-2 text-xs text-muted-foreground">This setApprovalForAll approval covers every {plan.underlying} option token held by this wallet. It is revocable in your wallet.</p> : null}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
              I reviewed this exact transaction and approve it.
            </label>
            <Button type="button" disabled={!callPutPositionActionEnabled(plan.kind) || !reviewed || !walletClient || working || Boolean(pendingAction)} onClick={() => void sign()}>
              Sign position transaction
            </Button>
            {!callPutPositionActionEnabled(plan.kind) ? <p className="text-xs text-muted-foreground">Signing is disabled in this build for {plan.kind}. Nothing was sent. Manage open positions in CallPut itself.</p> : null}
          </div> : null}

          {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
          {error ? <p role="alert" className="text-sm text-[var(--ember-text)]">{error}</p> : null}

          {latestAction ? <div className="grid gap-2 border-t border-border pt-4" aria-live="polite">
            <h3 className="text-sm font-semibold">Last position action</h3>
            <p className="text-xs text-muted-foreground">{latestAction.kind} · {latestAction.underlying} · token {latestAction.optionTokenId}</p>
            {latestAction.txHash ? <p className="mono break-all text-xs">Transaction {latestAction.txHash}</p> : null}
            {latestAction.requestKey ? <p className="mono break-all text-xs">{latestAction.requestKey}</p> : null}
            {latestAction.settlement ? <p className="text-xs">Settlement: {latestAction.settlement.sizeRaw} raw units · {latestAction.settlement.amountOutRaw} raw USDG · price {latestAction.settlement.settlePriceRaw}</p> : null}
            <Button type="button" variant="outline" onClick={() => void recoverOrRefresh()} disabled={working || !publicClient}>
              {pendingAction ? "Recover transaction" : "Refresh position status"}
            </Button>
            {reconciliation ?? latestAction.reconciliation ? (
              <p role="status" className="text-sm">
                <Chip tone={(reconciliation ?? latestAction.reconciliation)?.fillConfirmed ? "gain" : "neutral"}>
                  {(reconciliation ?? latestAction.reconciliation)?.state}
                </Chip>{" "}
                {(reconciliation ?? latestAction.reconciliation)?.evidence}
              </p>
            ) : null}
          </div> : null}
        </div>
      </details>
    </Panel>
  );
}
