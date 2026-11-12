"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, MarketListSchema, MarketSnapshotSchema } from "../../../lib/domain/contracts";
import type { MarketAsset, MarketSnapshot } from "../../../lib/domain/contracts";

type LoadStatus = "loading" | "ready" | "error";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiMessage(value: unknown): string {
  const parsed = ApiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data.error.message : "Market data is temporarily unavailable. Try again.";
}

export function MarketScreen() {
  const [markets, setMarkets] = useState<MarketAsset[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [listStatus, setListStatus] = useState<LoadStatus>("loading");
  const [listError, setListError] = useState("");
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<LoadStatus>("loading");
  const [snapshotError, setSnapshotError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  function selectMarket(symbol: string) {
    setSnapshot(null);
    setSnapshotStatus("loading");
    setSnapshotError("");
    setSelectedSymbol(symbol);
  }

  function refreshQuote() {
    setSnapshot(null);
    setSnapshotStatus("loading");
    setSnapshotError("");
    setRefreshCount((count) => count + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/markets", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiMessage(body));
        return MarketListSchema.parse(body);
      })
      .then((result) => {
        setMarkets(result.markets);
        setSelectedSymbol((current) => {
          if (result.markets.some((market) => market.symbol === current)) return current;
          return result.markets.find((market) => market.symbol === "AAPL")?.symbol ?? result.markets[0]?.symbol ?? "";
        });
        setListStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListError(error instanceof Error ? error.message : "Market data is temporarily unavailable.");
        setListStatus("error");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedSymbol) return;
    const controller = new AbortController();
    void fetch(`/api/markets/${encodeURIComponent(selectedSymbol)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (!response.ok) throw new Error(apiMessage(body));
        return MarketSnapshotSchema.parse(body);
      })
      .then((result) => {
        setSnapshot(result);
        setSnapshotStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSnapshotError(error instanceof Error ? error.message : "Market quote is unavailable.");
        setSnapshotStatus("error");
      });
    return () => controller.abort();
  }, [selectedSymbol, refreshCount]);

  return (
    <main className="page-container">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">READ-ONLY · ROBINHOOD CHAIN</p>
          <h1>Market data</h1>
          <p className="page-description">Current underlying references and Robinhood token quotes, with provider timestamps and multiplier data.</p>
        </div>
      </div>

      {listStatus === "loading" ? <p role="status">Loading supported markets…</p> : null}
      {listStatus === "error" ? <section className="state-panel" role="alert">{listError}</section> : null}
      {listStatus === "ready" && markets.length === 0 ? <section className="state-panel">No active Robinhood Chain markets are available.</section> : null}

      {markets.length > 0 ? (
        <section className="state-panel market-panel" aria-label="Current market quote">
          <div className="market-controls">
            <label htmlFor="market-symbol">Underlying symbol</label>
            <select id="market-symbol" value={selectedSymbol} onChange={(event) => selectMarket(event.target.value)}>
              {markets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol} · {market.name}</option>)}
            </select>
            <button className="button button-secondary" type="button" disabled={snapshotStatus === "loading"} onClick={refreshQuote}>
              Refresh quote
            </button>
          </div>

          {snapshotStatus === "loading" ? <p role="status">Loading {selectedSymbol} quote…</p> : null}
          {snapshotStatus === "error" ? <p role="alert" className="inline-error market-error">{snapshotError}</p> : null}
          {snapshot ? (
            <>
              <div className="market-status-row">
                <strong>{snapshot.stale ? "Quote stale" : snapshot.tradingHalt ? "Trading halted" : "Fresh quote"}</strong>
                <span>Robinhood quote · {snapshot.pricingMethod}</span>
              </div>
              {snapshot.stale ? <p role="alert">Paper entries are blocked until a fresh quote is available.</p> : null}
              {snapshot.tradingHalt ? <p role="alert">Paper entries are blocked while Robinhood reports a trading halt.</p> : null}
              <dl className="market-grid">
                <div><dt>Underlying bid</dt><dd>{snapshot.underlyingBidUsd} USD</dd></div>
                <div><dt>Underlying ask</dt><dd>{snapshot.underlyingAskUsd} USD</dd></div>
                <div><dt>Token quote bid</dt><dd>{snapshot.tokenBidUsd} USD</dd></div>
                <div><dt>Token quote ask</dt><dd>{snapshot.tokenAskUsd} USD</dd></div>
                <div><dt>Current multiplier</dt><dd>{snapshot.currentMultiplier}</dd></div>
                <div><dt>Provider timestamp</dt><dd><time dateTime={snapshot.observedAt}>{snapshot.observedAt}</time></dd></div>
              </dl>
              <p className="market-note">Underlying reference prices are not option premiums or fills. The token quote is reported separately; no price is modeled here.</p>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
