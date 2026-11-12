import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase } from "../../lib/db/client";
import { runBacktest } from "../../lib/backtest/run";
import { DrizzleBacktestRepository } from "../../lib/backtest/drizzle-repository";
import type { MarketSnapshot, RecipeV1 } from "../../lib/domain/contracts";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;
const recipe: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: ["unknown"], parameters: {} };
const snapshot = (observedAt: string): MarketSnapshot => ({
  symbol: "AAPL", source: "robinhood_stock_token_api", observedAt, receivedAt: observedAt,
  underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: "1.001", tokenBidUsd: "356.16", tokenAskUsd: "356.38",
  currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
});

describe("hourly history and backtest persistence", () => {
  let rootDir: string;

  afterEach(() => {
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
  });

  it("stores_only_one_real_snapshot_per_symbol_and_utc_hour", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-hourly-history-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const repository = new DrizzleBacktestRepository(connection.db);
      const first = await repository.storeHourlySnapshot(snapshot("2026-11-12T03:05:00.000Z"));
      const retry = await repository.storeHourlySnapshot(snapshot("2026-11-12T03:45:00.000Z"));
      const hourly = await repository.listHourlySnapshots("AAPL");

      expect(first).toBe(true);
      expect(retry).toBe(false);
      expect(hourly).toHaveLength(1);
      expect(hourly[0]?.observedAt).toBe("2026-11-12T03:05:00.000Z");
    } finally {
      await connection.close();
    }
  });

  it("persists_incomplete_runs_per_owner_without_metrics", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-backtest-persist-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const auth = new DrizzleAuthRepository(connection.db);
      const owner = await auth.findOrCreateUser(ADDRESS);
      const repository = new DrizzleBacktestRepository(connection.db);
      const run = runBacktest({
        runId: "123e4567-e89b-42d3-a456-426614174000", recipe, candles: [], now: "2026-11-12T03:31:00.000Z",
      });

      await repository.createBacktestRun(owner.id, recipe, run);

      await expect(repository.getBacktestRun(owner.id, run.id)).resolves.toEqual(run);
      await expect(repository.getBacktestRun("00000000-0000-4000-8000-000000000000", run.id)).resolves.toBeNull();
    } finally {
      await connection.close();
    }
  });
});
