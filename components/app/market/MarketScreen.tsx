"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Info, Search } from "lucide-react";
import { ApiErrorSchema, BacktestCoverageSchema, MarketListSchema, MarketSnapshotSchema } from "../../../lib/domain/contracts";
import type { BacktestCoverage, MarketAsset, MarketSnapshot } from "../../../lib/domain/contracts";
import { formatUtc, errorText, shortAddress } from "../format";
import { Chip, PageHeader, Skeleton, StateBlock } from "../ui";
import { AssetLogo } from "./AssetLogo";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type LoadStatus = "loading" | "ready" | "error";
type Filter = "all" | "standard" | "adjusted";
type Sort = "symbol" | "symbol-desc" | "name" | "multiplier";
const PAGE = 30;

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}
function apiMessage(value: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.message : fallback;
}
const cleanName = (name: string) => name.replace(/\s*•\s*Robinhood Token$/i, "");
const adjusted = (market: MarketAsset) => Number(market.currentMultiplier) !== 1 || Boolean(market.pendingMultiplier);

/**
 * The market explorer. It lists every market the API returns and loads a quote and backtest coverage only for the
 * asset you open. The API has no price series, so there are no 1h, 24h or 7d changes and no sparklines here, and the
 * page says so instead of drawing them. An agent can be started only when coverage is ready and the quote is fresh.
 */
export function MarketScreen() {
  const [markets, setMarkets] = useState<MarketAsset[]>([]);
  const [listStatus, setListStatus] = useState<LoadStatus>("loading");
  const [listError, setListError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("symbol");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState("");
  const [reload, setReload] = useState(0);

  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<LoadStatus>("loading");
  const [quoteError, setQuoteError] = useState("");
  const [coverage, setCoverage] = useState<BacktestCoverage | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<LoadStatus>("loading");
  const [coverageError, setCoverageError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiMessage(body, "Market data is temporarily unavailable."));
        return MarketListSchema.parse(body);
      })
      .then((result) => {
        setMarkets(result.markets);
        setLoadedAt(new Date().toISOString());
        setSelected((current) => (result.markets.some((market) => market.symbol === current) ? current : result.markets.find((market) => market.symbol === "AAPL")?.symbol ?? result.markets[0]?.symbol ?? ""));
        setListStatus("ready");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setListError(errorText(reason, "Market data is temporarily unavailable."));
        setListStatus("error");
      });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const symbol = encodeURIComponent(selected);
    void fetch(`/api/markets/${symbol}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiMessage(body, "Market quote is unavailable."));
        return MarketSnapshotSchema.parse(body);
      })
      .then((result) => { setSnapshot(result); setQuoteStatus("ready"); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setQuoteError(errorText(reason, "Market quote is unavailable."));
        setQuoteStatus("error");
      });
    void fetch(`/api/backtests/coverage?symbol=${symbol}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiMessage(body, "Backtest coverage is unavailable."));
        return BacktestCoverageSchema.parse(body);
      })
      .then((result) => { setCoverage(result); setCoverageStatus("ready"); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setCoverageError(errorText(reason, "Backtest coverage is unavailable."));
        setCoverageStatus("error");
      });
    return () => controller.abort();
  }, [selected, refresh]);

  function open(symbol: string) {
    if (symbol === selected) return;
    setSnapshot(null); setCoverage(null); setQuoteError(""); setCoverageError("");
    setQuoteStatus("loading"); setCoverageStatus("loading");
    setSelected(symbol);
    // On narrow screens the details sit below the list, so bring them into view.
    if (window.matchMedia("(max-width: 1040px)").matches) window.setTimeout(() => document.getElementById("market-detail")?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  }
  function refreshQuote() {
    setSnapshot(null); setCoverage(null); setQuoteError(""); setCoverageError("");
    setQuoteStatus("loading"); setCoverageStatus("loading");
    setRefresh((value) => value + 1);
  }

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = markets.filter((market) => {
      if (filter === "standard" && adjusted(market)) return false;
      if (filter === "adjusted" && !adjusted(market)) return false;
      return !needle || market.symbol.toLowerCase().includes(needle) || cleanName(market.name).toLowerCase().includes(needle);
    });
    const by: Record<Sort, (a: MarketAsset, b: MarketAsset) => number> = {
      symbol: (a, b) => a.symbol.localeCompare(b.symbol),
      "symbol-desc": (a, b) => b.symbol.localeCompare(a.symbol),
      name: (a, b) => cleanName(a.name).localeCompare(cleanName(b.name)),
      multiplier: (a, b) => Number(b.currentMultiplier) - Number(a.currentMultiplier) || a.symbol.localeCompare(b.symbol),
    };
    return [...list].sort(by[sort]);
  }, [markets, query, filter, sort]);

  const asset = markets.find((market) => market.symbol === selected);
  const blocked = snapshot ? snapshot.stale || snapshot.tradingHalt : false;
  const canBuild = Boolean(coverage?.ready) && coverageStatus === "ready" && quoteStatus === "ready" && !blocked;
  const buildReason = coverageStatus === "loading" || quoteStatus === "loading" ? "Checking coverage and quote…"
    : coverageStatus === "error" ? "Coverage could not be checked."
    : !coverage?.ready ? "Backtest coverage is not ready for this market."
    : blocked ? "The quote is stale or halted, so paper entries are blocked." : "";
  const adjustedCount = markets.filter(adjusted).length;

  return (
    <main className="page-container market-page">
      <PageHeader
        eyebrow="READ-ONLY · ROBINHOOD CHAIN"
        title="Markets"
        description="Every stock token the app can read, with its multiplier and a live quote when you open one. Prices here are underlying references and token quotes, never option prices."
      />

      {listStatus === "loading" ? <StateBlock kind="loading" title="Loading markets…" /> : null}
      {listStatus === "error" ? <StateBlock kind="error" title="Markets unavailable" action={<button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => { setListStatus("loading"); setReload((value) => value + 1); }}>Retry</button>}><p>{listError}</p></StateBlock> : null}
      {listStatus === "ready" && markets.length === 0 ? <StateBlock kind="empty" title="No markets">No active Robinhood Chain markets are available.</StateBlock> : null}

      {markets.length > 0 ? (
        <>
          <div className="mk-bar">
            <div className="mk-search">
              <Label htmlFor="market-search" className="sr-only">Search markets</Label>
              <Search aria-hidden />
              <Input id="market-search" type="search" placeholder="Search symbol or company" value={query} onChange={(event) => { setQuery(event.target.value); setShown(PAGE); }} />
            </div>
            <div className="mk-filters" role="group" aria-label="Filter markets">
              {([["all", `All ${markets.length}`], ["standard", `Standard ${markets.length - adjustedCount}`], ["adjusted", `Multiplier ≠ 1 ${adjustedCount}`]] as const).map(([value, label]) => (
                <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setShown(PAGE); }}>{label}</button>
              ))}
            </div>
            <div className="mk-sort">
              <Label htmlFor="market-sort">Sort</Label>
              <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
                <SelectTrigger id="market-sort" className="w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="symbol">Symbol A to Z</SelectItem>
                  <SelectItem value="symbol-desc">Symbol Z to A</SelectItem>
                  <SelectItem value="name">Company A to Z</SelectItem>
                  <SelectItem value="multiplier">Multiplier, high to low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mk-source mono">Source robinhood_stock_token_api · list loaded <time dateTime={loadedAt}>{formatUtc(loadedAt)}</time> · {results.length} of {markets.length} shown</p>

          <div className="mk-layout">
            <section className="mk-list" aria-label="Markets">
              {results.length === 0 ? <StateBlock kind="empty" title="No markets match">Try another search or filter.</StateBlock> : (
                <ul>
                  <li className="mk-head" aria-hidden="true"><span>Asset</span><span>Multiplier</span><span>Token</span><span /></li>
                  {results.slice(0, shown).map((market) => (
                    <li key={market.symbol}>
                      <button type="button" className="mk-row" aria-pressed={market.symbol === selected} aria-label={`${market.symbol}, ${cleanName(market.name)}. Open details`} onClick={() => open(market.symbol)}>
                        <span className="mk-asset"><AssetLogo symbol={market.symbol} logoUrl={market.logoUrl} /><span className="mk-asset-text"><b>{market.symbol}</b><span>{cleanName(market.name)}</span></span></span>
                        <span className="mk-mult mono">{Number(market.currentMultiplier).toFixed(4)}{adjusted(market) ? <Chip tone="ember">≠ 1</Chip> : null}</span>
                        <span className="mk-token mono">{market.tokenAddress ? shortAddress(market.tokenAddress) : "n/a"}</span>
                        <ChevronRight aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {results.length > shown ? <button type="button" className={cn(buttonVariants({ variant: "outline" }), "mk-more")} onClick={() => setShown((value) => value + PAGE)}>Show {Math.min(PAGE, results.length - shown)} more</button> : null}
            </section>

            <aside className="mk-detail" id="market-detail" aria-label={asset ? `${asset.symbol} details` : "Market details"}>
              {asset ? (
                <>
                  <div className="mk-detail-head">
                    <div className="mk-detail-id"><AssetLogo symbol={asset.symbol} logoUrl={asset.logoUrl} size={48} /><div><p className="eyebrow">{asset.symbol}</p><h2>{cleanName(asset.name)}</h2></div></div>
                    {quoteStatus === "ready" && snapshot ? <Chip tone={blocked ? "ember" : "azure"}>{snapshot.stale ? "Quote stale" : snapshot.tradingHalt ? "Trading halted" : "Fresh quote"}</Chip> : null}
                  </div>

                  {quoteStatus === "loading" ? <div role="status"><Skeleton lines={3} /><span className="sr-only">Loading {asset.symbol} quote…</span></div> : null}
                  {quoteStatus === "error" ? <p role="alert" className="inline-error market-error">{quoteError}</p> : null}
                  {snapshot ? (
                    <>
                      {snapshot.stale ? <p className="callout callout-ember" role="alert">Paper entries are blocked until a fresh quote is available.</p> : null}
                      {snapshot.tradingHalt ? <p className="callout callout-ember" role="alert">Paper entries are blocked while Robinhood reports a trading halt.</p> : null}
                      <div className="mk-quote">
                        <section aria-label="Underlying reference">
                          <h3>Underlying reference</h3>
                          <dl><div><dt>Bid</dt><dd className="mono">{snapshot.underlyingBidUsd} USD</dd></div><div><dt>Ask</dt><dd className="mono">{snapshot.underlyingAskUsd} USD</dd></div></dl>
                        </section>
                        <section aria-label="Token quote">
                          <h3>Robinhood token quote</h3>
                          <dl><div><dt>Bid</dt><dd className="mono">{Number(snapshot.tokenBidUsd).toFixed(4)} USD</dd></div><div><dt>Ask</dt><dd className="mono">{Number(snapshot.tokenAskUsd).toFixed(4)} USD</dd></div></dl>
                        </section>
                      </div>
                      <dl className="kv kv-tight">
                        <div><dt>Multiplier</dt><dd className="mono">{snapshot.currentMultiplier}</dd></div>
                        <div><dt>Provider time</dt><dd className="mono"><time dateTime={snapshot.observedAt}>{formatUtc(snapshot.observedAt)}</time></dd></div>
                        <div><dt>Source</dt><dd className="mono">Robinhood quote · {snapshot.pricingMethod}</dd></div>
                      </dl>
                    </>
                  ) : null}

                  <div className="mk-cover" data-ready={coverage?.ready ? "1" : "0"}>
                    <p className="mk-cover-title">Backtest coverage</p>
                    {coverageStatus === "loading" ? <p className="mk-cover-line">Checking…</p> : null}
                    {coverageStatus === "error" ? <p className="mk-cover-line" role="alert">{coverageError}</p> : null}
                    {coverage ? (
                      <>
                        <p className="mk-cover-line"><Chip tone={coverage.ready ? "azure" : "ember"}>{coverage.ready ? "Coverage ready" : "Backtest blocked"}</Chip><span className="mono">{coverage.availableSamples} / {coverage.requiredSamples} hourly candles</span></p>
                        <p className="mk-cover-reason">{coverage.reason}</p>
                      </>
                    ) : null}
                  </div>

                  <div className="mk-actions">
                    {canBuild ? (
                      <Link className={buttonVariants()} href={`/agents?symbol=${encodeURIComponent(asset.symbol)}#configure`}>Build a Protective Put on {asset.symbol}<ArrowUpRight aria-hidden /></Link>
                    ) : (
                      <button type="button" className={buttonVariants()} disabled aria-describedby="mk-why">Build a Protective Put on {asset.symbol}</button>
                    )}
                    <button type="button" className={buttonVariants({ variant: "outline" })} disabled={quoteStatus === "loading"} onClick={refreshQuote}>Refresh</button>
                  </div>
                  {!canBuild ? <p className="mk-why" id="mk-why">{buildReason}</p> : <p className="mk-why">Opens the configure form with {asset.symbol} chosen. Wallet sign-in, a backtest and validation still come first.</p>}

                  <p className="mk-note"><Info aria-hidden />1h, 24h and 7-day changes and sparklines are not shown: the API exposes no price series yet. Underlying and token prices are not option premiums or fills.</p>
                </>
              ) : <StateBlock kind="info" title="Select a market">Choose an asset to load its quote and backtest coverage.</StateBlock>}
            </aside>
          </div>
        </>
      ) : null}
    </main>
  );
}
