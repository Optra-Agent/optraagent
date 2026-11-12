import { randomUUID } from "node:crypto";
import { lookupWalletSession } from "../auth/session-lookup";
import { getDatabase } from "../db/client";
import { getMarketFeed, getMarketHistoryFeed } from "../market/runtime";
import { DrizzlePaperRepository } from "../paper/drizzle-repository";
import { createMarketHistoryCollector } from "./collector";
import { createBacktestHandlers } from "./handlers";
import { DrizzleBacktestRepository } from "./drizzle-repository";

export async function getBacktestHandlers() {
  const db = await getDatabase();
  const repository = new DrizzleBacktestRepository(db);
  const agents = new DrizzlePaperRepository(db);
  return createBacktestHandlers({
    repository,
    agents,
    readSession: lookupWalletSession,
    listMarkets: () => getMarketFeed().listMarkets(),
    getHistory: (symbol) => getMarketHistoryFeed().getHistory(symbol),
    newRunId: randomUUID,
  });
}

export async function getMarketHistoryCollector() {
  const repository = new DrizzleBacktestRepository(await getDatabase());
  const configuredSymbols = process.env.MARKET_HISTORY_SYMBOLS?.trim() || "AAPL";
  return createMarketHistoryCollector({
    secret: process.env.CRON_SECRET,
    symbols: configuredSymbols.split(","),
    getSnapshot: (symbol) => getMarketFeed().getSnapshot(symbol),
    storeSnapshot: (snapshot) => repository.storeHourlySnapshot(snapshot),
  });
}

export function backtestUnavailableResponse(): Response {
  return Response.json({
    error: { code: "UPSTREAM_UNAVAILABLE", message: "Backtest services are temporarily unavailable.", retryable: true },
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

export function historyCollectorUnavailableResponse(): Response {
  return Response.json({
    error: { code: "UPSTREAM_UNAVAILABLE", message: "Market history collection is temporarily unavailable.", retryable: true },
  }, { status: 503, headers: { "cache-control": "no-store" } });
}
