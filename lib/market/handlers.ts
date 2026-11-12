import { ApiErrorSchema, MarketListSchema, MarketSnapshotSchema } from "../domain/contracts";
import { MarketFeedError } from "./robinhood-feed";
import type { createRobinhoodMarketFeed } from "./robinhood-feed";

type MarketFeed = ReturnType<typeof createRobinhoodMarketFeed>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof MarketFeedError) {
    const status = error.code === "DATA_MISSING" ? 404 : 503;
    return json(ApiErrorSchema.parse({ error: { code: error.code, message: error.message, retryable: error.retryable } }), status);
  }
  return json(ApiErrorSchema.parse({
    error: { code: "INTERNAL_ERROR", message: "Market data is temporarily unavailable.", retryable: true },
  }), 500);
}

export function createMarketHandlers(feed: MarketFeed) {
  return {
    async list(): Promise<Response> {
      try {
        const result = MarketListSchema.parse({ markets: await feed.listMarkets() });
        return json(result);
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async detail(symbol: string): Promise<Response> {
      try {
        return json(MarketSnapshotSchema.parse(await feed.getSnapshot(symbol)));
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}
