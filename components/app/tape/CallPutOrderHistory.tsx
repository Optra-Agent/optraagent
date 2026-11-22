"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import { robinhoodMainnet } from "@/lib/chain/robinhood";
import { listCallPutOrderIntents, type PersistedCallPutOrder } from "@/lib/venue/callput-order-ledger-client";
import { reconcileCallPutOrderLifecycle, type CallPutLifecycle } from "@/lib/venue/callput-order-lifecycle";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "@/lib/venue/callput-robinhood-readonly";
import { formatUsdgRaw } from "@/lib/venue/callput-robinhood-write";
import { formatUtc, shortHash } from "../format";
import { Chip, Panel } from "../ui";

const POLL_MS = 20_000;
const MAX_ORDERS = 20;
const EXPLORER = robinhoodMainnet.blockExplorers.default.url;

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

function describeIntent(order: PersistedCallPutOrder): string {
  const intent = order.intent;
  if (intent.kind === "open") {
    return `${intent.strategy.replace(/([A-Z])/g, " $1").trim()} · ${intent.underlying} · size ${formatUnits(BigInt(intent.sizeRaw), 18)} · est. collateral ${formatUsdgRaw(BigInt(intent.amountInRaw))} USDG · expiry ${formatUtc(new Date(intent.expiry * 1000).toISOString())}`;
  }
  return `${intent.kind === "close" ? "Close" : "Settle"} position · ${intent.underlying} · option token ${shortHash(intent.optionTokenId, 8, 6)}`;
}

function TxLink({ label, hash }: { label: string; hash: string }) {
  return (
    <a className="mono text-xs underline underline-offset-2" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer noopener">
      {label} {shortHash(hash, 10, 6)}<span className="sr-only"> (opens the explorer in a new tab)</span>
    </a>
  );
}

/**
 * The wallet's own CallPut order history on Robinhood Mainnet: what the owner approved, each transaction reference the
 * browser recorded, and what the chain says now. The ledger rows are client-reported references; the status is read from
 * the chain and refreshed while an order is unresolved. A transaction hash is never shown as proof of a fill.
 */
export function CallPutOrderHistory() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const [orders, setOrders] = useState<PersistedCallPutOrder[]>([]);
  const [lifecycle, setLifecycle] = useState<Record<string, CallPutLifecycle>>({});
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [checking, setChecking] = useState(false);
  const lifecycleRef = useRef(lifecycle);
  const ordersRef = useRef(orders);
  const inFlight = useRef(false);
  useEffect(() => { lifecycleRef.current = lifecycle; ordersRef.current = orders; }, [lifecycle, orders]);

  const reconcile = useCallback(async (list: PersistedCallPutOrder[], force: boolean) => {
    if (!publicClient || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      for (const order of list.slice(0, MAX_ORDERS)) {
        if (!force && lifecycleRef.current[order.id]?.terminal) continue;
        const result = await reconcileCallPutOrderLifecycle({ order, client: publicClient, nowMs: Date.now() });
        setLifecycle((current) => ({ ...current, [order.id]: result }));
      }
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [publicClient]);

  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!isConnected || !address) return;
    let active = true;
    void listCallPutOrderIntents()
      .then(async (all) => {
        if (!active) return;
        const mine = all.filter((order) => order.account.toLowerCase() === address.toLowerCase()).slice(0, MAX_ORDERS);
        setOrders(mine);
        setLifecycle({});
        setLoad({ status: "ready" });
        await reconcile(mine, true);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setOrders([]);
        setLoad({ status: "error", message: failure instanceof Error ? failure.message : "Order history is unavailable." });
      });
    return () => { active = false; };
  }, [isConnected, address, loadKey, reconcile]);

  // Asynchronous reconciliation: keeper outcomes arrive on their own schedule, so unresolved orders are re-read while the tab is visible.
  const unresolved = orders.some((order) => !lifecycle[order.id]?.terminal);
  useEffect(() => {
    if (load.status !== "ready" || !unresolved) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reconcile(ordersRef.current, false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load.status, unresolved, reconcile]);

  if (!isConnected || !address) return null;

  return (
    <Panel aria-label="CallPut order history" className="mb-5 p-5 sm:p-6">
      <div className="panel-head">
        <div>
          <p className="eyebrow">VENUE · OWNER-SIGNED · NOT A PAPER DECISION</p>
          <h2>CallPut order history</h2>
          <p className="coverage-sub">Chain {CALLPUT_ROBINHOOD_CHAIN_ID} · references saved by this browser · status read from the chain</p>
        </div>
        <Button type="button" variant="outline" disabled={load.status === "loading" || checking} onClick={() => { setLoad({ status: "loading" }); setLoadKey((key) => key + 1); }}>Refresh</Button>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        A transaction hash proves a transaction was included, not that an options order filled. An open counts as a position only when the keeper marks the request Executed and your option-token balance covers it. These orders are separate from the Paper agents above.
      </p>
      {load.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">Loading saved orders…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-sm text-[var(--ember-text)]">{load.message} Sign in with your wallet from the top bar to load saved order history.</p> : null}
      {load.status === "ready" && orders.length === 0 ? <p className="empty-line">No CallPut orders have been saved for this wallet.</p> : null}
      {orders.length > 0 ? (
        <ol className="grid gap-3" data-testid="callput-order-history">
          {orders.map((order) => {
            const status = lifecycle[order.id];
            const transactions = [...order.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).filter((event) => event.referenceKind === "transaction");
            const request = order.events.filter((event) => event.referenceKind === "request-key").at(-1);
            return (
              <li key={order.id} className="rounded-md border border-border p-3 text-sm" data-state={status?.state ?? "checking"}>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={status?.tone ?? "neutral"}>{status?.label ?? "Checking chain…"}</Chip>
                  <time className="mono text-xs text-muted-foreground" dateTime={order.createdAt}>{formatUtc(order.createdAt)}</time>
                  {status?.fillConfirmed ? <Chip tone="gain">Balance-confirmed</Chip> : null}
                </div>
                <p className="mt-1">{describeIntent(order)}</p>
                {status ? <p className="mt-1 text-xs text-muted-foreground">{status.evidence} <span className="mono">Read {formatUtc(new Date(status.checkedAtMs).toISOString())}.</span></p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {transactions.map((event) => <TxLink key={event.eventId} label={event.transactionKind.replace(/-/g, " ")} hash={event.transactionHash} />)}
                  {request?.requestKey ? <span className="mono text-xs" title={request.requestKey}>request {shortHash(request.requestKey, 10, 6)}</span> : null}
                  {transactions.length === 0 && !request ? <span className="text-xs text-muted-foreground">No transaction reference recorded.</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </Panel>
  );
}
