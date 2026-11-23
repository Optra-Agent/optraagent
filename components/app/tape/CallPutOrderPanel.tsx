"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { getAddress, isAddress, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CALLPUT_ROBINHOOD_CHAIN_ID,
  type CallPutRobinhoodMarketData,
  type CallPutRobinhoodOptionMark,
} from "@/lib/venue/callput-robinhood-readonly";
import { readCallPutRobinhoodRequest } from "@/lib/venue/callput-robinhood-requests";
import {
  CALLPUT_ROBINHOOD_UNDERLYINGS,
  CALLPUT_SPREAD_STRATEGIES,
  CALLPUT_WRITE_ABIS,
  CallPutRiskError,
  extractCallPutRequestKey,
  formatUsdgRaw,
  prepareCallPutOpenSpread,
  readCallPutWalletState,
  reconcileCallPutOpen,
  type CallPutOpenSpreadPlan,
  type CallPutOrderIntent,
  type CallPutPreparedTransaction,
  type CallPutReconciliation,
  type CallPutSpreadStrategy,
  type CallPutUnderlyingSymbol,
} from "@/lib/venue/callput-robinhood-write";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import {
  appendCallPutOrderReference,
  createCallPutLedgerId,
  createCallPutOrderIntent,
  listCallPutOrderIntents,
} from "@/lib/venue/callput-order-ledger-client";
import type { CallPutOrderIntentRecord } from "@/lib/venue/callput-order-ledger";
import { findUnresolvedDuplicate } from "@/lib/venue/callput-order-lifecycle";
import { evaluateOrderPreflight, formatEth, formatPreflightAmount, formatUsdg, type OrderPreflight, type PreflightInput } from "@/lib/venue/callput-order-preflight";
import { formatUtc, shortAddress } from "../format";
import { Chip, Panel } from "../ui";

/** Opening a spread from this panel. The Docker image enables it; other builds are preview-only unless they opt in. */
export const CALLPUT_LIVE_ORDERS_ENABLED = process.env.NEXT_PUBLIC_CALLPUT_LIVE_ORDERS === "true";
/**
 * Close and settle signing, each behind its own build flag so one can be switched off without the other. Both paths
 * are exercised against the real CallPut contracts on a mainnet fork (scripts/callput-fork-lifecycle.ts); neither has
 * yet been run against the live keeper, and every transaction still needs the owner's per-transaction wallet confirmation.
 */
export const CALLPUT_CLOSE_ENABLED = process.env.NEXT_PUBLIC_CALLPUT_CLOSE === "true";
export const CALLPUT_SETTLE_ENABLED = process.env.NEXT_PUBLIC_CALLPUT_SETTLE === "true";
export const callPutPositionActionEnabled = (kind: "close" | "settle") => (kind === "close" ? CALLPUT_CLOSE_ENABLED : CALLPUT_SETTLE_ENABLED);
const INTENT_STORAGE_KEY = "optra.callput.robinhood.intents.v1";
const QUOTE_MAX_AGE_MS = 60_000;
const GAS_QUOTE_MAX_AGE_MS = 30_000;

function nowMs(): number {
  return Date.now();
}

const INTENT_EVENT = "optra-callput-intents";

type StoredCallPutOrderIntent = CallPutOrderIntent & {
  clientIntentId?: string;
  serverOrderId?: string;
  requestKeyEventId?: string;
  requestKeySynced?: boolean;
  /** The last reconciled keeper outcome read from the chain; used by the duplicate-request guard. */
  lastState?: string;
  pendingTransaction?: {
    kind: CallPutPreparedTransaction["kind"];
    txHash: Hex;
    status: "submitted" | "confirmed" | "reverted";
    eventId?: string;
    historySynced?: boolean;
  };
};

type CallPutGasQuote = {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint | null;
  legacyGasPrice: bigint | null;
  totalCostWei: bigint;
};

function persistedOpenIntent(intent: CallPutOrderIntent): CallPutOrderIntentRecord {
  return {
    version: intent.version,
    chainId: intent.chainId,
    account: intent.account,
    kind: "open",
    strategy: intent.strategy,
    underlying: intent.underlying,
    underlyingAssetIndex: intent.underlyingAssetIndex,
    longOptionId: intent.longOptionId,
    shortOptionId: intent.shortOptionId,
    expiry: intent.expiry,
    sizeRaw: intent.sizeRaw,
    minSizeRaw: intent.minSizeRaw,
    amountInRaw: intent.amountInRaw,
    createdAtMs: intent.createdAtMs,
  };
}

async function estimateCallPutGas(client: PublicClient, tx: CallPutPreparedTransaction): Promise<CallPutGasQuote> {
  const [gasLimit, fees] = await Promise.all([
    client.estimateGas({ account: tx.from, to: tx.to, data: tx.data, value: tx.value }),
    client.estimateFeesPerGas(),
  ]);
  const eip1559 = fees.maxFeePerGas !== undefined && fees.maxFeePerGas !== null;
  if (eip1559 && !fees.maxPriorityFeePerGas) throw new Error("The RPC returned an incomplete EIP-1559 fee quote; no transaction is offered.");
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

function callPutGasRequest(gas: CallPutGasQuote) {
  return gas.maxPriorityFeePerGas === null
    ? { gas: gas.gasLimit, gasPrice: gas.legacyGasPrice ?? gas.maxFeePerGas }
    : { gas: gas.gasLimit, maxFeePerGas: gas.maxFeePerGas, maxPriorityFeePerGas: gas.maxPriorityFeePerGas };
}

function subscribeIntents(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(INTENT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(INTENT_EVENT, onChange);
  };
}

function readIntentsRaw(): string {
  return window.localStorage.getItem(INTENT_STORAGE_KEY) ?? "[]";
}

function parseIntents(raw: string): StoredCallPutOrderIntent[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredCallPutOrderIntent[]).filter((item) => item?.version === 1 && item.chainId === CALLPUT_ROBINHOOD_CHAIN_ID) : [];
  } catch {
    return [];
  }
}

function mergeRecoveredIntent(existing: StoredCallPutOrderIntent | undefined, recovered: StoredCallPutOrderIntent): StoredCallPutOrderIntent {
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
    pendingTransaction,
  };
}

function saveIntent(intent: StoredCallPutOrderIntent) {
  const identity = (item: StoredCallPutOrderIntent) => [
    item.account.toLowerCase(), item.createdAtMs, item.strategy, item.longOptionId, item.shortOptionId, item.sizeRaw,
  ].join(":");
  const others = parseIntents(readIntentsRaw()).filter((item) => identity(item) !== identity(intent));
  window.localStorage.setItem(INTENT_STORAGE_KEY, JSON.stringify([intent, ...others].slice(0, 50)));
  window.dispatchEvent(new Event(INTENT_EVENT));
}

function reason(error: unknown, fallback: string): string {
  if (error instanceof CallPutRiskError) return error.failed.map((check) => check.detail).join(" ");
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (code === 4001 || (error instanceof Error && /user rejected|rejected the request/i.test(error.message))) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }
  const short = (error as { shortMessage?: unknown } | null)?.shortMessage;
  if (typeof short === "string" && short) return short.replace(/https?:\/\/[^\s)]+/gi, "[endpoint]");
  if (error instanceof Error) return error.message.replace(/https?:\/\/[^\s)]+/gi, "[endpoint]") || fallback;
  return fallback;
}

function legLabel(option: CallPutRobinhoodOptionMark): string {
  return `${option.instrument} · mark ${option.markPriceRaw.toFixed(4)}`;
}

const TERMINAL_STATES = new Set(["cancelled", "executed-balance-confirmed"]);

/** Which wallet is connected, whether it is on Robinhood Mainnet, and a one-click switch when it is not. */
function WalletNetworkStatus() {
  const { address, chainId, isConnected, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);
  const [note, setNote] = useState("");

  // wagmi asks the wallet to switch and, when the wallet does not know the chain (error 4902), adds Robinhood Mainnet from the app config.
  async function switchNetwork() {
    setSwitching(true); setNote("");
    try {
      await switchChainAsync({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
    } catch (failure) {
      setNote(reason(failure, "The network could not be switched."));
    } finally {
      setSwitching(false);
    }
  }

  if (!isConnected || !address) {
    return <p role="status" className="mb-4 text-sm text-muted-foreground" data-testid="wallet-network-status">No wallet connected. Use the wallet button at the top of the page to connect MetaMask or Phantom (EVM). Preparing and reviewing an order needs a connected wallet on Robinhood Mainnet.</p>;
  }
  const onNetwork = chainId === CALLPUT_ROBINHOOD_CHAIN_ID;
  return (
    <div className="mb-4 grid gap-2 rounded-md border border-border p-3 text-sm" data-testid="wallet-network-status" data-network={onNetwork ? "ok" : "wrong"}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={onNetwork ? "gain" : "ember"}>{onNetwork ? `Robinhood Mainnet · ${CALLPUT_ROBINHOOD_CHAIN_ID}` : `Wrong network${chainId ? ` · chain ${chainId}` : ""}`}</Chip>
        <span className="mono text-xs">{connector?.name ?? "Wallet"} · {shortAddress(address)}</span>
      </div>
      {!onNetwork ? (
        <>
          <p role="status" className="text-[var(--ember-text)]">Orders can only be prepared and signed on Robinhood Mainnet (chain {CALLPUT_ROBINHOOD_CHAIN_ID}). Signing is blocked until the wallet is on that network.</p>
          <div><Button type="button" variant="outline" disabled={switching} onClick={() => void switchNetwork()}>{switching ? "Waiting for wallet…" : "Switch to Robinhood Mainnet"}</Button></div>
        </>
      ) : null}
      {note ? <p role="status" className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * `underlying` preselects a market (the market page passes the stock being viewed); `lockUnderlying` pins it there.
 * `initialMarket` and `initialSelection` let the market page hand over the option chain it already loaded and the legs the
 * user clicked. They only prefill the form: nothing is prepared, approved or signed until the owner uses the buttons below,
 * and Prepare still refuses a feed older than the quote freshness limit.
 */
export type CallPutOrderSelection = { strategy: CallPutSpreadStrategy; expiry: string; longId: string; shortId: string };
export function CallPutOrderPanel({ underlying: initialUnderlying = "AAPL", lockUnderlying = false, initialMarket = null, initialSelection }: { underlying?: CallPutUnderlyingSymbol; lockUnderlying?: boolean; initialMarket?: CallPutRobinhoodMarketData | null; initialSelection?: CallPutOrderSelection } = {}) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const busy = useRef(false);

  const [underlying, setUnderlying] = useState<CallPutUnderlyingSymbol>(initialUnderlying);
  const [strategy, setStrategy] = useState<CallPutSpreadStrategy>(initialSelection?.strategy ?? "BuyPutSpread");
  const [market, setMarket] = useState<CallPutRobinhoodMarketData | null>(initialMarket);
  const [expiry, setExpiry] = useState(initialSelection?.expiry ?? "");
  const [longId, setLongId] = useState(initialSelection?.longId ?? "");
  const [shortId, setShortId] = useState(initialSelection?.shortId ?? "");
  const [size, setSize] = useState("1");
  const [maxCollateral, setMaxCollateral] = useState("5");
  const [plan, setPlan] = useState<CallPutOpenSpreadPlan | null>(null);
  const [gasQuote, setGasQuote] = useState<CallPutGasQuote | null>(null);
  const [preflight, setPreflight] = useState<OrderPreflight | null>(null);
  const [preflightGas, setPreflightGas] = useState<PreflightInput["gasCostWei"]>({});
  const [preparedAt, setPreparedAt] = useState(0);
  const [clientIntentId, setClientIntentId] = useState<string | null>(null);
  const [serverOrderId, setServerOrderId] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<number | null>(null);
  const intentsRaw = useSyncExternalStore(subscribeIntents, readIntentsRaw, () => "[]");
  const accountIntents = useMemo(() => parseIntents(intentsRaw)
    .filter((item) => address && item.account.toLowerCase() === address.toLowerCase()), [intentsRaw, address]);
  const intent = accountIntents[0] ?? null;
  const pendingTransactionIntent = accountIntents.find((item) => item.pendingTransaction?.status === "submitted") ?? null;
  const duplicateOf = (current: { clientIntentId: string | null; strategy: string; longOptionId: string; shortOptionId: string; sizeRaw: string; account: string }) => findUnresolvedDuplicate(
    accountIntents.map((item) => ({
      clientIntentId: item.clientIntentId,
      account: item.account, strategy: item.strategy, longOptionId: item.longOptionId, shortOptionId: item.shortOptionId, sizeRaw: item.sizeRaw, createdAtMs: item.createdAtMs,
      submitted: Boolean(item.requestKey || item.txHash || item.pendingTransaction?.kind === "open-spread"),
      terminal: Boolean((item.lastState && TERMINAL_STATES.has(item.lastState)) || (item.pendingTransaction?.kind === "open-spread" && item.pendingTransaction.status === "reverted")),
    })),
    current,
    nowMs(),
  );
  const [reconciliation, setReconciliation] = useState<CallPutReconciliation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!address) return;
    const connectedAddress = address;
    let active = true;
    void listCallPutOrderIntents().then((orders) => {
      if (!active) return;
      const owned = orders
        .filter((order) => order.kind === "open" && isAddress(order.account) && order.account.toLowerCase() === connectedAddress.toLowerCase())
        .sort((a, b) => a.intent.createdAtMs - b.intent.createdAtMs)
        .slice(-50);
      for (const order of owned) {
        if (order.kind !== "open" || order.intent.kind !== "open") continue;
        const events = [...order.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const transaction = events.filter((event) => event.referenceKind === "transaction").at(-1);
        const request = events.filter((event) => event.referenceKind === "request-key" && event.transactionKind === "open-spread").at(-1);
        const recoveredIntent: CallPutOrderIntent = {
          ...order.intent,
          account: getAddress(order.intent.account),
          longOptionId: order.intent.longOptionId as Hex,
          shortOptionId: order.intent.shortOptionId as Hex,
          txHash: null,
          requestKey: null,
        };
        const recovered: StoredCallPutOrderIntent = {
          ...recoveredIntent,
          clientIntentId: order.clientIntentId,
          serverOrderId: order.id,
          txHash: (request?.transactionHash ?? (transaction?.transactionKind === "open-spread" ? transaction.transactionHash : null)) as Hex | null,
          requestKey: (request?.requestKey as Hex | undefined) ?? null,
          pendingTransaction: transaction ? {
            kind: transaction.transactionKind,
            txHash: transaction.transactionHash as Hex,
            status: "submitted",
            eventId: transaction.eventId,
            historySynced: true,
          } : undefined,
          requestKeyEventId: request?.eventId,
          requestKeySynced: Boolean(request),
        };
        const existing = parseIntents(readIntentsRaw()).find((item) =>
          item.clientIntentId === recovered.clientIntentId && item.account.toLowerCase() === connectedAddress.toLowerCase(),
        );
        saveIntent(mergeRecoveredIntent(existing, recovered));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [address]);

  const side = strategy.includes("Call") ? "call" : "put";
  const sideLegs = useMemo(() => {
    if (!market) return [] as CallPutRobinhoodOptionMark[];
    const now = nowMs() / 1000;
    return market.options
      .filter((option) => option.side === side && option.expiryTimestamp - now > 1_800)
      .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.strikePriceRaw - b.strikePriceRaw);
  }, [market, side]);
  const expiries = useMemo(() => [...new Set(sideLegs.map((option) => option.expiryTimestamp))], [sideLegs]);
  const legs = useMemo(() => sideLegs.filter((option) => String(option.expiryTimestamp) === expiry), [sideLegs, expiry]);

  function resetPlan() {
    setPlan(null); setGasQuote(null); setPreflight(null); setPreflightGas({}); setDone([]); setReviewed(null); setMessage(""); setError("");
    setClientIntentId(null); setServerOrderId(null);
  }

  async function loadMarket() {
    resetPlan();
    setWorking(true);
    try {
      const response = await fetch(`/api/venue/callput/market?underlying=${underlying}`, { cache: "no-store" });
      if (!response.ok) throw new Error("CallPut market data is unavailable. No quote is shown.");
      setMarket(await response.json() as CallPutRobinhoodMarketData);
      setLongId(""); setShortId(""); setExpiry("");
    } catch (failure) {
      setMarket(null);
      setError(reason(failure, "CallPut market data could not be loaded."));
    } finally {
      setWorking(false);
    }
  }

  async function prepare() {
    resetPlan();
    if (!market || !address || !publicClient) { setError("Connect a wallet and load market data first."); return; }
    setWorking(true);
    try {
      if (!/^\d+(?:\.\d{1,6})?$/.test(maxCollateral.trim()) || Number(maxCollateral) <= 0) {
        throw new Error("Max collateral must be a positive USDG amount with at most 6 decimals.");
      }
      const maxCollateralRaw = parseUnits(maxCollateral.trim(), 6);
      const wallet = await readCallPutWalletState(publicClient, address);
      // Funding checks are deferred: a short wallet still gets the full review (destinations, amounts, exact shortfalls) and a disabled Sign button.
      const result = prepareCallPutOpenSpread({
        strategy, underlying, longOptionId: longId as Hex, shortOptionId: shortId as Hex, size, maxCollateralRaw,
        market, wallet: { ...wallet, chainId: chainId ?? wallet.chainId }, nowMs: nowMs(), deferFundingChecks: true,
      });
      const firstTransaction = result.transactions[0];
      if (!firstTransaction) throw new Error("No transaction was prepared for this order.");
      // Only the next transaction can be simulated: the open request reverts until the approval is confirmed.
      let estimatedGas: CallPutGasQuote | null = null;
      let estimateFailure: unknown = null;
      try {
        estimatedGas = await estimateCallPutGas(publicClient, firstTransaction);
      } catch (failure) {
        estimateFailure = failure;
      }
      const gasCostWei: PreflightInput["gasCostWei"] = { [firstTransaction.kind]: estimatedGas ? estimatedGas.totalCostWei : null };
      const evaluated = evaluateOrderPreflight({ wallet, connectedChainId: chainId ?? wallet.chainId, amountInRaw: result.quote.amountInRaw, transactions: result.transactions, gasCostWei });
      // A failed simulation on a fully funded wallet is a real refusal, not a funding gap.
      if (!estimatedGas && evaluated.ready) throw estimateFailure ?? new Error("The transaction could not be simulated.");
      setPlan(result);
      setGasQuote(estimatedGas);
      setPreflight(evaluated);
      setPreflightGas(gasCostWei);
      setPreparedAt(nowMs());
      setClientIntentId(createCallPutLedgerId());
      setServerOrderId(null);
    } catch (failure) {
      setError(reason(failure, "The order could not be prepared."));
    } finally {
      setWorking(false);
    }
  }

  async function sign(index: number) {
    if (!plan || !walletClient || !publicClient || !address || busy.current) return;
    if (!preflight?.ready) {
      setError(preflight ? `Funding preflight has not passed. ${preflight.summary}` : "Run the funding preflight by preparing the order first.");
      return;
    }
    if (pendingTransactionIntent) {
      setError("A previously submitted transaction still needs receipt recovery. Do not submit it again.");
      return;
    }
    const walletChainId = (walletClient as unknown as { chain?: { id?: number } }).chain?.id;
    if (chainId !== CALLPUT_ROBINHOOD_CHAIN_ID || (walletChainId !== undefined && walletChainId !== CALLPUT_ROBINHOOD_CHAIN_ID)) {
      setError(`Switch to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`);
      return;
    }
    const tx = plan.transactions[index];
    if (!tx || done.includes(tx.kind)) return;
    if (tx.kind === "open-spread" && duplicateOf({ clientIntentId, account: plan.intent.account, strategy: plan.intent.strategy, longOptionId: plan.intent.longOptionId, shortOptionId: plan.intent.shortOptionId, sizeRaw: plan.intent.sizeRaw })) {
      setError("An identical order for this wallet is still unresolved. Refresh its status below and wait for an outcome before sending another; a second request would open a second position.");
      return;
    }
    if (tx.kind === "open-spread" && nowMs() - preparedAt > QUOTE_MAX_AGE_MS) {
      resetPlan();
      setError("This quote is older than 60 seconds. Prepare the order again before signing.");
      return;
    }
    if (!gasQuote || nowMs() - preparedAt > GAS_QUOTE_MAX_AGE_MS) {
      setPlan(null); setGasQuote(null); setReviewed(null);
      setError("The gas estimate is missing or older than 30 seconds. Prepare again before signing.");
      return;
    }
    busy.current = true;
    setWorking(true); setError(""); setMessage("Saving order intent to server history…");
    try {
      const intentId = clientIntentId ?? createCallPutLedgerId();
      const persistedOrderId = serverOrderId ?? (await createCallPutOrderIntent({
        clientIntentId: intentId,
        intent: persistedOpenIntent(plan.intent),
      })).orderId;
      setClientIntentId(intentId);
      setServerOrderId(persistedOrderId);
      const draft: StoredCallPutOrderIntent = { ...plan.intent, clientIntentId: intentId, serverOrderId: persistedOrderId };
      saveIntent(draft);
      if (tx.kind === "open-spread" && nowMs() - preparedAt > QUOTE_MAX_AGE_MS) {
        resetPlan();
        setError("This quote expired while saving the order. Prepare again before signing.");
        return;
      }
      if (nowMs() - preparedAt > GAS_QUOTE_MAX_AGE_MS) {
        resetPlan();
        setError("The gas estimate expired while saving the order. Prepare again before signing.");
        return;
      }
      if (await publicClient.getChainId() !== CALLPUT_ROBINHOOD_CHAIN_ID) {
        throw new Error(`Switch to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`);
      }
      const currentWalletChain = (walletClient as unknown as { chain?: { id?: number } }).chain?.id;
      if (currentWalletChain !== CALLPUT_ROBINHOOD_CHAIN_ID) {
        throw new Error(`Switch to Robinhood Mainnet (chain ${CALLPUT_ROBINHOOD_CHAIN_ID}) before signing.`);
      }
      const freshWallet = await readCallPutWalletState(publicClient, address);
      const freshPreflight = evaluateOrderPreflight({ wallet: freshWallet, connectedChainId: chainId, amountInRaw: plan.quote.amountInRaw, transactions: plan.transactions, gasCostWei: preflightGas });
      if (!freshPreflight.ready) {
        setPreflight(freshPreflight);
        throw new Error(`Funding preflight failed just before signing. ${freshPreflight.summary}`);
      }
      setMessage("Waiting for wallet approval…");
      const transactionEventId = createCallPutLedgerId();
      const hash = await walletClient.sendTransaction({
        account: getAddress(address), chain: robinhoodMainnet, to: tx.to, data: tx.data, value: tx.value,
        ...callPutGasRequest(gasQuote),
      });
      const pendingTransaction = { kind: tx.kind, txHash: hash, status: "submitted" as const, eventId: transactionEventId, historySynced: false };
      const submittedIntent: StoredCallPutOrderIntent = {
        ...draft,
        txHash: tx.kind === "open-spread" ? hash : plan.intent.txHash,
        pendingTransaction,
      };
      saveIntent(submittedIntent);
      let transactionHistorySynced = false;
      try {
        await appendCallPutOrderReference(persistedOrderId, {
          eventId: transactionEventId,
          referenceKind: "transaction",
          transactionKind: tx.kind,
          transactionHash: hash,
        });
        transactionHistorySynced = true;
      } catch {
        // The broadcast hash remains recoverable locally; retry this reference during receipt recovery.
      }
      const trackedTransaction = { ...pendingTransaction, historySynced: transactionHistorySynced };
      const trackedIntent = { ...submittedIntent, pendingTransaction: trackedTransaction };
      saveIntent(trackedIntent);
      setMessage(`Submitted ${hash}. Waiting for confirmation${transactionHistorySynced ? "…" : "; server history sync is pending."}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        saveIntent({
          ...trackedIntent,
          txHash: tx.kind === "open-spread" ? hash : plan.intent.txHash,
          pendingTransaction: { ...trackedTransaction, status: "reverted" },
        });
        setPlan(null); setGasQuote(null); setReviewed(null); setDone([]);
        throw new Error("The transaction reverted on-chain.");
      }
      setDone((current) => [...current, tx.kind]);
      setReviewed(null);
      if (tx.kind === "open-spread") {
        const requestKey = extractCallPutRequestKey(receipt, { account: address, isOpen: true });
        const requestKeyEventId = trackedIntent.requestKeyEventId ?? createCallPutLedgerId();
        let stored: StoredCallPutOrderIntent = {
          ...trackedIntent,
          txHash: hash,
          requestKey,
          requestKeyEventId,
          requestKeySynced: false,
          pendingTransaction: { ...trackedTransaction, status: "confirmed" },
        };
        saveIntent(stored);
        try {
          await appendCallPutOrderReference(persistedOrderId, {
            eventId: requestKeyEventId,
            referenceKind: "request-key",
            transactionKind: "open-spread",
            transactionHash: hash,
            requestKey,
          });
          stored = { ...stored, requestKeySynced: true };
          saveIntent(stored);
        } catch {
          // The receipt and request key stay in browser storage for a later idempotent sync retry.
        }
        setReconciliation(null);
        setMessage(`Request submitted. It is queued with the CallPut keeper and is not a fill yet.${stored.requestKeySynced ? "" : " Server history sync is pending."}`);
      } else {
        saveIntent({ ...trackedIntent, pendingTransaction: { ...trackedTransaction, status: "confirmed" } });
        setPlan(null); setGasQuote(null); setDone([]);
        setMessage("Approval confirmed. Prepare again to re-read allowance and refresh gas before the open request.");
      }
    } catch (failure) {
      setReviewed(null);
      setError(reason(failure, "The wallet transaction did not complete."));
      setMessage("");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function refreshStatus() {
    if (!intent || !publicClient) return;
    setWorking(true); setError("");
    try {
      let currentIntent = pendingTransactionIntent ?? intent;
      let pendingTransaction = currentIntent.pendingTransaction;
      if (pendingTransaction?.eventId && !pendingTransaction.historySynced && currentIntent.serverOrderId) {
        try {
          await appendCallPutOrderReference(currentIntent.serverOrderId, {
            eventId: pendingTransaction.eventId,
            referenceKind: "transaction",
            transactionKind: pendingTransaction.kind,
            transactionHash: pendingTransaction.txHash,
          });
          pendingTransaction = { ...pendingTransaction, historySynced: true };
          currentIntent = { ...currentIntent, pendingTransaction };
          saveIntent(currentIntent);
        } catch {
          // Continue with chain reconciliation; the stored browser reference can be retried later.
        }
      }
      if (pendingTransaction?.status === "submitted") {
        const receipt = await publicClient.getTransactionReceipt({ hash: pendingTransaction.txHash });
        if (receipt.status !== "success") {
          saveIntent({
            ...currentIntent,
            pendingTransaction: { ...pendingTransaction, status: "reverted" },
          });
          setMessage("The submitted transaction reverted. No CallPut request was created.");
          return;
        }
        if (pendingTransaction.kind === "open-spread") {
          const requestKey = extractCallPutRequestKey(receipt, { account: currentIntent.account, isOpen: true });
          const requestKeyEventId = currentIntent.requestKeyEventId ?? createCallPutLedgerId();
          currentIntent = {
            ...currentIntent,
            txHash: pendingTransaction.txHash,
            requestKey,
            requestKeyEventId,
            requestKeySynced: false,
            pendingTransaction: { ...pendingTransaction, status: "confirmed" },
          };
          saveIntent(currentIntent);
        } else {
          saveIntent({
            ...currentIntent,
            pendingTransaction: { ...pendingTransaction, status: "confirmed" },
          });
          setDone((current) => current.includes(pendingTransaction.kind) ? current : [...current, pendingTransaction.kind]);
          setMessage("Transaction confirmed. Review the updated on-chain wallet state before preparing another order.");
          return;
        }
      }
      const requestKey = currentIntent.requestKey;
      if (!requestKey) return;
      if (currentIntent.serverOrderId && currentIntent.requestKeyEventId && !currentIntent.requestKeySynced && currentIntent.txHash) {
        try {
          await appendCallPutOrderReference(currentIntent.serverOrderId, {
            eventId: currentIntent.requestKeyEventId,
            referenceKind: "request-key",
            transactionKind: "open-spread",
            transactionHash: currentIntent.txHash,
            requestKey,
          });
          currentIntent = { ...currentIntent, requestKeySynced: true };
          saveIntent(currentIntent);
        } catch {
          // Preserve the on-chain request read even when the history service is temporarily unavailable.
        }
      }
      const request = await readCallPutRobinhoodRequest(publicClient, "open", requestKey);
      let balance: bigint | null = null;
      if (request.status === "Executed" && request.optionTokenId !== null) {
        const token = getAddress(CALLPUT_ROBINHOOD_UNDERLYINGS[currentIntent.underlying].optionsToken);
        const balances = await publicClient.readContract({
          address: token, abi: CALLPUT_WRITE_ABIS.optionsToken, functionName: "balanceOfBatch",
          args: [[currentIntent.account as Address], [request.optionTokenId]],
        });
        balance = balances[0] ?? 0n;
      }
      const reconciled = reconcileCallPutOpen({ intent: currentIntent, request, optionTokenBalanceRaw: balance, nowMs: nowMs() });
      saveIntent({ ...currentIntent, lastState: reconciled.state });
      setReconciliation(reconciled);
    } catch (failure) {
      setError(reason(failure, "The request could not be read."));
    } finally {
      setWorking(false);
    }
  }

  const canPrepare = Boolean(market && longId && shortId && longId !== shortId && size.trim() && isConnected && publicClient);
  const nextIndex = plan ? plan.transactions.findIndex((tx) => !done.includes(tx.kind)) : -1;

  return (
    <Panel aria-label="CallPut Live options order" className="mb-5 p-5 sm:p-6">
      <div className="panel-head">
        <div>
          <h2>CallPut options order</h2>
          <p className="coverage-sub">Wallet-signed · Robinhood Mainnet · chain {CALLPUT_ROBINHOOD_CHAIN_ID} · USDG collateral</p>
        </div>
        <Chip tone={CALLPUT_LIVE_ORDERS_ENABLED ? "ember" : "neutral"}>{CALLPUT_LIVE_ORDERS_ENABLED ? "Signing enabled" : "Preview only"}</Chip>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Your wallet signs every transaction. Two-leg spreads only. Marks are indicative; the venue keeper sets the executed price.</p>
      <WalletNetworkStatus />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <label htmlFor="cp-underlying" className="text-sm font-medium">Underlying</label>
          <NativeSelect id="cp-underlying" value={underlying} disabled={lockUnderlying} onChange={(event) => { setUnderlying(event.target.value as CallPutUnderlyingSymbol); setMarket(null); resetPlan(); }}>
            {(Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS) as CallPutUnderlyingSymbol[]).map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="cp-strategy" className="text-sm font-medium">Strategy</label>
          <NativeSelect id="cp-strategy" value={strategy} onChange={(event) => { setStrategy(event.target.value as CallPutSpreadStrategy); setExpiry(""); setLongId(""); setShortId(""); resetPlan(); }}>
            {CALLPUT_SPREAD_STRATEGIES.map((item) => <option key={item} value={item}>{item.replace(/([A-Z])/g, " $1").trim()}</option>)}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="cp-size" className="text-sm font-medium">Size (underlying units)</label>
          <Input id="cp-size" inputMode="decimal" value={size} onChange={(event) => { setSize(event.target.value); resetPlan(); }} autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <div className="mt-3 grid max-w-xs gap-1.5">
        <label htmlFor="cp-max-collateral" className="text-sm font-medium">Max collateral (USDG)</label>
        <Input id="cp-max-collateral" inputMode="decimal" value={maxCollateral} onChange={(event) => { setMaxCollateral(event.target.value); resetPlan(); }} autoComplete="off" spellCheck={false} />
      </div>
      <div className="mt-3"><Button type="button" variant="outline" onClick={loadMarket} disabled={working}>{market ? "Reload market" : "Load market"}</Button></div>

      {market ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <label htmlFor="cp-expiry" className="text-sm font-medium">Expiry</label>
            <NativeSelect id="cp-expiry" value={expiry} onChange={(event) => { setExpiry(event.target.value); setLongId(""); setShortId(""); resetPlan(); }}>
              <option value="">Select an expiry</option>
              {expiries.map((value) => <option key={value} value={String(value)}>{formatUtc(new Date(value * 1000).toISOString())}</option>)}
            </NativeSelect>
          </div>
          {([["Long leg", "cp-long-leg", longId, setLongId], ["Short leg", "cp-short-leg", shortId, setShortId]] as const).map(([label, id, value, set]) => (
            <div key={id} className="grid gap-1.5">
              <label htmlFor={id} className="text-sm font-medium">{label}</label>
              <NativeSelect id={id} value={value} disabled={!expiry} onChange={(event) => { set(event.target.value); resetPlan(); }}>
                <option value="">Select a leg</option>
                {legs.map((option) => <option key={option.optionId} value={option.optionId}>{legLabel(option)}</option>)}
              </NativeSelect>
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-3">Feed timestamp {formatUtc(new Date(market.timestampMs).toISOString())}. Marks are indicative, not executable quotes.</p>
        </div>
      ) : null}

      <div className="mt-4">
        <Button type="button" onClick={prepare} disabled={!canPrepare || working}>Prepare order</Button>
        {!isConnected ? <p role="status" className="mt-2 text-sm text-muted-foreground">Connect a wallet to prepare an order.</p> : null}
      </div>

      {plan && preflight ? (
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4" aria-live="polite">
          <h3 className="text-sm font-semibold">Order review</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Estimated collateral committed (USDG)</dt><dd className="mono break-all">{formatUsdgRaw(plan.quote.amountInRaw)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Estimated fee (USDG, included)</dt><dd className="mono break-all">{plan.quote.estimatedOpenFeeUsdg.toFixed(6)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Minimum fill (raw size)</dt><dd className="mono break-all">{plan.minSizeRaw.toString()}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Execution fee (wei, not assumed refundable)</dt><dd className="mono break-all">{plan.transactions.at(-1)?.value.toString()}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Estimated gas limit</dt><dd className="mono break-all">{gasQuote ? gasQuote.gasLimit.toString() : "not estimated"}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">Estimated network fee ceiling (wei)</dt><dd className="mono break-all">{gasQuote ? gasQuote.totalCostWei.toString() : "not estimated"}</dd></div>
          </dl>
          <section aria-label="Funding preflight" data-preflight={preflight.ready ? "pass" : "fail"} className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Funding preflight</h4>
              <Chip tone={preflight.ready ? "gain" : "ember"}>{preflight.ready ? "Passed" : "Not ready"}</Chip>
            </div>
            <ul className="grid grid-cols-1 gap-2">
              {preflight.lines.map((line) => (
                <li key={line.id} className="min-w-0 rounded-md border border-border p-2" data-preflight-line={line.id} data-ok={line.ok ? "true" : "false"}>
                  <p className="font-medium">{line.label}: {line.ok ? "enough" : "short"}</p>
                  <p className="mono break-all text-xs">needs {formatPreflightAmount(line, line.requiredRaw)} · holds {formatPreflightAmount(line, line.heldRaw)}{line.ok ? "" : ` · short by ${formatPreflightAmount(line, line.shortfallRaw)}`}</p>
                  <p className="text-xs text-muted-foreground">{line.detail}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs" data-testid="allowance-explainer"><strong>USDG allowance:</strong> {preflight.allowance.detail}</p>
            <p className="mono break-all text-xs text-muted-foreground">Allowance spender (CallPut Controller): {preflight.allowance.spender}</p>
            {preflight.gasNote ? <p className="text-xs text-muted-foreground">{preflight.gasNote}</p> : null}
            <p className={preflight.ready ? "text-xs text-muted-foreground" : "text-xs text-[var(--ember-text)]"} data-testid="preflight-summary">{preflight.summary}</p>
            <p className="text-xs text-muted-foreground">OPTRA never transfers, approves or spends anything on its own. Fund the wallet yourself, then re-check.</p>
            <div><Button type="button" variant="outline" onClick={prepare} disabled={!canPrepare || working}>Re-check funding</Button></div>
          </section>
          {plan.transactions.length > 1 ? <p className="text-xs text-muted-foreground">Gas shown is for the approval step. After it confirms, prepare again to re-read allowance and estimate the open request.</p> : null}
          <section aria-label="Before you sign" className="grid gap-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <h4 className="text-sm font-semibold text-foreground">Before you sign</h4>
            <p>Real money: this uses your own USDG plus a native execution fee that is not assumed refundable.</p>
            <p>A transaction hash is not a fill. The position exists only after the venue reports Executed and your wallet holds the option token.</p>
            <p>Quotes are estimates and this interface is unaudited. Close and Settle are separate wallet-signed actions.</p>
          </section>
          <ol className="grid gap-2">
            {plan.transactions.map((tx, index) => (
              <li key={tx.kind} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{index + 1}. {tx.label}</span>
                  {done.includes(tx.kind) ? <Chip tone="gain">Confirmed</Chip> : <Chip>{index === nextIndex ? "Next" : "Waiting"}</Chip>}
                </div>
                <p className="mono mt-1 break-all text-xs text-muted-foreground">to {tx.to} · value {tx.value.toString()} wei{tx.value > 0n ? ` (${formatEth(tx.value)} ETH execution fee)` : ""}</p>
                {tx.kind === "usdg-approval" ? <p className="mono mt-1 break-all text-xs text-muted-foreground">approves exactly {formatUsdg(plan.quote.amountInRaw)} USDG · spender (CallPut Controller) {preflight.allowance.spender}</p> : null}
                {tx.kind === "open-spread" ? <p className="mono mt-1 break-all text-xs text-muted-foreground">pulls up to {formatUsdg(plan.quote.amountInRaw)} USDG from {plan.intent.account} through the Controller</p> : null}
                <p className="mono mt-1 break-all text-xs text-muted-foreground">calldata {tx.data}</p>
                {index === nextIndex ? (
                  <div className="mt-2 grid gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={reviewed === index} onChange={(event) => setReviewed(event.target.checked ? index : null)} />
                      I reviewed this exact transaction and approve it.
                    </label>
                    <Button type="button" disabled={!CALLPUT_LIVE_ORDERS_ENABLED || !preflight.ready || !gasQuote || reviewed !== index || !walletClient || working || Boolean(pendingTransactionIntent)} onClick={() => void sign(index)}>
                      Sign in wallet
                    </Button>
                    {!preflight.ready ? <p className="text-xs text-[var(--ember-text)]">Signing is disabled until the funding preflight passes. Nothing was sent.</p> : null}
                    {preflight.ready && !gasQuote ? <p className="text-xs text-muted-foreground">Signing is disabled until the transaction can be simulated and its gas estimated.</p> : null}
                    {pendingTransactionIntent ? <p className="text-xs text-muted-foreground">A submitted transaction must be recovered before another signature.</p> : null}
                    {!CALLPUT_LIVE_ORDERS_ENABLED ? <p className="text-xs text-muted-foreground">Signing is disabled in this build. Nothing was sent.</p> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {message ? <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--ember-text)]">{error}</p> : null}

      {intent?.requestKey || pendingTransactionIntent || intent?.pendingTransaction ? (
        <div className="mt-4 grid gap-2 border-t border-border pt-4" aria-live="polite">
          <h3 className="text-sm font-semibold">{intent?.requestKey ? "Last submitted request" : pendingTransactionIntent ? "Submitted transaction" : "Last transaction"}</h3>
          {intent?.requestKey ? <p className="mono break-all text-xs">{intent.requestKey}</p> : null}
          {pendingTransactionIntent?.pendingTransaction ? <p className="mono break-all text-xs">Transaction {pendingTransactionIntent.pendingTransaction.txHash}</p> : null}
          {!pendingTransactionIntent && intent?.pendingTransaction ? <p className="mono break-all text-xs">Transaction {intent.pendingTransaction.txHash}</p> : null}
          {(pendingTransactionIntent ?? intent)?.pendingTransaction ? <Chip tone={(pendingTransactionIntent ?? intent)?.pendingTransaction?.status === "reverted" ? "ember" : "neutral"}>{(pendingTransactionIntent ?? intent)?.pendingTransaction?.status}</Chip> : null}
          <p className="text-xs text-muted-foreground">{(pendingTransactionIntent ?? intent)?.strategy} · {(pendingTransactionIntent ?? intent)?.underlying} · size {(pendingTransactionIntent ?? intent)?.sizeRaw} raw</p>
          <div><Button type="button" variant="outline" onClick={() => void refreshStatus()} disabled={working || !publicClient || (!pendingTransactionIntent && !intent?.requestKey)}>{pendingTransactionIntent ? "Recover transaction" : "Refresh status"}</Button></div>
          {reconciliation ? (
            <p role="status" className="text-sm">
              <Chip tone={reconciliation.fillConfirmed ? "gain" : "neutral"}>{reconciliation.state}</Chip> {reconciliation.evidence}
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
