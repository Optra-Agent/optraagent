import { getMarketCandleFeed } from "../../../../../lib/market/runtime";
import { createCandleHandler } from "../../../../../lib/market/candle-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const { symbol } = await context.params;
  return createCandleHandler(getMarketCandleFeed())(symbol, new URL(request.url).searchParams);
}
