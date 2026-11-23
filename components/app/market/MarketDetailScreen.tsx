"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ApiErrorSchema, MarketListSchema, MarketSnapshotSchema } from "../../../lib/domain/contracts";
import type { MarketAsset, MarketSnapshot } from "../../../lib/domain/contracts";
import { CandleSeriesSchema, CHART_INTERVALS, DEFAULT_CHART_CANDLES } from "../../../lib/market/crius-candles";
import type { CandleSeries, ChartInterval } from "../../../lib/market/crius-candles";
import { buildDemoCandles, callPutUnderlyingFor } from "../../../lib/market/options-demo";
import { CALLPUT_ROBINHOOD_UNDERLYINGS } from "../../../lib/venue/callput-robinhood-write";
import type { CallPutRobinhoodMarketData } from "../../../lib/venue/callput-robinhood-readonly";
import { explorerAddressUrl } from "../../../lib/chain/mainnet-contracts";
import { errorText, formatUtc, shortAddress } from "../format";
import { Chip, Skeleton, StateBlock } from "../ui";
import { CallPutOrderPanel } from "../tape/CallPutOrderPanel";
import { CallPutOrderHistory } from "../tape/CallPutOrderHistory";
import { CallPutRequestTracker } from "../tape/CallPutRequestTracker";
import { CallPutWalletReadiness } from "../tape/CallPutWalletReadiness";
import { AssetLogo } from "./AssetLogo";
import { CallPutChain } from "./CallPutChain";
import { CandleChart } from "./CandleChart";
import { DemoOptions } from "./DemoOptions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "loading" | "ready" | "error";
const cleanName = (name: string) => name.replace(/\s*•\s*Robinhood Token$/i, "");
async function readJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return null; } }
const apiMessage = (value: unknown, fallback: string) => { const parsed = ApiErrorSchema.safeParse(value); return parsed.success ? parsed.data.error.message : fallback; };
const INTERVAL_LABEL: Record<ChartInterval, string> = { "15m": "15 min", "1h": "1 hour", "4h": "4 hour", "1d": "1 day" };

/**
 * One stock token: identity, quote, a candlestick chart and its options. CallPut-listed stocks lead to the real,
 * wallet-signed order panel; every other stock gets a labeled Demo Mode with no transaction path at all.
 */
export function MarketDetailScreen({ symbol }: { symbol: string }) {
  const ticker = symbol.toUpperCase();
  const venueSymbol = callPutUnderlyingFor(ticker);

  const [asset, setAsset] = useState<MarketAsset | null>(null);
  const [assetStatus, setAssetStatus] = useState<Status>("loading");
  const [assetError, setAssetError] = useState("");
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [quoteError, setQuoteError] = useState("");

  const [interval, setIntervalChoice] = useState<ChartInterval>("1h");
  const [series, setSeries] = useState<CandleSeries | null>(null);
  const [chartStatus, setChartStatus] = useState<Status>("loading");
  const [chartError, setChartError] = useState("");
  const [demoAt, setDemoAt] = useState<number | null>(null);
  const [chartReload, setChartReload] = useState(0);

  const [chain, setChain] = useState<CallPutRobinhoodMarketData | null>(null);
  const [chainStatus, setChainStatus] = useState<Status>("loading");
  const [chainError, setChainError] = useState("");
  const [chainLoadedAt, setChainLoadedAt] = useState("");
  const [chainAgeMs, setChainAgeMs] = useState(0);
  const [chainReload, setChainReload] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(apiMessage(body, "Market data is temporarily unavailable.")); return MarketListSchema.parse(body); })
      .then((result) => {
        const found = result.markets.find((market) => market.symbol === ticker) ?? null;
        setAsset(found); setAssetStatus("ready");
      })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setAssetError(errorText(reason, "Market data is temporarily unavailable.")); setAssetStatus("error"); });
    return () => controller.abort();
  }, [ticker, reload]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/markets/${encodeURIComponent(ticker)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(apiMessage(body, "Market quote is unavailable.")); return MarketSnapshotSchema.parse(body); })
      .then((result) => { setSnapshot(result); setQuoteError(""); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setSnapshot(null); setQuoteError(errorText(reason, "Market quote is unavailable.")); });
    return () => controller.abort();
  }, [ticker, reload]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/markets/${encodeURIComponent(ticker)}/candles?interval=${interval}&limit=${DEFAULT_CHART_CANDLES}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = await readJson(response); if (!response.ok) throw new Error(apiMessage(body, "The candle provider is temporarily unavailable.")); return CandleSeriesSchema.parse(body); })
      .then((result) => { setSeries(result); setChartStatus("ready"); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setSeries(null); setChartError(errorText(reason, "The candle provider is temporarily unavailable.")); setChartStatus("error"); });
    return () => controller.abort();
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

  const spotUsd = snapshot ? (Number(snapshot.underlyingBidUsd) + Number(snapshot.underlyingAskUsd)) / 2 : null;
  const candles = series?.candles ?? [];
  const noData = chartStatus === "ready" && candles.length === 0;
  const demoChart = demoAt !== null;
  const demoCandles = demoAt !== null && spotUsd ? buildDemoCandles(ticker, interval, spotUsd, demoAt) : [];
  const first = candles[0]; const last = candles[candles.length - 1];

  if (assetStatus === "loading") return <main className="page-container market-page"><div role="status"><Skeleton lines={5} /><span className="sr-only">Loading {ticker}…</span></div></main>;
  if (assetStatus === "error") return <main className="page-container market-page"><StateBlock kind="error" title="Market unavailable" action={<button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => { setAssetStatus("loading"); setReload((value) => value + 1); }}>Retry</button>}><p>{assetError}</p></StateBlock></main>;
  if (!asset) return <main className="page-container market-page"><StateBlock kind="empty" title={`${ticker} is not listed`} action={<Link className={buttonVariants({ variant: "outline" })} href="/market">Back to Markets</Link>}>No active Robinhood Chain stock token has this symbol.</StateBlock></main>;

  const blocked = snapshot ? snapshot.stale || snapshot.tradingHalt : false;
  return (
    <main className="page-container market-page md">
      <Link href="/market" className="md-back"><ArrowLeft aria-hidden />Markets</Link>
      <header className="md-head">
        <div className="mk-detail-id"><AssetLogo symbol={asset.symbol} size={56} /><div><p className="eyebrow">{asset.symbol}</p><h1>{cleanName(asset.name)}</h1></div></div>
        <div className="md-chips">
          <Chip tone="azure">Tokenized stock · Robinhood Chain</Chip>
          {venueSymbol ? <Chip tone="azure">CallPut options · real Mainnet</Chip> : <Chip tone="ember">Options: demo only</Chip>}
          {snapshot ? <Chip tone={blocked ? "ember" : "azure"}>{snapshot.stale ? "Quote stale" : snapshot.tradingHalt ? "Trading halted" : "Fresh quote"}</Chip> : null}
        </div>
      </header>

      <section className="md-grid" aria-label="Market information">
        <dl className="kv kv-tight">
          <div><dt>Underlying bid / ask</dt><dd className="mono">{snapshot ? `${snapshot.underlyingBidUsd} / ${snapshot.underlyingAskUsd} USD` : quoteError ? "Unavailable" : "Loading…"}</dd></div>
          <div><dt>Token bid / ask</dt><dd className="mono">{snapshot ? `${Number(snapshot.tokenBidUsd).toFixed(4)} / ${Number(snapshot.tokenAskUsd).toFixed(4)} USD` : quoteError ? "Unavailable" : "Loading…"}</dd></div>
          <div><dt>Multiplier</dt><dd className="mono">{Number(asset.currentMultiplier).toFixed(6)}</dd></div>
          <div><dt>Provider time</dt><dd className="mono">{snapshot ? <time dateTime={snapshot.observedAt}>{formatUtc(snapshot.observedAt)}</time> : "—"}</dd></div>
          <div><dt>Token contract</dt><dd className="mono">{asset.tokenAddress ? <a href={explorerAddressUrl(asset.tokenAddress)} target="_blank" rel="noreferrer">{shortAddress(asset.tokenAddress)}<ArrowUpRight aria-hidden /></a> : "n/a"}</dd></div>
          {venueSymbol ? <div><dt>CallPut options token</dt><dd className="mono"><a href={explorerAddressUrl(CALLPUT_ROBINHOOD_UNDERLYINGS[venueSymbol].optionsToken)} target="_blank" rel="noreferrer">{shortAddress(CALLPUT_ROBINHOOD_UNDERLYINGS[venueSymbol].optionsToken)}<ArrowUpRight aria-hidden /></a></dd></div> : null}
        </dl>
        {quoteError ? <p role="alert" className="inline-error market-error">{quoteError}</p> : null}
        {blocked ? <p className="callout callout-ember" role="alert">{snapshot?.tradingHalt ? "Robinhood reports a trading halt." : "The quote is stale."} Treat prices as unreliable until it refreshes.</p> : null}
      </section>

      <section className="md-panel" aria-labelledby="md-chart-title">
        <div className="md-panel-head">
          <h2 id="md-chart-title">{demoChart ? "Demo chart" : "Price chart"}</h2>
          <div className="oc-exp" role="group" aria-label="Chart timeframe">
            {CHART_INTERVALS.map((value) => <button type="button" key={value} aria-pressed={value === interval} onClick={() => pickInterval(value)}>{INTERVAL_LABEL[value]}</button>)}
          </div>
        </div>
        {demoChart ? (
          <>
            <p className="dm-banner" role="note"><Chip tone="ember">Demo data · simulated</Chip><span>These candles are generated for illustration and are not {ticker} market data. They only follow today&apos;s quote as a starting point.</span></p>
            {demoCandles.length > 0 ? <CandleChart candles={demoCandles} interval={interval} demo label={`Simulated ${ticker} candlestick chart, ${INTERVAL_LABEL[interval]} candles. Demo data.`} /> : <p className="mk-why" role="status">A live quote is needed to anchor the demo chart.</p>}
            <div className="mk-actions"><button type="button" className="oc-refresh" onClick={() => setDemoAt(null)}>Back to market data</button></div>
          </>
        ) : (
          <>
            {chartStatus === "loading" ? <div role="status" className="cc-loading"><Skeleton lines={6} /><p className="mk-why">Loading {ticker} candles… daily candles can take several seconds.</p></div> : null}
            {chartStatus === "error" ? (
              <div className="cc-state" role="alert"><p>{chartError}</p><div className="mk-actions"><button type="button" className={buttonVariants({ variant: "outline" })} onClick={retryChart}>Retry</button><button type="button" className="oc-refresh" onClick={() => setDemoAt(Date.now())}>Show demo chart</button></div></div>
            ) : null}
            {noData ? <div className="cc-state" role="status"><p>The provider has no {INTERVAL_LABEL[interval]} candles for {ticker}. Nothing is drawn rather than filled in.</p><div className="mk-actions"><button type="button" className="oc-refresh" onClick={() => setDemoAt(Date.now())}>Show demo chart</button></div></div> : null}
            {series && candles.length > 0 && first && last ? (
              <>
                <CandleChart candles={candles} interval={interval} label={`${ticker} candlestick chart, ${INTERVAL_LABEL[interval]} candles, ${candles.length} candles from ${formatUtc(new Date(first.t).toISOString())} to ${formatUtc(new Date(last.t).toISOString())}`} />
                <p className="mk-source mono">
                  Source Crius · Robinhood Chain candles · {candles.length} of {series.requested} requested {INTERVAL_LABEL[interval]} candles{candles.length < series.requested ? " (all the provider has)" : ""} · {formatUtc(new Date(first.t).toISOString())} to {formatUtc(new Date(last.t).toISOString())} · received <time dateTime={series.receivedAt}>{formatUtc(series.receivedAt)}</time>
                </p>
                <p className="mk-note">Prices are share-equivalent: the token&apos;s on-chain trade price divided by its {series.multiplier.toFixed(6)} multiplier, so they line up with option strikes. Periods with no trades are left empty.{series.multiplierPending ? " A multiplier change is pending, so older candles may use a different share ratio." : ""}</p>
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="md-panel" aria-labelledby="md-options-title" id="options">
        <div className="md-panel-head">
          <h2 id="md-options-title">Options</h2>
          {venueSymbol ? <a className={buttonVariants()} href="#trade">Trade options<ArrowUpRight aria-hidden /></a> : <a className={buttonVariants({ variant: "outline" })} href="#demo-options">Explore in demo mode</a>}
        </div>
        {venueSymbol ? (
          <>
            {chainStatus === "loading" ? <div role="status"><Skeleton lines={5} /><span className="sr-only">Loading CallPut contracts…</span></div> : null}
            {chainStatus === "error" ? <div className="cc-state" role="alert"><p>{chainError}</p><div className="mk-actions"><button type="button" className={buttonVariants({ variant: "outline" })} onClick={retryChain}>Retry</button></div></div> : null}
            {chain ? <CallPutChain symbol={venueSymbol} market={chain} loadedAt={chainLoadedAt} ageMs={chainAgeMs} refreshing={chainStatus === "loading"} onRefresh={retryChain} /> : null}
          </>
        ) : <div id="demo-options"><DemoOptions symbol={ticker} spotUsd={spotUsd} /></div>}
      </section>

      {venueSymbol ? (
        <section id="trade" className="md-trade" aria-label={`Trade ${ticker} options`}>
          <p className="mk-note">Real money. Prepare an order, review the exact transaction, then confirm each transaction in your own wallet. OPTRA never signs for you, and a submitted transaction is not a fill until the CallPut keeper executes it.</p>
          <CallPutWalletReadiness />
          <CallPutOrderPanel underlying={venueSymbol} lockUnderlying />
          <CallPutRequestTracker />
          <CallPutOrderHistory />
          <p className="mk-why">Manage open positions on the <Link href="/tape">Tape</Link>.</p>
        </section>
      ) : null}

      <div className={cn("mk-actions", "md-foot")}>
        <Link className={buttonVariants({ variant: "outline" })} href={`/agents?symbol=${encodeURIComponent(ticker)}#configure`}>Build a Protective Put paper agent<ArrowUpRight aria-hidden /></Link>
      </div>
    </main>
  );
}
