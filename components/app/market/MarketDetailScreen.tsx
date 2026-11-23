"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ApiErrorSchema, MarketListSchema, MarketSnapshotSchema } from "../../../lib/domain/contracts";
import type { MarketAsset, MarketSnapshot } from "../../../lib/domain/contracts";
import { CandleSeriesSchema, CHART_INTERVALS, DEFAULT_CHART_CANDLES } from "../../../lib/market/crius-candles";
import type { CandleSeries, ChartInterval } from "../../../lib/market/crius-candles";
import { callPutUnderlyingFor } from "../../../lib/market/callput-support";
import { POLL_MS, changeOver, freshness, quietMarket, shouldRefresh, windowStats } from "../../../lib/market/chart-stats";
import { CALLPUT_ROBINHOOD_UNDERLYINGS } from "../../../lib/venue/callput-robinhood-write";
import type { CallPutRobinhoodMarketData, CallPutRobinhoodOptionMark } from "../../../lib/venue/callput-robinhood-readonly";
import { explorerAddressUrl } from "../../../lib/chain/mainnet-contracts";
import { errorText, formatUtc, shortAddress } from "../format";
import { Chip, Skeleton, StateBlock } from "../ui";
import { CallPutOrderPanel } from "../tape/CallPutOrderPanel";
import type { CallPutOrderSelection } from "../tape/CallPutOrderPanel";
import { CallPutOrderHistory } from "../tape/CallPutOrderHistory";
import { CallPutPositionActions } from "../tape/CallPutPositionActions";
import { CallPutRequestTracker } from "../tape/CallPutRequestTracker";
import { CallPutWalletReadiness } from "../tape/CallPutWalletReadiness";
import { AssetLogo } from "./AssetLogo";
import { CallPutChain } from "./CallPutChain";
import type { LegRole } from "./CallPutChain";
import { MarketChart } from "./MarketChart";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "loading" | "ready" | "error";
const cleanName = (name: string) => name.replace(/\s*•\s*Robinhood Token$/i, "");
async function readJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return null; } }
const apiMessage = (value: unknown, fallback: string) => { const parsed = ApiErrorSchema.safeParse(value); return parsed.success ? parsed.data.error.message : fallback; };
const INTERVAL_LABEL: Record<ChartInterval, string> = { "15m": "15 min", "1h": "1 hour", "4h": "4 hour", "1d": "1 day" };
const iso = (ms: number) => new Date(ms).toISOString();
type Legs = { long: CallPutRobinhoodOptionMark | null; short: CallPutRobinhoodOptionMark | null };

/**
 * One stock token: identity, source-labelled quotes, a real candlestick and volume chart, and its options. Stocks CallPut
 * lists get the live option chain feeding the existing wallet-signed order flow. Every other stock shows no options chain
 * and no order controls at all: nothing is modeled or simulated here.
 */
export function MarketDetailScreen({ symbol }: { symbol: string }) {
  const ticker = symbol.toUpperCase();
  const venueSymbol = callPutUnderlyingFor(ticker);

  const [asset, setAsset] = useState<MarketAsset | null>(null);
  const [listed, setListed] = useState<string[]>([]);
  const [assetStatus, setAssetStatus] = useState<Status>("loading");
  const [assetError, setAssetError] = useState("");
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [quoteError, setQuoteError] = useState("");

  const [interval, setIntervalChoice] = useState<ChartInterval>("1h");
  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [chartStatus, setChartStatus] = useState<Status>("loading");
  const [chartError, setChartError] = useState("");
  const [chartReload, setChartReload] = useState(0);
  const [lastOkAt, setLastOkAt] = useState(0);
  const [lastFailedAt, setLastFailedAt] = useState(0);

  const [chain, setChain] = useState<CallPutRobinhoodMarketData | null>(null);
  const [chainStatus, setChainStatus] = useState<Status>("loading");
  const [chainError, setChainError] = useState("");
  const [chainLoadedAt, setChainLoadedAt] = useState("");
  const [chainAgeMs, setChainAgeMs] = useState(0);
  const [chainReload, setChainReload] = useState(0);
  const [legs, setLegs] = useState<Legs>({ long: null, short: null });
  const [role, setRole] = useState<LegRole>("long");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(apiMessage(body, "Market data is temporarily unavailable.")); return MarketListSchema.parse(body); })
      .then((result) => { setAsset(result.markets.find((market) => market.symbol === ticker) ?? null); setListed(result.markets.map((market) => market.symbol)); setAssetStatus("ready"); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setAssetError(errorText(reason, "Market data is temporarily unavailable.")); setAssetStatus("error"); });
    return () => controller.abort();
  }, [ticker, reload]);

  // The quote refreshes on the same cadence as the chart, only while the tab is visible and never overlapping itself.
  useEffect(() => {
    let alive = true; let inflight: AbortController | null = null;
    const run = () => {
      if (!shouldRefresh({ hidden: document.hidden, inflight: inflight !== null })) return;
      const controller = new AbortController(); inflight = controller;
      void fetch(`/api/markets/${encodeURIComponent(ticker)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(apiMessage(body, "Market quote is unavailable.")); return MarketSnapshotSchema.parse(body); })
        .then((result) => { if (alive) { setSnapshot(result); setQuoteError(""); } })
        .catch((reason: unknown) => { if (!alive || controller.signal.aborted) return; setQuoteError(errorText(reason, "Market quote is unavailable.")); })
        .finally(() => { if (inflight === controller) inflight = null; });
    };
    run();
    const timer = window.setInterval(run, 30_000);
    return () => { alive = false; inflight?.abort(); window.clearInterval(timer); };
  }, [ticker, reload]);

  // Real updates only: the series is re-requested while this tab is visible, one request at a time. The server keeps a good
  // series for 60 s, so this never multiplies provider calls. A failed refresh keeps the last real data and says so.
  useEffect(() => {
    let alive = true; let inflight: AbortController | null = null; let okAt = 0;
    const pollMs = POLL_MS[interval];
    const run = async (initial: boolean) => {
      if (!shouldRefresh({ hidden: document.hidden, inflight: inflight !== null })) return;
      const controller = new AbortController(); inflight = controller;
      try {
        const response = await fetch(`/api/markets/${encodeURIComponent(ticker)}/candles?interval=${interval}&limit=${DEFAULT_CHART_CANDLES}`, { cache: "no-store", signal: controller.signal });
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiMessage(body, "The candle provider is temporarily unavailable."));
        const parsed = CandleSeriesSchema.parse(body);
        if (!alive) return;
        okAt = Date.now();
        setSeries(parsed); setChartStatus("ready"); setChartError(""); setLastOkAt(okAt); setLastFailedAt(0);
      } catch (reason) {
        if (!alive || controller.signal.aborted) return;
        if (initial) { setSeries(null); setChartError(errorText(reason, "The candle provider is temporarily unavailable.")); setChartStatus("error"); }
        else setLastFailedAt(Date.now());
      } finally {
        if (inflight === controller) inflight = null;
      }
    };
    void run(true);
    const timer = window.setInterval(() => { void run(false); }, pollMs);
    const onVisible = () => { if (!document.hidden && Date.now() - okAt > pollMs) void run(false); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; inflight?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [ticker, interval, chartReload]);

  useEffect(() => {
    if (!venueSymbol) return;
    const controller = new AbortController();
    void fetch(`/api/venue/callput/market?underlying=${venueSymbol}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(apiMessage(body, "CallPut market data is unavailable. No quote is shown.")); return body as CallPutRobinhoodMarketData; })
      .then((result) => { setChain(result); setChainLoadedAt(new Date().toISOString()); setChainAgeMs(Date.now() - result.timestampMs); setChainStatus("ready"); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setChain(null); setChainError(errorText(reason, "CallPut market data could not be loaded.")); setChainStatus("error"); });
    return () => controller.abort();
  }, [venueSymbol, chainReload]);

  const pickInterval = useCallback((value: ChartInterval) => { if (value === interval) return; setSeries(null); setChartStatus("loading"); setChartError(""); setIntervalChoice(value); }, [interval]);
  const retryChart = () => { setSeries(null); setChartStatus("loading"); setChartError(""); setChartReload((value) => value + 1); };
  const retryChain = () => { setChainStatus("loading"); setChainError(""); setChainReload((value) => value + 1); };

  const pickLeg = useCallback((option: CallPutRobinhoodOptionMark, picked: LegRole) => {
    setLegs((current) => {
      const other = picked === "long" ? current.short : current.long;
      const compatible = other && other.side === option.side && other.expiryTimestamp === option.expiryTimestamp && other.optionId !== option.optionId ? other : null;
      return picked === "long" ? { long: option, short: compatible } : { long: compatible, short: option };
    });
    setRole(picked === "long" ? "short" : "long");
  }, []);

  const selection = useMemo<CallPutOrderSelection | undefined>(() => {
    const anchor = legs.long ?? legs.short;
    if (!anchor) return undefined;
    return { strategy: anchor.side === "call" ? "BuyCallSpread" : "BuyPutSpread", expiry: String(anchor.expiryTimestamp), longId: legs.long?.optionId ?? "", shortId: legs.short?.optionId ?? "" };
  }, [legs]);
  const orderKey = selection ? `${selection.strategy}|${selection.expiry}|${selection.longId}|${selection.shortId}` : "none";

  const candles = useMemo(() => series?.candles ?? [], [series]);
  const noData = chartStatus === "ready" && candles.length === 0;
  const first = candles[0]; const last = candles[candles.length - 1];
  const change = useMemo(() => changeOver(candles), [candles]);
  const stats = useMemo(() => windowStats(candles), [candles]);
  const callPutListed = useMemo(() => Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS).filter((name) => listed.includes(name)), [listed]);

  if (assetStatus === "loading") return <main className="page-container market-page"><div role="status"><Skeleton lines={5} /><span className="sr-only">Loading {ticker}…</span></div></main>;
  if (assetStatus === "error") return <main className="page-container market-page"><StateBlock kind="error" title="Market unavailable" action={<button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => { setAssetStatus("loading"); setReload((value) => value + 1); }}>Retry</button>}><p>{assetError}</p></StateBlock></main>;
  if (!asset) return <main className="page-container market-page"><StateBlock kind="empty" title={`${ticker} is not listed`} action={<Link className={buttonVariants({ variant: "outline" })} href="/market">Back to Markets</Link>}>No active Robinhood Chain stock token has this symbol.</StateBlock></main>;

  const blocked = snapshot ? snapshot.stale || snapshot.tradingHalt : false;
  const timeframeButtons = (
    <div className="oc-exp mc-tf" role="group" aria-label="Chart timeframe">
      {CHART_INTERVALS.map((value) => <button type="button" key={value} aria-pressed={value === interval} onClick={() => pickInterval(value)}>{INTERVAL_LABEL[value]}</button>)}
    </div>
  );
  const lastText = last ? last.c.toFixed(last.c >= 100 ? 2 : 4) : null;
  return (
    <main className="page-container market-page md">
      <Link href="/market" className="md-back"><ArrowLeft aria-hidden />Markets</Link>
      <header className="md-head">
        <div className="mk-detail-id"><AssetLogo symbol={asset.symbol} size={56} /><div><p className="eyebrow">{asset.symbol}</p><h1>{cleanName(asset.name)}</h1></div></div>
        <div className="md-chips">
          <Chip tone="azure">Tokenized stock · Robinhood Chain</Chip>
          {venueSymbol ? <Chip tone="azure">CallPut options · Mainnet</Chip> : <Chip>No CallPut options market</Chip>}
          {snapshot ? <Chip tone={blocked ? "ember" : "azure"}>{snapshot.stale ? "Quote stale" : snapshot.tradingHalt ? "Trading halted" : "Fresh quote"}</Chip> : null}
        </div>
      </header>

      <section className="md-panel md-chartcard" aria-labelledby="md-chart-title">
          <h2 id="md-chart-title" className="sr-only">Price and volume</h2>
          <div className="md-price">
            <div>
              <p className="md-last mono" aria-label="Last traded price">{lastText ? `$${lastText}` : "—"}</p>
              <p className="md-change mono" data-dir={change ? (change.abs >= 0 ? "up" : "down") : "none"}>
                {change ? `${change.abs >= 0 ? "+" : ""}${change.pct.toFixed(2)}% 24h` : last ? "24h change needs a full day of candles" : "No trades in this window"}
              </p>
            </div>
            <DataFreshness lastOkAt={lastOkAt} lastFailedAt={lastFailedAt} pollMs={POLL_MS[interval]} interval={interval} last={last} receivedAt={series?.receivedAt ?? null} />
          </div>
          {chartStatus === "loading" ? <div role="status" className="cc-loading"><Skeleton lines={6} /><p className="mk-why">Loading {ticker} candles… daily candles can take several seconds.</p></div> : null}
          {chartStatus === "error" ? <div className="cc-state" role="alert"><p>{chartError}</p><div className="mk-actions"><button type="button" className={buttonVariants({ variant: "outline" })} onClick={retryChart}>Retry</button></div></div> : null}
          {noData ? (
            <div className="cc-state" role="status">
              <p>No {ticker} token trades were recorded in the provider&apos;s {INTERVAL_LABEL[interval]} window, so there is nothing to chart. OPTRA does not fill gaps or draw estimated candles.</p>
              <div className="mk-actions">{timeframeButtons}</div>
            </div>
          ) : null}
          {series && candles.length > 0 && first && last ? (
            <>
              <MarketChart key={`${ticker}-${interval}`} candles={candles} interval={interval} timeframes={timeframeButtons} label={`${ticker} candlestick and volume chart, ${INTERVAL_LABEL[interval]} candles, ${candles.length} candles from ${formatUtc(iso(first.t))} to ${formatUtc(iso(last.t))}`} />
              {stats ? (
                <dl className="md-stats">
                  <div><dt>24h volume</dt><dd className="mono">${stats.volumeUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd></div>
                  <div><dt>24h trades</dt><dd className="mono">{stats.trades.toLocaleString("en-US")}</dd></div>
                  <div><dt>24h high</dt><dd className="mono">{stats.high.toFixed(stats.high >= 100 ? 2 : 4)}</dd></div>
                  <div><dt>24h low</dt><dd className="mono">{stats.low.toFixed(stats.low >= 100 ? 2 : 4)}</dd></div>
                  <div><dt>Candles loaded</dt><dd className="mono">{candles.length} ({INTERVAL_LABEL[interval]})</dd></div>
                </dl>
              ) : null}
              <p className="mk-source mono">
                Source Crius · Robinhood Chain token trades · {candles.length} candles ({INTERVAL_LABEL[interval]}) with trades · {formatUtc(iso(first.t))} to {formatUtc(iso(last.t))} · provider data as of <time dateTime={series.receivedAt}>{formatUtc(series.receivedAt)}</time>
              </p>
              <p className="md-note">Prices are per share: the token&apos;s on-chain trade price divided by its {series.multiplier.toFixed(6)} multiplier, so they line up with option strikes. Volume is traded USD. Periods with no trades have no candle and are skipped, not filled. The chart refreshes while this tab is open; a forming candle changes only when the provider reports new trades.{series.multiplierPending ? " A multiplier change is pending, so older candles may use a different share ratio." : ""}</p>
            </>
          ) : null}
      </section>

      <section className="md-strip" aria-label="Trade steps">
        {venueSymbol ? (
          <>
            <div className="md-strip-copy">
              <h2>Trade {ticker} options</h2>
              <ol className="md-steps" aria-label="Order steps">
                <li data-done={legs.long && legs.short ? "1" : "0"}><b>1</b><span>Pick a long and a short leg{legs.long || legs.short ? ` (${[legs.long ? "long" : "", legs.short ? "short" : ""].filter(Boolean).join(" + ")} picked)` : ""}</span></li>
                <li data-done="0"><b>2</b><span>Prepare: funding and fee checks</span></li>
                <li data-done="0"><b>3</b><span>Review and confirm in MetaMask</span></li>
                <li data-done="0"><b>4</b><span>Track until Executed</span></li>
              </ol>
            </div>
            <a className={buttonVariants()} href={legs.long && legs.short ? "#trade" : "#options"}>{legs.long && legs.short ? "Go to the order form" : "Choose contracts"}<ArrowUpRight aria-hidden /></a>
          </>
        ) : (
          <>
            <div className="md-strip-copy"><h2>Options</h2><p className="md-note">CallPut has no options market for {ticker}. The chart and token details above are real market data.</p></div>
            <Link className={buttonVariants({ variant: "outline" })} href="/market">Browse stocks with options</Link>
          </>
        )}
      </section>

      <section className="md-grid" aria-label="Market information">
        <dl className="kv kv-tight">
          <div><dt>Underlying equity bid / ask · Robinhood quote</dt><dd className="mono">{snapshot ? `${snapshot.underlyingBidUsd} / ${snapshot.underlyingAskUsd} USD` : quoteError ? "Unavailable" : "Loading…"}</dd></div>
          <div><dt>Token swap bid / ask · Robinhood Chain</dt><dd className="mono">{snapshot ? `${Number(snapshot.tokenBidUsd).toFixed(4)} / ${Number(snapshot.tokenAskUsd).toFixed(4)} USD` : quoteError ? "Unavailable" : "Loading…"}</dd></div>
          <div><dt>Last traded on-chain · chart, per share</dt><dd className="mono">{last ? `${last.c.toFixed(last.c >= 100 ? 2 : 4)} USD · ${formatUtc(iso(last.t))}` : chartStatus === "loading" ? "Loading…" : "No trades in window"}</dd></div>
          <div><dt>Multiplier</dt><dd className="mono">{Number(asset.currentMultiplier).toFixed(6)}</dd></div>
          <div><dt>Quote provider time</dt><dd className="mono">{snapshot ? <time dateTime={snapshot.observedAt}>{formatUtc(snapshot.observedAt)}</time> : "—"}</dd></div>
          <div><dt>Token contract · chain 4663</dt><dd className="mono">{asset.tokenAddress ? <a href={explorerAddressUrl(asset.tokenAddress)} target="_blank" rel="noreferrer">{shortAddress(asset.tokenAddress)}<ArrowUpRight aria-hidden /></a> : "n/a"}</dd></div>
          {venueSymbol ? <div><dt>CallPut options token (ERC-1155) · chain 4663</dt><dd className="mono"><a href={explorerAddressUrl(CALLPUT_ROBINHOOD_UNDERLYINGS[venueSymbol].optionsToken)} target="_blank" rel="noreferrer">{shortAddress(CALLPUT_ROBINHOOD_UNDERLYINGS[venueSymbol].optionsToken)}<ArrowUpRight aria-hidden /></a></dd></div> : null}
        </dl>
        <p className="md-note">Three different prices are shown on purpose: the underlying equity reference, the token&apos;s swap quote and its last on-chain trade. CallPut option marks below are a fourth, separate instrument.</p>
        {quoteError ? <p role="alert" className="inline-error market-error">{quoteError}</p> : null}
        {blocked ? <p className="callout callout-ember" role="alert">{snapshot?.tradingHalt ? "Robinhood reports a trading halt." : "The quote is stale."} Treat prices as unreliable until it refreshes.</p> : null}
      </section>

      <section className="md-panel" aria-labelledby="md-options-title" id="options">
        <div className="md-panel-head">
          <h2 id="md-options-title">Options</h2>
          {venueSymbol ? <a className={buttonVariants()} href="#trade">Trade options<ArrowUpRight aria-hidden /></a> : null}
        </div>
        {venueSymbol ? (
          <>
            {chainStatus === "loading" ? <div role="status"><Skeleton lines={5} /><span className="sr-only">Loading CallPut contracts…</span></div> : null}
            {chainStatus === "error" ? <div className="cc-state" role="alert"><p>{chainError}</p><div className="mk-actions"><button type="button" className={buttonVariants({ variant: "outline" })} onClick={retryChain}>Retry</button></div></div> : null}
            {chain ? (
              <CallPutChain symbol={venueSymbol} market={chain} loadedAt={chainLoadedAt} ageMs={chainAgeMs} refreshing={chainStatus === "loading"} onRefresh={retryChain}
                longId={legs.long?.optionId ?? ""} shortId={legs.short?.optionId ?? ""} role={role} onRole={setRole} onPick={pickLeg} />
            ) : null}
            {legs.long || legs.short ? (
              <div className="oc-legs" role="status" aria-label="Selected legs">
                <span className="mono">Long {legs.long?.instrument ?? "not picked"}</span>
                <span className="mono">Short {legs.short?.instrument ?? "not picked"}</span>
                <a href="#trade">Go to the order form</a>
                <button type="button" className="oc-refresh" onClick={() => { setLegs({ long: null, short: null }); setRole("long"); }}>Clear legs</button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="oc-none" role="status">
            <p><b>CallPut has no live options market for {ticker}.</b> OPTRA only lists option contracts that exist on the venue, so no chain, premium or order is shown here. The stock token&apos;s price, volume and contract details above are real.</p>
            {callPutListed.length > 0 ? (
              <p className="mk-why">Stock tokens with live CallPut options: {callPutListed.map((name, index) => <span key={name}>{index > 0 ? ", " : ""}<Link href={`/market/${name}`}>{name}</Link></span>)}.</p>
            ) : null}
          </div>
        )}
      </section>

      {venueSymbol ? (
        <section id="trade" className="md-trade" aria-label={`Trade ${ticker} options`}>
          <CallPutWalletReadiness />
          <CallPutOrderPanel key={orderKey} underlying={venueSymbol} lockUnderlying initialMarket={chain} {...(selection ? { initialSelection: selection } : {})} />
          <CallPutRequestTracker />
          <CallPutPositionActions />
          <CallPutOrderHistory />
        </section>
      ) : null}

      <div className={cn("mk-actions", "md-foot")}>
        <Link className={buttonVariants({ variant: "outline" })} href={`/agents?symbol=${encodeURIComponent(ticker)}#configure`}>Build a Protective Put paper agent<ArrowUpRight aria-hidden /></Link>
        <p className="mk-why">Paper agents trade on paper with no real money. They are separate from the real orders above.</p>
      </div>
    </main>
  );
}

/**
 * Says how current the chart is, from what actually happened: when the last refresh succeeded, whether the newest one failed,
 * and whether the token simply has not traded lately. It ticks once a second but never makes a request itself.
 */
function DataFreshness({ lastOkAt, lastFailedAt, pollMs, interval, last, receivedAt }: { lastOkAt: number; lastFailedAt: number; pollMs: number; interval: ChartInterval; last: { t: number } | undefined; receivedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    timer.current = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => window.clearInterval(timer.current);
  }, []);
  if (!lastOkAt) return <div className="md-fresh" aria-live="polite"><Chip>Loading</Chip></div>;
  const state = freshness({ lastOkAt, lastFailedAt, now, pollMs });
  const age = Math.max(0, Math.round((now - lastOkAt) / 1000));
  const quiet = quietMarket(last, interval, now);
  return (
    <div className="md-fresh" aria-live="polite">
      <Chip tone={state === "live" ? "azure" : "ember"}>{state === "live" ? "Live" : state === "delayed" ? "Delayed" : "Stale"}</Chip>
      <span className="mono">
        {state === "live" ? `Refreshed ${age}s ago` : state === "delayed" ? (lastFailedAt > lastOkAt ? `Refresh failed · showing data from ${age}s ago` : `Last refresh ${age}s ago`) : `No successful refresh for ${Math.round(age / 60)} min`}
        {receivedAt ? ` · provider data as of ${formatUtc(receivedAt)}` : ""}
      </span>
      {quiet && last ? <span className="mono md-quiet">No trades since {formatUtc(iso(last.t))}</span> : null}
    </div>
  );
}
