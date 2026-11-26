import { z } from "zod";
import { MarketCandleSchema, MarketHistoryCoverageSchema } from "../domain/contracts";
import type { MarketCandle, MarketHistoryCoverage } from "../domain/contracts";
import { createCriusClient, criusFailureMessage, type CriusClient } from "./crius-client";
import { createRobinhoodMarketFeed } from "./robinhood-feed";

const DEFAULT_CRIUS_BASE_URL = "https://api.crius.sh/v1/robinhood/token";
const DEFAULT_ROBINHOOD_BASE_URL = "https://api.robinhood.com";
const HOUR_MS = 60 * 60 * 1000;
const DecimalNumber = z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/)]);
const CorporateActionSchema = z.object({
  tokenSymbol: z.string().optional(),
  processDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const CorporateActionResponseSchema = z.object({ corpActions: z.array(CorporateActionSchema) }).passthrough();

type CriusResponse = {
  data: {
    interval: string;
    currency: string;
    t: number[];
    o: Array<number | string>;
    h: Array<number | string>;
    l: Array<number | string>;
    c: Array<number | string>;
    n: number[];
    v: Array<number | string>;
  };
  meta?: { lag_ms?: number; to_ts?: number };
};

export type MarketHistoryResult = {
  candles: MarketCandle[];
  coverage: MarketHistoryCoverage;
  corporateActionDates: string[];
  providerError?: string;
};

export class MarketHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketHistoryError";
  }
}

export type CriusHistoryOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
  criusBaseUrl?: string;
  robinhoodBaseUrl?: string;
  requiredCandles?: number;
  requestedCandles?: number;
  requestTimeoutMs?: number;
  /** Shared Crius client (API key, retry, limit handling); one is created from fetcher and apiKey when omitted. */
  client?: CriusClient;
  apiKey?: string;
  listMarkets?: () => Promise<Array<{ symbol: string; currentMultiplier: string; tokenAddress?: string; pendingMultiplier?: string }>>;
};

function decimal(value: number | string): string | null {
  const parsed = DecimalNumber.safeParse(value);
  if (!parsed.success) return null;
  const number = Number(parsed.data);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number.toFixed(8).replace(/\.?0+$/, "");
}

function safeJsonNumber(value: number | string): number | null {
  const parsed = DecimalNumber.safeParse(value);
  if (!parsed.success) return null;
  const result = Number(parsed.data);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function readArrays(input: unknown): CriusResponse | null {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, unknown>;
  if (!root.data || typeof root.data !== "object") return null;
  const data = root.data as Record<string, unknown>;
  const arrays = [data.t, data.o, data.h, data.l, data.c, data.n, data.v];
  if (!arrays.every(Array.isArray)) return null;
  const count = (data.t as unknown[]).length;
  if (arrays.some((array) => (array as unknown[]).length !== count)) return null;
  if (data.interval !== "1h" || String(data.currency).toLowerCase() !== "usd") return null;
  if (!(data.t as unknown[]).every((value) => typeof value === "number" && Number.isSafeInteger(value))) return null;
  if (!(data.n as unknown[]).every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return null;
  return input as CriusResponse;
}

function actionSymbol(action: z.infer<typeof CorporateActionSchema>): string | undefined {
  if (action.tokenSymbol) return action.tokenSymbol.toUpperCase();
  const details = action.details ?? {};
  for (const item of Object.values(details)) {
    if (item && typeof item === "object" && "underlyingSymbol" in item && typeof item.underlyingSymbol === "string") {
      return item.underlyingSymbol.toUpperCase();
    }
  }
  return undefined;
}

function actionDate(action: z.infer<typeof CorporateActionSchema>): number | null {
  const date = action.processDate;
  if (!date) return null;
  const timestamp = Date.UTC(date.year, date.month - 1, date.day);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function countConsecutive(candles: MarketCandle[]): number {
  let longest = 0;
  let streak = 0;
  let previous = 0;
  for (const candle of candles) {
    const start = new Date(candle.startAt).getTime();
    streak = previous > 0 && start - previous === HOUR_MS ? streak + 1 : 1;
    longest = Math.max(longest, streak);
    previous = start;
  }
  return longest;
}

function calculateCoverage(input: {
  symbol: string;
  tokenAddress: string | null;
  requestedCandles: number;
  candles: MarketCandle[];
  requiredCandles: number;
  multiplierStatus: MarketHistoryCoverage["multiplierStatus"];
  reason?: string;
}): MarketHistoryCoverage {
  const consecutiveHours = countConsecutive(input.candles);
  const dataIsUsable = input.multiplierStatus === "stable_verified" && input.tokenAddress !== null;
  const ready = dataIsUsable && consecutiveHours >= input.requiredCandles;
  const reason = input.reason ?? (ready
    ? `${consecutiveHours} consecutive, nonempty, closed Crius hourly candles are available with no in-window corporate action.`
    : input.multiplierStatus === "action_in_window"
      ? "A Robinhood corporate action falls inside the candle window; historical share normalization cannot be verified."
      : input.multiplierStatus === "unverified"
        ? "The token multiplier or corporate-action history could not be verified for this candle window."
        : `Only ${consecutiveHours} consecutive nonempty hourly candles are available; ${input.requiredCandles} are required.`);
  return MarketHistoryCoverageSchema.parse({
    symbol: input.symbol,
    source: "crius_robinhood_chain_candles",
    tokenAddress: input.tokenAddress,
    requestedCandles: input.requestedCandles,
    availableCandles: input.candles.length,
    requiredCandles: input.requiredCandles,
    consecutiveHours,
    startAt: input.candles[0]?.startAt ?? null,
    endAt: input.candles.at(-1)?.endAt ?? null,
    ready,
    multiplierStatus: input.multiplierStatus,
    fillApplied: false,
    reason,
  });
}

export function createCriusHistoryFeed(options: CriusHistoryOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const criusBaseUrl = (options.criusBaseUrl ?? DEFAULT_CRIUS_BASE_URL).replace(/\/$/, "");
  const robinhoodBaseUrl = (options.robinhoodBaseUrl ?? DEFAULT_ROBINHOOD_BASE_URL).replace(/\/$/, "");
  const requestedCandles = options.requestedCandles ?? 1500;
  const requiredCandles = options.requiredCandles ?? 1440;
  const timeoutMs = options.requestTimeoutMs ?? 8000;
  const listMarkets = options.listMarkets ?? (() => createRobinhoodMarketFeed({ fetcher, now, baseUrl: robinhoodBaseUrl }).listMarkets());
  const client = options.client ?? createCriusClient({ fetcher, now, timeoutMs, ...(options.apiKey ? { apiKey: options.apiKey } : {}) });
  // Overlapping callers share candle requests; corporate-action provenance is cached briefly across symbols.
  const inflight = new Map<string, Promise<MarketHistoryResult>>();
  const corporateActionsUrl = `${robinhoodBaseUrl}/rhj/corporate-actions`;
  const corporateActionsCacheMs = 5 * 60_000;
  let corporateActionsCache: { payload: unknown; expiresAt: number } | null = null;
  let corporateActionsPending: Promise<unknown | null> | null = null;

  async function getJson(url: string): Promise<unknown | null> {
    try {
      const response = await fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok ? await response.json() as unknown : null;
    } catch {
      return null;
    }
  }

  async function getCorporateActions(): Promise<unknown | null> {
    const cached = corporateActionsCache;
    if (cached && cached.expiresAt > now().getTime()) return cached.payload;
    if (corporateActionsPending) return corporateActionsPending;
    const pending = getJson(corporateActionsUrl).then((payload) => {
      if (payload !== null && CorporateActionResponseSchema.safeParse(payload).success) {
        corporateActionsCache = { payload, expiresAt: now().getTime() + corporateActionsCacheMs };
      }
      return payload;
    });
    corporateActionsPending = pending;
    try {
      return await pending;
    } finally {
      if (corporateActionsPending === pending) corporateActionsPending = null;
    }
  }

  return {
    getHistory(symbolInput: string): Promise<MarketHistoryResult> {
      const key = symbolInput.trim().toUpperCase();
      const pending = inflight.get(key);
      if (pending) return pending;
      const started = load(symbolInput);
      inflight.set(key, started);
      const clear = () => { if (inflight.get(key) === started) inflight.delete(key); };
      started.then(clear, clear);
      return started;
    },
  };

  async function load(symbolInput: string): Promise<MarketHistoryResult> {
    {
      const symbol = symbolInput.trim().toUpperCase();
      if (!/^[A-Z0-9.]{1,16}$/.test(symbol)) throw new MarketHistoryError("A supported market symbol is required.");
      const market = (await listMarkets()).find((candidate) => candidate.symbol === symbol);
      if (!market || !market.tokenAddress) {
        return { candles: [], corporateActionDates: [], coverage: calculateCoverage({ symbol, tokenAddress: null, requestedCandles, candles: [], requiredCandles, multiplierStatus: "unverified" }) };
      }
      const candleUrl = new URL(`${criusBaseUrl}/${encodeURIComponent(market.tokenAddress)}/candles`);
      candleUrl.searchParams.set("interval", "1h");
      candleUrl.searchParams.set("limit", String(requestedCandles));
      candleUrl.searchParams.set("fill", "false");
      candleUrl.searchParams.set("continuous", "false");
      candleUrl.searchParams.set("currency", "usd");
      const [candleResult, rawActions] = await Promise.all([
        client.getJson(candleUrl.toString()).then(
          (payload) => ({ payload, error: null as unknown }),
          (error: unknown) => ({ payload: null, error }),
        ),
        getCorporateActions(),
      ]);
      if (candleResult.error) {
        const providerError = criusFailureMessage(candleResult.error);
        return {
          candles: [],
          corporateActionDates: [],
          coverage: calculateCoverage({ symbol, tokenAddress: market.tokenAddress, requestedCandles, candles: [], requiredCandles, multiplierStatus: "unverified", reason: providerError }),
          providerError,
        };
      }
      const rawCandles = candleResult.payload;
      const response = readArrays(rawCandles);
      const actionResponse = CorporateActionResponseSchema.safeParse(rawActions);
      if (!response || !actionResponse.success) {
        const providerError = !response
          ? "Crius candle history returned an invalid response."
          : rawActions === null
            ? "Robinhood corporate-action history is temporarily unavailable."
            : "Robinhood corporate-action history returned an invalid response.";
        return {
          candles: [],
          corporateActionDates: [],
          coverage: calculateCoverage({ symbol, tokenAddress: market.tokenAddress, requestedCandles, candles: [], requiredCandles, multiplierStatus: "unverified", reason: providerError }),
          providerError,
        };
      }

      const multiplier = safeJsonNumber(market.currentMultiplier);
      const arrays = response.data;
      const nowMs = now().getTime();
      const multiplierStatus: MarketHistoryCoverage["multiplierStatus"] = "stable_verified";
      const pendingMultiplier = market.pendingMultiplier;
      const dataBars = arrays.t.map((timestamp, index) => ({ timestamp, index })).filter(({ timestamp }) => timestamp + HOUR_MS <= nowMs);
      const startMs = dataBars[0]?.timestamp ?? Number.MAX_SAFE_INTEGER;
      const relevantActions = actionResponse.data.corpActions.filter((action) => actionSymbol(action) === symbol);
      const hasActionInWindow = relevantActions.some((action) => {
        const date = actionDate(action);
        return date !== null && date >= startMs && date <= nowMs;
      });
      const hasPendingMultiplier = Boolean(pendingMultiplier && pendingMultiplier !== market.currentMultiplier);
      const verifiedMultiplierStatus = hasActionInWindow ? "action_in_window" : hasPendingMultiplier ? "unverified" : multiplier ? multiplierStatus : "unverified";
      const corporateActionDates = relevantActions
        .map(actionDate)
        .filter((date): date is number => date !== null)
        .map((date) => new Date(date).toISOString());
      const receivedAt = now().toISOString();

      const candles: MarketCandle[] = [];
      if (multiplier && Number.isFinite(nowMs)) {
        for (const { timestamp, index } of dataBars) {
          const tradeCount = arrays.n[index]!;
          const tokenOpen = decimal(arrays.o[index]!);
          const tokenHigh = decimal(arrays.h[index]!);
          const tokenLow = decimal(arrays.l[index]!);
          const tokenClose = decimal(arrays.c[index]!);
          const volumeUsd = decimal(arrays.v[index]!);
          if (tradeCount <= 0 || !tokenOpen || !tokenHigh || !tokenLow || !tokenClose || !volumeUsd) continue;
          const values = [Number(tokenOpen), Number(tokenHigh), Number(tokenLow), Number(tokenClose)];
          if (values[1]! < Math.max(values[0]!, values[2]!, values[3]!) || values[2]! > Math.min(values[0]!, values[1]!, values[3]!)) continue;
          const startAt = new Date(timestamp).toISOString();
          const endAt = new Date(timestamp + HOUR_MS).toISOString();
          const parsed = MarketCandleSchema.safeParse({
            symbol,
            source: "crius_robinhood_chain_candles",
            tokenAddress: market.tokenAddress,
            interval: "1h",
            startAt,
            endAt,
            receivedAt,
            tokenOpenUsd: tokenOpen,
            tokenHighUsd: tokenHigh,
            tokenLowUsd: tokenLow,
            tokenCloseUsd: tokenClose,
            shareOpenUsd: decimal(Number(tokenOpen) / multiplier),
            shareHighUsd: decimal(Number(tokenHigh) / multiplier),
            shareLowUsd: decimal(Number(tokenLow) / multiplier),
            shareCloseUsd: decimal(Number(tokenClose) / multiplier),
            multiplierSharesPerToken: market.currentMultiplier,
            multiplierStatus: verifiedMultiplierStatus,
            tradeCount,
            volumeUsd,
            poolCount: Array.isArray((rawCandles as { meta?: { pools?: unknown } }).meta?.pools) ? (rawCandles as { meta: { pools: unknown[] } }).meta.pools.length : 0,
            filled: false,
          });
          if (parsed.success) candles.push(parsed.data);
        }
      }

      return { candles, corporateActionDates, coverage: calculateCoverage({ symbol, tokenAddress: market.tokenAddress, requestedCandles, candles, requiredCandles, multiplierStatus: verifiedMultiplierStatus }) };
    }
  }
}
