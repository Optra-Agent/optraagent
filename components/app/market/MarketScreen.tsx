"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, MarketListSchema, MarketSnapshotSchema } from "../../../lib/domain/contracts";
import type { MarketAsset, MarketSnapshot } from "../../../lib/domain/contracts";
import { formatUtc, errorText } from "../format";
import { Chip, PageHeader, Skeleton, StateBlock, Panel } from "../ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
        setListError(errorText(error, "Market data is temporarily unavailable."));
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
        setSnapshotError(errorText(error, "Market quote is unavailable."));
        setSnapshotStatus("error");
      });
    return () => controller.abort();
  }, [selectedSymbol, refreshCount]);

  const blocked = snapshot ? snapshot.stale || snapshot.tradingHalt : false;

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="READ-ONLY · ROBINHOOD CHAIN"
        title="Market data"
        description="Current underlying references and Robinhood token quotes, with provider timestamps and multiplier data. Nothing on this page is an option price."
      />

      {listStatus === "loading" ? <StateBlock kind="loading" title="Loading supported markets…" /> : null}
      {listStatus === "error" ? <StateBlock kind="error" title="Markets unavailable"><p>{listError}</p></StateBlock> : null}
      {listStatus === "ready" && markets.length === 0 ? <StateBlock kind="empty">No active Robinhood Chain markets are available.</StateBlock> : null}

      {markets.length > 0 ? (
        <Panel className="market-panel" aria-label="Current market quote">
          <div className="control-row">
            <div className="field field-inline">
              <Label htmlFor="market-symbol">Underlying symbol</Label>
              <Select value={selectedSymbol} onValueChange={selectMarket}>
                <SelectTrigger id="market-symbol" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {markets.map((market) => <SelectItem key={market.symbol} value={market.symbol}>{market.symbol} · {market.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" type="button" disabled={snapshotStatus === "loading"} onClick={refreshQuote}>
              Refresh quote
            </Button>
          </div>

          {snapshotStatus === "loading" ? <div role="status"><Skeleton lines={3} /><span className="sr-only">Loading {selectedSymbol} quote…</span></div> : null}
          {snapshotStatus === "error" ? <p role="alert" className="inline-error market-error">{snapshotError}</p> : null}
          {snapshot ? (
            <>
              <div className="quote-status">
                <Chip tone={blocked ? "ember" : "azure"}>{snapshot.stale ? "Quote stale" : snapshot.tradingHalt ? "Trading halted" : "Fresh quote"}</Chip>
                <span className="mono">Robinhood quote · {snapshot.pricingMethod}</span>
              </div>
              {snapshot.stale ? <p className="callout callout-ember" role="alert">Paper entries are blocked until a fresh quote is available.</p> : null}
              {snapshot.tradingHalt ? <p className="callout callout-ember" role="alert">Paper entries are blocked while Robinhood reports a trading halt.</p> : null}
              <div className="quote-board">
                <section aria-label="Underlying reference">
                  <h2>Underlying reference</h2>
                  <dl className="quote-pair">
                    <div><dt>Underlying bid</dt><dd className="mono">{snapshot.underlyingBidUsd} USD</dd></div>
                    <div><dt>Underlying ask</dt><dd className="mono">{snapshot.underlyingAskUsd} USD</dd></div>
                  </dl>
                </section>
                <section aria-label="Token quote">
                  <h2>Robinhood token quote</h2>
                  <dl className="quote-pair">
                    <div><dt>Token quote bid</dt><dd className="mono">{snapshot.tokenBidUsd} USD</dd></div>
                    <div><dt>Token quote ask</dt><dd className="mono">{snapshot.tokenAskUsd} USD</dd></div>
                  </dl>
                </section>
              </div>
              <dl className="kv">
                <div><dt>Current multiplier</dt><dd className="mono">{snapshot.currentMultiplier}</dd></div>
                <div><dt>Provider timestamp</dt><dd className="mono"><time dateTime={snapshot.observedAt}>{formatUtc(snapshot.observedAt)}</time></dd></div>
                <div><dt>Received</dt><dd className="mono"><time dateTime={snapshot.receivedAt}>{formatUtc(snapshot.receivedAt)}</time></dd></div>
              </dl>
              <p className="panel-note">Underlying reference prices are not option premiums or fills. The token quote is reported separately; no price is modeled here.</p>
            </>
          ) : null}
        </Panel>
      ) : null}
    </main>
  );
}
