"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { getAddress, parseUnits, type Address, type Hex } from "viem";
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
  type CallPutReconciliation,
  type CallPutSpreadStrategy,
  type CallPutUnderlyingSymbol,
} from "@/lib/venue/callput-robinhood-write";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import { formatUtc } from "../format";
import { Chip, Panel } from "../ui";

/** Off by default. Wallet signing from this panel only exists when the build explicitly enables it. */
export const CALLPUT_LIVE_ORDERS_ENABLED = process.env.NEXT_PUBLIC_CALLPUT_LIVE_ORDERS === "true";
const INTENT_STORAGE_KEY = "optra.callput.robinhood.intents.v1";
const QUOTE_MAX_AGE_MS = 60_000;

function nowMs(): number {
  return Date.now();
}

const INTENT_EVENT = "optra-callput-intents";

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

function parseIntents(raw: string): CallPutOrderIntent[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CallPutOrderIntent[]).filter((item) => item?.version === 1 && item.chainId === CALLPUT_ROBINHOOD_CHAIN_ID) : [];
  } catch {
    return [];
  }
}

function saveIntent(intent: CallPutOrderIntent) {
  const others = parseIntents(readIntentsRaw()).filter((item) => !(item.requestKey && item.requestKey === intent.requestKey));
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

export function CallPutOrderPanel() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const busy = useRef(false);

  const [underlying, setUnderlying] = useState<CallPutUnderlyingSymbol>("AAPL");
  const [strategy, setStrategy] = useState<CallPutSpreadStrategy>("BuyPutSpread");
  const [market, setMarket] = useState<CallPutRobinhoodMarketData | null>(null);
  const [expiry, setExpiry] = useState("");
  const [longId, setLongId] = useState("");
  const [shortId, setShortId] = useState("");
  const [size, setSize] = useState("1");
  const [maxCollateral, setMaxCollateral] = useState("5");
  const [plan, setPlan] = useState<CallPutOpenSpreadPlan | null>(null);
  const [preparedAt, setPreparedAt] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<number | null>(null);
  const intentsRaw = useSyncExternalStore(subscribeIntents, readIntentsRaw, () => "[]");
  const intent = useMemo(() => parseIntents(intentsRaw)[0] ?? null, [intentsRaw]);
  const [reconciliation, setReconciliation] = useState<CallPutReconciliation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

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
    setPlan(null); setDone([]); setReviewed(null); setMessage(""); setError("");
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
      const result = prepareCallPutOpenSpread({
        strategy, underlying, longOptionId: longId as Hex, shortOptionId: shortId as Hex, size, maxCollateralRaw,
        market, wallet: { ...wallet, chainId: chainId ?? wallet.chainId }, nowMs: nowMs(),
      });
      setPlan(result);
      setPreparedAt(nowMs());
    } catch (failure) {
      setError(reason(failure, "The order could not be prepared."));
    } finally {
      setWorking(false);
    }
  }

  async function sign(index: number) {
    if (!plan || !walletClient || !publicClient || !address || busy.current) return;
    const tx = plan.transactions[index];
    if (!tx || done.includes(tx.kind)) return;
    if (tx.kind === "open-spread" && nowMs() - preparedAt > QUOTE_MAX_AGE_MS) {
      setError("This quote is older than 60 seconds. Prepare the order again before signing.");
      return;
    }
    busy.current = true;
    setWorking(true); setError(""); setMessage("Waiting for wallet approval…");
    try {
      const hash = await walletClient.sendTransaction({
        account: getAddress(address), chain: robinhoodMainnet, to: tx.to, data: tx.data, value: tx.value,
      });
      setMessage(`Submitted ${hash}. Waiting for confirmation…`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
      setDone((current) => [...current, tx.kind]);
      setReviewed(null);
      if (tx.kind === "open-spread") {
        const requestKey = extractCallPutRequestKey(receipt, { account: address, isOpen: true });
        const stored: CallPutOrderIntent = { ...plan.intent, txHash: hash, requestKey };
        saveIntent(stored);
        setReconciliation(null);
        setMessage("Request submitted. It is queued with the CallPut keeper and is not a fill yet.");
      } else {
        setMessage("Approval confirmed. Review and sign the next transaction.");
      }
    } catch (failure) {
      setError(reason(failure, "The wallet transaction did not complete."));
      setMessage("");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function refreshStatus() {
    if (!intent?.requestKey || !publicClient) return;
    setWorking(true); setError("");
    try {
      const request = await readCallPutRobinhoodRequest(publicClient, "open", intent.requestKey);
      let balance: bigint | null = null;
      if (request.status === "Executed" && request.optionTokenId !== null) {
        const token = getAddress(CALLPUT_ROBINHOOD_UNDERLYINGS[intent.underlying].optionsToken);
        const balances = await publicClient.readContract({
          address: token, abi: CALLPUT_WRITE_ABIS.optionsToken, functionName: "balanceOfBatch",
          args: [[intent.account as Address], [request.optionTokenId]],
        });
        balance = balances[0] ?? 0n;
      }
      setReconciliation(reconcileCallPutOpen({ intent, request, optionTokenBalanceRaw: balance, nowMs: nowMs() }));
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
      <p className="mb-4 text-sm text-muted-foreground">
        Direct wallet route: your wallet is the account and signs every transaction. CallPut supports two-leg spreads here; single-leg opens, the CallPut Account relay, and automated agent orders are not enabled. Quotes are indicative estimates; the venue keeper sets the executed price.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <label htmlFor="cp-underlying" className="text-sm font-medium">Underlying</label>
          <NativeSelect id="cp-underlying" value={underlying} onChange={(event) => { setUnderlying(event.target.value as CallPutUnderlyingSymbol); setMarket(null); resetPlan(); }}>
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

      {plan ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4" aria-live="polite">
          <h3 className="text-sm font-semibold">Order review</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Estimated collateral committed (USDG)</dt><dd className="mono">{formatUsdgRaw(plan.quote.amountInRaw)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Estimated fee (USDG, included)</dt><dd className="mono">{plan.quote.estimatedOpenFeeUsdg.toFixed(6)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Minimum fill (raw size)</dt><dd className="mono">{plan.minSizeRaw.toString()}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Execution fee (wei, not assumed refundable)</dt><dd className="mono">{plan.transactions.at(-1)?.value.toString()}</dd></div>
          </dl>
          <ol className="grid gap-2">
            {plan.transactions.map((tx, index) => (
              <li key={tx.kind} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{index + 1}. {tx.label}</span>
                  {done.includes(tx.kind) ? <Chip tone="gain">Confirmed</Chip> : <Chip>{index === nextIndex ? "Next" : "Waiting"}</Chip>}
                </div>
                <p className="mono mt-1 break-all text-xs text-muted-foreground">to {tx.to} · value {tx.value.toString()} wei</p>
                {index === nextIndex ? (
                  <div className="mt-2 grid gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={reviewed === index} onChange={(event) => setReviewed(event.target.checked ? index : null)} />
                      I reviewed this exact transaction and approve it.
                    </label>
                    <Button type="button" disabled={!CALLPUT_LIVE_ORDERS_ENABLED || reviewed !== index || !walletClient || working} onClick={() => void sign(index)}>
                      Sign in wallet
                    </Button>
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

      {intent?.requestKey ? (
        <div className="mt-4 grid gap-2 border-t border-border pt-4" aria-live="polite">
          <h3 className="text-sm font-semibold">Last submitted request</h3>
          <p className="mono break-all text-xs">{intent.requestKey}</p>
          <p className="text-xs text-muted-foreground">{intent.strategy} · {intent.underlying} · size {intent.sizeRaw} raw</p>
          <div><Button type="button" variant="outline" onClick={() => void refreshStatus()} disabled={working || !publicClient}>Refresh status</Button></div>
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
