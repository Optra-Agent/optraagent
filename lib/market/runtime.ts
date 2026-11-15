import { createMarketHandlers } from "./handlers";
import { createCriusHistoryFeed } from "./crius-history";
import { createRobinhoodMarketFeed } from "./robinhood-feed";

const robinhoodBaseUrl = process.env.OPTRA_MARKET_ROBINHOOD_BASE_URL;
const criusBaseUrl = process.env.OPTRA_MARKET_CRIUS_BASE_URL;
const feed = createRobinhoodMarketFeed(robinhoodBaseUrl ? { baseUrl: robinhoodBaseUrl } : {});
const historyFeed = createCriusHistoryFeed({
  ...(criusBaseUrl ? { criusBaseUrl } : {}),
  ...(robinhoodBaseUrl ? { robinhoodBaseUrl } : {}),
  listMarkets: () => feed.listMarkets(),
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
