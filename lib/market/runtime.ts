import { createMarketHandlers } from "./handlers";
import { createCriusHistoryFeed } from "./crius-history";
import { createRobinhoodMarketFeed } from "./robinhood-feed";

const feed = createRobinhoodMarketFeed();
const historyFeed = createCriusHistoryFeed({ listMarkets: () => feed.listMarkets() });
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
