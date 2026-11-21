import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/client";
import { getEarningsFeed, getMarketHistoryFeed } from "../market/runtime";
import { ensureHouseAgents } from "./house-agents";
import type { HouseAgentOutcome } from "./house-agents";

export async function runEnsureHouseAgents(options: { blockedUntil?: Map<string, number> } = {}): Promise<HouseAgentOutcome[]> {
  return ensureHouseAgents({
    ...(options.blockedUntil ? { blockedUntil: options.blockedUntil } : {}),
    db: await getDatabase(),
    getHistory: (symbol) => getMarketHistoryFeed().getHistory(symbol),
    getEarnings: (symbol) => getEarningsFeed().getEarnings(symbol),
    newRunId: randomUUID,
    log: (entry) => console.info(JSON.stringify(entry)),
  });
}
