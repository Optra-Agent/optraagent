import { createMarketHandlers } from "./handlers";
import { createCriusCandleFeed } from "./crius-candles";
import { createCriusClient } from "./crius-client";
import { createCriusHistoryFeed } from "./crius-history";
import { createEarningsFeed } from "./earnings";
import { createRobinhoodMarketFeed } from "./robinhood-feed";

const robinhoodBaseUrl = process.env.OPTRA_MARKET_ROBINHOOD_BASE_URL;
const criusBaseUrl = process.env.OPTRA_MARKET_CRIUS_BASE_URL;
// This clock is only for replaying the archived E2E market capture; production always uses wall time.
const e2eMarketAsOf = process.env.NODE_ENV === "production"
  ? Number.NaN
  : Date.parse(process.env.OPTRA_E2E_MARKET_AS_OF ?? "");
// One Crius client for charts, backtest history and the scheduler, so they share the API key and the provider's limits.
// CRIUS_API_KEY is optional (anonymous access is capped at 300 requests a day) and is only ever sent to crius.sh.
const criusClient = createCriusClient({
  apiKey: process.env.CRIUS_API_KEY,
  timeoutMs: 20_000,
  ...(Number.isFinite(e2eMarketAsOf) ? { now: () => new Date(e2eMarketAsOf) } : {}),
});
const feed = createRobinhoodMarketFeed(robinhoodBaseUrl ? { baseUrl: robinhoodBaseUrl } : {});
const historyFeed = createCriusHistoryFeed({
  client: criusClient,
  ...(criusBaseUrl ? { criusBaseUrl } : {}),
  ...(robinhoodBaseUrl ? { robinhoodBaseUrl } : {}),
  ...(Number.isFinite(e2eMarketAsOf) ? { now: () => new Date(e2eMarketAsOf) } : {}),
  listMarkets: () => feed.listMarkets(),
});
const candleFeed = createCriusCandleFeed({
  client: criusClient,
  ...(criusBaseUrl ? { criusBaseUrl } : {}),
  ...(Number.isFinite(e2eMarketAsOf) ? { now: () => new Date(e2eMarketAsOf) } : {}),
  listMarkets: () => feed.listMarkets(),
});
const earningsFeed = createEarningsFeed({
  ...(robinhoodBaseUrl ? { baseUrl: robinhoodBaseUrl } : {}),
  ...(Number.isFinite(e2eMarketAsOf) ? { now: () => new Date(e2eMarketAsOf) } : {}),
});
const handlers = createMarketHandlers(feed);

export function getMarketHandlers() {
  return handlers;
}

export function getMarketFeed() {
  return feed;
}

export function getMarketHistoryFeed() {
  return historyFeed;
}

export function getMarketCandleFeed() {
  return candleFeed;
}

export function getEarningsFeed() {
  return earningsFeed;
}
