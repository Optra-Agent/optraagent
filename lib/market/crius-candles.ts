/**
 * Display candles for the market chart, read from the same Robinhood Chain candle provider the backtests use, at the
 * provider's own native intervals. Nothing here is resampled, filled, smoothed or invented: a bucket without trades is
 * simply absent. Prices are share-equivalent (token price divided by the token's current multiplier) so they are
 * comparable with option strikes. This feed is for charts only; backtests keep using lib/market/crius-history.ts.
 */
import { z } from "zod";
import type { createRobinhoodMarketFeed } from "./robinhood-feed";

export const CHART_INTERVALS = ["15m", "1h", "4h", "1d"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];
export const CHART_INTERVAL_MS: Record<ChartInterval, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
export const DEFAULT_CHART_CANDLES = 120;
export const MAX_CHART_CANDLES = 240;

export const ChartCandleSchema = z.object({
  /** Bucket start, epoch milliseconds. */
  t: z.number().int().positive(),
  o: z.number().positive(), h: z.number().positive(), l: z.number().positive(), c: z.number().positive(),
  /** Traded volume in USD and trade count for the bucket. */
  v: z.number().nonnegative(), n: z.number().int().positive(),
  /** True while the bucket is still forming. */
  forming: z.boolean(),
}).strict();

export const CandleSeriesSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  interval: z.enum(CHART_INTERVALS),
  source: z.literal("crius_robinhood_chain_candles"),
  tokenAddress: z.string(),
  priceBasis: z.literal("share_equivalent"),
  multiplier: z.number().positive(),
  /** True when Robinhood reports a pending multiplier change: older candles may use a different share ratio. */
  multiplierPending: z.boolean(),
  requested: z.number().int().positive(),
  receivedAt: z.string(),
  candles: z.array(ChartCandleSchema),
}).strict();
export type ChartCandle = z.infer<typeof ChartCandleSchema>;
export type CandleSeries = z.infer<typeof CandleSeriesSchema>;

export type CandleFeedErrorCode = "UNSUPPORTED" | "DATA_MISSING" | "UPSTREAM_UNAVAILABLE";
export class CandleFeedError extends Error {
  constructor(readonly code: CandleFeedErrorCode, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "CandleFeedError";
  }
}

const DEFAULT_CRIUS_BASE_URL = "https://api.crius.sh/v1/robinhood/token";
type MarketFeed = ReturnType<typeof createRobinhoodMarketFeed>;
type RawNumbers = Array<number | string>;
type CriusPayload = { data?: { interval?: unknown; t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; n?: unknown; v?: unknown } };

const positive = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function isChartInterval(value: string): value is ChartInterval {
  return (CHART_INTERVALS as readonly string[]).includes(value);
}

/** Pure parser, exported for tests: provider arrays in, validated share-equivalent candles out. Malformed rows are dropped, never repaired. */
export function parseCriusCandles(payload: unknown, interval: ChartInterval, multiplier: number, nowMs: number): ChartCandle[] | null {
  const data = (payload as CriusPayload | null)?.data;
  if (!data || data.interval !== interval) return null;
  const { t, o, h, l, c, n, v } = data as Record<string, unknown>;
  const arrays = [t, o, h, l, c, n, v];
  if (!arrays.every(Array.isArray)) return null;
  const count = (t as unknown[]).length;
  if (count === 0 || arrays.some((array) => (array as unknown[]).length !== count)) return null;
  const width = CHART_INTERVAL_MS[interval];
  const out: ChartCandle[] = [];
  let previous = 0;
  for (let index = 0; index < count; index += 1) {
    const start = (t as unknown[])[index];
    const trades = (n as unknown[])[index];
    if (typeof start !== "number" || !Number.isSafeInteger(start) || start <= previous) continue;
    if (typeof trades !== "number" || !Number.isSafeInteger(trades) || trades <= 0) continue;
    const open = positive((o as RawNumbers)[index]); const high = positive((h as RawNumbers)[index]);
    const low = positive((l as RawNumbers)[index]); const close = positive((c as RawNumbers)[index]);
    const volume = Number((v as RawNumbers)[index]);
    if (open === null || high === null || low === null || close === null || !Number.isFinite(volume) || volume < 0) continue;
    if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) continue;
    const candle = { t: start, o: open / multiplier, h: high / multiplier, l: low / multiplier, c: close / multiplier, v: volume, n: trades, forming: start + width > nowMs };
    const parsed = ChartCandleSchema.safeParse(candle);
    if (!parsed.success) continue;
    out.push(parsed.data);
    previous = start;
  }
  return out;
}

export type CriusCandleFeedOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
  criusBaseUrl?: string;
  requestTimeoutMs?: number;
  listMarkets: MarketFeed["listMarkets"];
};

export function createCriusCandleFeed(options: CriusCandleFeedOptions) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const base = (options.criusBaseUrl ?? DEFAULT_CRIUS_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.requestTimeoutMs ?? 8000;

  return {
    async getSeries(symbolInput: string, interval: ChartInterval, limit = DEFAULT_CHART_CANDLES): Promise<CandleSeries> {
      const symbol = symbolInput.trim().toUpperCase();
      if (!/^[A-Z0-9.]{1,16}$/.test(symbol)) throw new CandleFeedError("UNSUPPORTED", "Choose a supported Robinhood Chain market.", false);
      const requested = Math.min(Math.max(Math.trunc(limit), 1), MAX_CHART_CANDLES);
      const market = (await options.listMarkets()).find((candidate) => candidate.symbol === symbol);
      if (!market?.tokenAddress) throw new CandleFeedError("DATA_MISSING", `No active Robinhood Chain market is available for ${symbol}.`, false);
      const multiplier = positive(market.currentMultiplier);
      if (multiplier === null) throw new CandleFeedError("UPSTREAM_UNAVAILABLE", "Robinhood returned an invalid token multiplier.", true);

      const url = new URL(`${base}/${encodeURIComponent(market.tokenAddress)}/candles`);
      url.searchParams.set("interval", interval);
      url.searchParams.set("limit", String(requested));
      url.searchParams.set("fill", "false");
      url.searchParams.set("continuous", "false");
      url.searchParams.set("currency", "usd");
      let payload: unknown;
      try {
        const response = await fetcher(url.toString(), { method: "GET", headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error("status");
        payload = await response.json();
      } catch {
        throw new CandleFeedError("UPSTREAM_UNAVAILABLE", "The candle provider is temporarily unavailable.", true);
      }
      const receivedAt = now();
      const candles = parseCriusCandles(payload, interval, multiplier, receivedAt.getTime());
      if (candles === null) throw new CandleFeedError("UPSTREAM_UNAVAILABLE", "The candle provider returned data this app cannot verify.", true);
      return CandleSeriesSchema.parse({
        symbol, interval, source: "crius_robinhood_chain_candles", tokenAddress: market.tokenAddress, priceBasis: "share_equivalent",
        multiplier, multiplierPending: Boolean(market.pendingMultiplier && market.pendingMultiplier !== market.currentMultiplier),
        requested, receivedAt: receivedAt.toISOString(), candles,
      });
    },
  };
}
