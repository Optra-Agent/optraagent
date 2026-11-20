import {
  fetchCallPutRobinhoodMarketData,
  type CallPutRobinhoodMarketData,
} from "../../../../../lib/venue/callput-robinhood-readonly";
import { isCallPutUnderlying } from "../../../../../lib/venue/callput-robinhood-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, read-only slice of the documented CallPut Robinhood market feed for one underlying.
 * The browser cannot read the S3 feed directly (no CORS), so this single upstream fetch is shared via a short CDN cache.
 * Marks are indicative; the keeper recomputes the executable price per request.
 */
export async function GET(request: Request): Promise<Response> {
  const symbol = (new URL(request.url).searchParams.get("underlying") ?? "").trim().toUpperCase();
  if (!isCallPutUnderlying(symbol)) {
    return Response.json({ error: { code: "UNSUPPORTED_UNDERLYING", message: "Unknown CallPut Robinhood underlying." } }, { status: 400 });
  }
  let snapshot: CallPutRobinhoodMarketData;
  try {
    snapshot = await fetchCallPutRobinhoodMarketData();
  } catch {
    return Response.json({ error: { code: "VENUE_FEED_UNAVAILABLE", message: "CallPut market data is unavailable. No quote is shown." } }, { status: 502 });
  }
  const slice: CallPutRobinhoodMarketData = {
    ...snapshot,
    options: snapshot.options.filter((option) => option.underlyingSymbol === symbol && option.marketAvailable),
    spotIndexRaw: symbol in snapshot.spotIndexRaw ? { [symbol]: snapshot.spotIndexRaw[symbol] as number } : {},
    futuresIndexRaw: {},
  };
  return Response.json(slice, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=0" } });
}
