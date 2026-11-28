import { acquirePaperSchedulerLock, getDatabase } from "../db/client";
import { lookupWalletSession } from "../auth/session-lookup";
import { getEarningsFeed, getMarketFeed, getMarketHistoryFeed } from "../market/runtime";
import { DrizzleBacktestRepository } from "../backtest/drizzle-repository";
import { createAgentHandlers } from "./agents";
import { DrizzlePaperRepository } from "./drizzle-repository";
import { createPaperHandlers } from "./handlers";
import { createPaperScheduler } from "./scheduler";

export async function getPaperHandlers() {
  const db = await getDatabase();
  const repository = new DrizzlePaperRepository(db);
  return createPaperHandlers({
    repository,
    db,
    readSession: lookupWalletSession,
    getSnapshot: (symbol) => getMarketFeed().getSnapshot(symbol),
    getHistory: (symbol) => getMarketHistoryFeed().getHistory(symbol),
    getEarnings: (symbol) => getEarningsFeed().getEarnings(symbol),
  });
}

export async function getPaperScheduler() {
  const db = await getDatabase();
  const repository = new DrizzlePaperRepository(db);
  return createPaperScheduler({
    repository,
    db,
    secret: process.env.CRON_SECRET,
    getHistory: (symbol) => getMarketHistoryFeed().getHistory(symbol),
    getEarnings: (symbol) => getEarningsFeed().getEarnings(symbol),
    acquireLock: acquirePaperSchedulerLock,
  });
}

export async function getAgentHandlers() {
  const db = await getDatabase();
  return createAgentHandlers({
    repository: new DrizzlePaperRepository(db),
    backtests: new DrizzleBacktestRepository(db),
    readSession: lookupWalletSession,
  });
}

export function paperUnavailableResponse(): Response {
  return Response.json({
    error: { code: "UPSTREAM_UNAVAILABLE", message: "Paper execution is temporarily unavailable.", retryable: true },
  }, { status: 503, headers: { "cache-control": "no-store" } });
}
