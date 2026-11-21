import { createMarketHandlers } from "./handlers";
import { createCriusHistoryFeed } from "./crius-history";
import { createEarningsFeed } from "./earnings";
import { createRobinhoodMarketFeed } from "./robinhood-feed";

const robinhoodBaseUrl = process.env.OPTRA_MARKET_ROBINHOOD_BASE_URL;
const criusBaseUrl = process.env.OPTRA_MARKET_CRIUS_BASE_URL;
// This clock is only for replaying the archived E2E market capture; production always uses wall time.
const e2eMarketAsOf = process.env.NODE_ENV === "production"
  ? Number.NaN
  : Date.parse(process.env.OPTRA_E2E_MARKET_AS_OF ?? "");
const feed = createRobinhoodMarketFeed(robinhoodBaseUrl ? { baseUrl: robinhoodBaseUrl } : {});
const historyFeed = createCriusHistoryFeed({
  ...(criusBaseUrl ? { criusBaseUrl } : {}),
  ...(robinhoodBaseUrl ? { robinhoodBaseUrl } : {}),
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

export function getEarningsFeed() {
  return earningsFeed;
}
