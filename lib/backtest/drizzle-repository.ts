import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { BacktestRunSchema, MarketCandleSchema, MarketSnapshotSchema, RecipeV1Schema } from "../domain/contracts";
import type { BacktestRun, MarketCandle, MarketSnapshot, RecipeV1 } from "../domain/contracts";
import { hashMarketCandles } from "./run";
import { agents, backtestRuns, hourlyMarketSamples, marketSnapshots } from "../../db/schema";

function toBacktestRun(row: typeof backtestRuns.$inferSelect): BacktestRun {
  return BacktestRunSchema.parse({
    id: row.id,
    recipeHash: row.recipeHash,
    dataSource: row.dataSource,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    sampleCount: row.sampleCount,
    entryOrderCount: row.entryOrderCount,
    exitOrderCount: row.exitOrderCount,
    hourlyCoverageComplete: row.hourlyCoverageComplete,
    premiumSource: row.premiumSource,
    pricingMethod: row.pricingMethod,
    status: row.status,
    metrics: row.metrics,
    ...(row.historyDataHash ? { historyDataHash: row.historyDataHash } : {}),
    ...(row.historyProvenance ? { historyProvenance: row.historyProvenance } : {}),
    ...(row.pricingAssumptions ? { pricingAssumptions: row.pricingAssumptions } : {}),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  });
}

function toSnapshot(row: typeof marketSnapshots.$inferSelect): MarketSnapshot {
  return MarketSnapshotSchema.parse({
    symbol: row.symbol,
    source: row.source,
    observedAt: row.observedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    underlyingBidUsd: row.underlyingBidUsd,
    underlyingAskUsd: row.underlyingAskUsd,
    currentMultiplier: row.currentMultiplier,
    tokenBidUsd: row.tokenBidUsd,
    tokenAskUsd: row.tokenAskUsd,
    currency: row.currency,
    stale: row.stale,
    tradingHalt: row.tradingHalt,
    pricingMethod: row.pricingMethod,
  });
}

export class DrizzleBacktestRepository {
  constructor(private readonly db: AppDatabase) {}

  async storeHourlySnapshot(input: MarketSnapshot): Promise<boolean> {
    const snapshot = MarketSnapshotSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const observedAt = new Date(snapshot.observedAt);
      const receivedAt = new Date(snapshot.receivedAt);
      const [insertedSnapshot] = await tx.insert(marketSnapshots).values({
        symbol: snapshot.symbol,
        source: snapshot.source,
        observedAt,
        receivedAt,
        underlyingBidUsd: snapshot.underlyingBidUsd,
        underlyingAskUsd: snapshot.underlyingAskUsd,
        currentMultiplier: snapshot.currentMultiplier,
        tokenBidUsd: snapshot.tokenBidUsd,
        tokenAskUsd: snapshot.tokenAskUsd,
        currency: snapshot.currency,
        stale: snapshot.stale,
        tradingHalt: snapshot.tradingHalt,
        pricingMethod: snapshot.pricingMethod,
      }).onConflictDoNothing({ target: [marketSnapshots.symbol, marketSnapshots.observedAt] }).returning({ id: marketSnapshots.id });

      let snapshotId = insertedSnapshot?.id;
      if (!snapshotId) {
        const [existing] = await tx.select({ id: marketSnapshots.id }).from(marketSnapshots)
          .where(and(eq(marketSnapshots.symbol, snapshot.symbol), eq(marketSnapshots.observedAt, observedAt)))
          .limit(1);
        snapshotId = existing?.id;
      }
      if (!snapshotId) throw new Error("Unable to persist hourly market snapshot.");

      const hourBucket = new Date(Math.floor(observedAt.getTime() / 3_600_000) * 3_600_000);
      const [insertedHour] = await tx.insert(hourlyMarketSamples).values({
        symbol: snapshot.symbol,
        hourBucket,
        snapshotId,
      }).onConflictDoNothing({ target: [hourlyMarketSamples.symbol, hourlyMarketSamples.hourBucket] }).returning({ id: hourlyMarketSamples.id });
      return Boolean(insertedHour);
    });
  }

  async listHourlySnapshots(symbol: string, limit = 10_000): Promise<MarketSnapshot[]> {
    const rows = await this.db.select({ snapshot: marketSnapshots })
      .from(hourlyMarketSamples)
      .innerJoin(marketSnapshots, eq(hourlyMarketSamples.snapshotId, marketSnapshots.id))
      .where(eq(hourlyMarketSamples.symbol, symbol))
      .orderBy(asc(hourlyMarketSamples.hourBucket))
      .limit(Math.max(1, Math.min(10_000, limit)));
    return rows.map((row) => toSnapshot(row.snapshot));
  }

  async createBacktestRun(ownerId: string, recipeInput: RecipeV1, runInput: BacktestRun, historyInput: MarketCandle[] = []): Promise<BacktestRun> {
    const recipe = RecipeV1Schema.parse(recipeInput);
    const run = BacktestRunSchema.parse(runInput);
    const historySnapshot = historyInput.map((candle) => MarketCandleSchema.parse(candle));
    if (run.historyDataHash && hashMarketCandles(historySnapshot) !== run.historyDataHash) {
      throw new Error("Backtest history snapshot does not match its recorded data hash.");
    }
    if (run.status === "complete" && historySnapshot.length < 1441) throw new Error("A complete backtest must persist its full history snapshot.");
    const [row] = await this.db.insert(backtestRuns).values({
      id: run.id,
      ownerId,
      recipe,
      recipeHash: run.recipeHash,
      dataSource: run.dataSource,
      startAt: new Date(run.startAt),
      endAt: new Date(run.endAt),
      sampleCount: run.sampleCount,
      entryOrderCount: run.entryOrderCount ?? 0,
      exitOrderCount: run.exitOrderCount ?? 0,
      hourlyCoverageComplete: run.hourlyCoverageComplete,
      premiumSource: run.premiumSource,
      pricingMethod: run.pricingMethod,
      status: run.status,
      metrics: run.metrics,
      historyDataHash: run.historyDataHash ?? null,
      historyProvenance: run.historyProvenance ?? null,
      historySnapshot,
      pricingAssumptions: run.pricingAssumptions ?? null,
      reason: run.reason,
      createdAt: new Date(run.createdAt),
    }).returning();
    if (!row) throw new Error("Unable to persist backtest run.");
    return toBacktestRun(row);
  }

  async getBacktestRun(ownerId: string, runId: string): Promise<BacktestRun | null> {
    const [row] = await this.db.select().from(backtestRuns)
      .where(and(eq(backtestRuns.id, runId), eq(backtestRuns.ownerId, ownerId)))
      .limit(1);
    return row ? toBacktestRun(row) : null;
  }

  async getBacktestRecipe(ownerId: string, runId: string): Promise<RecipeV1 | null> {
    const [row] = await this.db.select({ recipe: backtestRuns.recipe }).from(backtestRuns)
      .where(and(eq(backtestRuns.id, runId), eq(backtestRuns.ownerId, ownerId)))
      .limit(1);
    return row ? RecipeV1Schema.parse(row.recipe) : null;
  }

  async getBacktestHistory(ownerId: string, runId: string): Promise<MarketCandle[] | null> {
    const [row] = await this.db.select({ historySnapshot: backtestRuns.historySnapshot }).from(backtestRuns)
      .where(and(eq(backtestRuns.id, runId), eq(backtestRuns.ownerId, ownerId)))
      .limit(1);
    if (!row || !row.historySnapshot) return null;
    return row.historySnapshot.map((candle) => MarketCandleSchema.parse(candle));
  }

  async launchAgent(ownerId: string, agentId: string, runId: string, recipeHash: string, updatedAt: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx.select().from(backtestRuns)
        .where(and(eq(backtestRuns.id, runId), eq(backtestRuns.ownerId, ownerId)))
        .limit(1);
      if (
        !run ||
        run.status !== "complete" ||
        run.recipeHash !== recipeHash ||
        run.sampleCount < 720 ||
        (run.entryOrderCount ?? 0) < 1 ||
        !run.hourlyCoverageComplete ||
        !run.historyDataHash ||
        !run.historyProvenance ||
        !run.pricingAssumptions ||
        !Array.isArray(run.historySnapshot) ||
        run.historySnapshot.length < 1441 ||
        hashMarketCandles(run.historySnapshot) !== run.historyDataHash ||
        run.premiumSource === "unavailable" ||
        run.pricingMethod === "unavailable" ||
        run.metrics === null
      ) return false;

      const [updated] = await tx.update(agents)
        .set({ status: "running", backtestRunId: run.id, updatedAt })
        .where(and(
          eq(agents.id, agentId),
          eq(agents.ownerId, ownerId),
          eq(agents.status, "draft"),
          eq(agents.recipeHash, recipeHash),
        ))
        .returning({ id: agents.id });
      return Boolean(updated);
    });
  }
}
