import { readFileSync } from "node:fs";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";
import { parseEarningsResponse } from "../../lib/market/earnings";

export type MarketCapture = {
  capturedAt: string;
  assets: Array<Record<string, unknown> & { tokenSymbol: string; currentMultiplier: string; deployments: Array<{ chainId: number; contractAddress: string }> }>;
  quotes: Record<string, unknown>;
  candles: Record<string, unknown>;
  earnings: Record<string, unknown>;
  corpActions: unknown[];
};

/** Real captures from 2026-11-21: Robinhood registry rows, Crius 1h candles, corporate actions and Robinhood earnings for NVDA, TSLA and MSFT. */
export const CAPTURE = JSON.parse(readFileSync(new URL("../fixtures/market-capture-20261121.json", import.meta.url), "utf8")) as MarketCapture;

export function historyAt(symbol: string, now: Date) {
  const asset = CAPTURE.assets.find((candidate) => candidate.tokenSymbol === symbol);
  if (!asset) throw new Error(`No capture for ${symbol}`);
  const deployment = asset.deployments.find((candidate) => candidate.chainId === 4663)!;
  return createCriusHistoryFeed({
    fetcher: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: CAPTURE.corpActions });
      return Response.json(CAPTURE.candles[symbol]);
    }) as typeof fetch,
    now: () => now,
    listMarkets: async () => [{ symbol, currentMultiplier: asset.currentMultiplier, tokenAddress: deployment.contractAddress }],
  }).getHistory(symbol);
}

export function earningsFor(symbol: string) {
  return parseEarningsResponse(symbol, CAPTURE.earnings[symbol], CAPTURE.capturedAt);
}
