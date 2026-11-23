import { ApiErrorSchema } from "../domain/contracts";
import { CandleFeedError, DEFAULT_CHART_CANDLES, MAX_CHART_CANDLES, isChartInterval } from "./crius-candles";
import type { createCriusCandleFeed } from "./crius-candles";

type CandleFeed = ReturnType<typeof createCriusCandleFeed>;

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failure = (code: "VALIDATION_ERROR" | "DATA_MISSING" | "UPSTREAM_UNAVAILABLE" | "INTERNAL_ERROR", message: string, retryable: boolean, status: number): Response =>
  json(ApiErrorSchema.parse({ error: { code, message, retryable } }), status);

/** GET /api/markets/:symbol/candles?interval=1h&limit=120 — chart candles only, never used by backtests. */
export function createCandleHandler(feed: CandleFeed) {
  return async (symbol: string, params: URLSearchParams): Promise<Response> => {
    const interval = params.get("interval") ?? "1h";
    if (!isChartInterval(interval)) return failure("VALIDATION_ERROR", "Choose a 15m, 1h, 4h or 1d interval.", false, 400);
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? DEFAULT_CHART_CANDLES : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHART_CANDLES) return failure("VALIDATION_ERROR", `Limit must be a whole number from 1 to ${MAX_CHART_CANDLES}.`, false, 400);
    try {
      return json(await feed.getSeries(symbol, interval, limit));
    } catch (error) {
      if (error instanceof CandleFeedError) {
        if (error.code === "UNSUPPORTED") return failure("VALIDATION_ERROR", error.message, false, 400);
        if (error.code === "DATA_MISSING") return failure("DATA_MISSING", error.message, false, 404);
        return failure("UPSTREAM_UNAVAILABLE", error.message, true, 503);
      }
      return failure("INTERNAL_ERROR", "Candles are temporarily unavailable.", true, 500);
    }
  };
}
