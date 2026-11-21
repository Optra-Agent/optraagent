import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { MarketSnapshotSchema } from "../domain/contracts";
import type { AgentDecision, MarketSnapshot, RecipeV1 } from "../domain/contracts";
import { parseStrategyMeta } from "../engine/strategy/types";
import type { StrategyAccount, StrategyPosition, StrategyTickResult } from "../engine/strategy/types";
import { agents, marketSnapshots, paperAccounts, paperDecisions, paperOrders, paperPositions } from "../../db/schema";

export type StrategyTickContext = {
  agent: { id: string; ownerId: string; templateId: string; status: string; recipe: RecipeV1; recipeHash: string; updatedAt: string };
  account: StrategyAccount | null;
  positions: StrategyPosition[];
};

export type PersistStrategyTickInput = {
  ownerId: string;
  agentId: string;
  tickId: string;
  occurredAt: string;
  snapshot: MarketSnapshot | null;
  evaluate: (context: StrategyTickContext) => StrategyTickResult;
};

export type PersistStrategyTickResult = { decision: AgentDecision; duplicate: boolean; orderCount: number };

export class StrategyTickStateError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "StrategyTickStateError";
  }
}

export function toStrategyPosition(row: typeof paperPositions.$inferSelect): StrategyPosition {
  return {
    id: row.id,
    symbol: row.symbol,
    optionType: row.optionType === "call" ? "call" : "put",
    side: row.side === "short" ? "short" : "long",
    quantity: row.quantity,
    averageEntryUsd: row.averageEntryUsd,
    markPriceUsd: row.markPriceUsd,
    peakMarkPriceUsd: row.peakMarkPriceUsd,
    strikeUsd: row.strikeUsd,
    expiryAt: row.expiryAt.toISOString(),
    impliedVolatility: row.impliedVolatility,
    modelName: row.modelName === "black_scholes_european_call" ? "black_scholes_european_call" : "black_scholes_european_put",
    premiumSource: "modeled",
    modelInputs: row.modelInputs,
    collateralUsd: row.collateralUsd,
    structureId: row.structureId,
    legRole: row.legRole,
    openedAt: row.openedAt.toISOString(),
    status: row.status === "closed" ? "closed" : "open",
  };
}

export function toStrategyAccount(row: typeof paperAccounts.$inferSelect): StrategyAccount {
  return {
    initialCapitalUsd: row.initialCapitalUsd,
    cashUsd: row.cashUsd,
    realizedPnlUsd: row.realizedPnlUsd,
    peakEquityUsd: row.peakEquityUsd,
    dailyStartEquityUsd: row.dailyStartEquityUsd,
    dailyStartDate: row.dailyStartDate,
    meta: parseStrategyMeta(row.meta),
  };
}

function toDecision(row: typeof paperDecisions.$inferSelect): AgentDecision {
  return {
    id: row.id,
    agentId: row.agentId,
    tickId: row.tickId,
    action: row.action as AgentDecision["action"],
    reason: row.reason,
    hookResults: row.hookResults,
    ...(row.marketContext ? { marketContext: row.marketContext } : {}),
    snapshotSource: row.snapshotSource,
    recipeHash: row.recipeHash,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Persists one strategy-engine tick atomically: the decision (idempotent per tick id), every position change, every
 * order, and the paper account. It locks the agent row first, so two schedulers or a scheduler and a manual tick can
 * never both evaluate the same agent at once.
 */
export async function persistStrategyTick(db: AppDatabase, input: PersistStrategyTickInput): Promise<PersistStrategyTickResult> {
  if (input.tickId.length < 1 || input.tickId.length > 128) throw new Error("Tick id must be 1–128 characters.");
  const occurredAtMs = Date.parse(input.occurredAt);
  if (!Number.isFinite(occurredAtMs)) throw new Error("Paper tick time is invalid.");
  return db.transaction(async (tx) => {
    const [agentRow] = await tx.select().from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.ownerId, input.ownerId)))
      .for("update")
      .limit(1);
    if (!agentRow) throw new StrategyTickStateError("NOT_FOUND", "Paper agent was not found for this owner.");
    if (agentRow.status !== "running") throw new StrategyTickStateError("CONFLICT", `Agent is ${agentRow.status}; only running agents can be ticked.`);

    const [existing] = await tx.select().from(paperDecisions)
      .where(and(eq(paperDecisions.agentId, input.agentId), eq(paperDecisions.tickId, input.tickId)))
      .limit(1);
    if (existing) {
      const orders = await tx.select({ id: paperOrders.id }).from(paperOrders).where(and(eq(paperOrders.agentId, input.agentId), eq(paperOrders.tickId, input.tickId)));
      return { decision: toDecision(existing), duplicate: true, orderCount: orders.length };
    }
    const [latest] = await tx.select({ createdAt: paperDecisions.createdAt }).from(paperDecisions)
      .where(eq(paperDecisions.agentId, input.agentId)).orderBy(desc(paperDecisions.createdAt)).limit(1);
    if (latest && occurredAtMs < latest.createdAt.getTime()) throw new StrategyTickStateError("CONFLICT", "Paper tick time precedes the latest persisted decision.");

    const [accountRow] = await tx.select().from(paperAccounts).where(eq(paperAccounts.agentId, input.agentId)).limit(1);
    const positionRows = await tx.select().from(paperPositions)
      .where(and(eq(paperPositions.agentId, input.agentId), eq(paperPositions.status, "open")));
    const execution = input.evaluate({
      agent: {
        id: agentRow.id, ownerId: agentRow.ownerId, templateId: agentRow.templateId, status: agentRow.status,
        recipe: agentRow.recipe, recipeHash: agentRow.recipeHash, updatedAt: agentRow.updatedAt.toISOString(),
      },
      account: accountRow ? toStrategyAccount(accountRow) : null,
      positions: positionRows.map(toStrategyPosition),
    });
    if (execution.decision.agentId !== input.agentId || execution.decision.tickId !== input.tickId) throw new Error("Paper tick evaluation does not match the locked agent and tick scope.");
    if (Date.parse(execution.decision.createdAt) !== occurredAtMs) throw new Error("Paper tick decision time does not match its persisted time scope.");

    let snapshotId: string | null = null;
    if (input.snapshot) {
      const snapshot = MarketSnapshotSchema.parse(input.snapshot);
      const [inserted] = await tx.insert(marketSnapshots).values({
        symbol: snapshot.symbol, source: snapshot.source, observedAt: new Date(snapshot.observedAt), receivedAt: new Date(snapshot.receivedAt),
        underlyingBidUsd: snapshot.underlyingBidUsd, underlyingAskUsd: snapshot.underlyingAskUsd, currentMultiplier: snapshot.currentMultiplier,
        tokenBidUsd: snapshot.tokenBidUsd, tokenAskUsd: snapshot.tokenAskUsd, currency: snapshot.currency, stale: snapshot.stale,
        tradingHalt: snapshot.tradingHalt, pricingMethod: snapshot.pricingMethod,
      }).onConflictDoNothing({ target: [marketSnapshots.symbol, marketSnapshots.observedAt] }).returning({ id: marketSnapshots.id });
      if (inserted) snapshotId = inserted.id;
      else {
        const [stored] = await tx.select({ id: marketSnapshots.id }).from(marketSnapshots)
          .where(and(eq(marketSnapshots.symbol, snapshot.symbol), eq(marketSnapshots.observedAt, new Date(snapshot.observedAt)))).limit(1);
        snapshotId = stored?.id ?? null;
      }
    }

    const createdAt = new Date(execution.decision.createdAt);
    const [insertedDecision] = await tx.insert(paperDecisions).values({
      id: execution.decision.id, agentId: input.agentId, tickId: execution.decision.tickId, action: execution.decision.action,
      reason: execution.decision.reason, hookResults: execution.decision.hookResults, marketContext: execution.decision.marketContext ?? null,
      snapshotId, snapshotSource: execution.decision.snapshotSource, recipeHash: execution.decision.recipeHash, createdAt,
    }).onConflictDoNothing({ target: [paperDecisions.agentId, paperDecisions.tickId] }).returning();
    if (!insertedDecision) {
      const [stored] = await tx.select().from(paperDecisions).where(and(eq(paperDecisions.agentId, input.agentId), eq(paperDecisions.tickId, input.tickId))).limit(1);
      if (!stored) throw new Error("Unable to load idempotent paper decision.");
      const orders = await tx.select({ id: paperOrders.id }).from(paperOrders).where(and(eq(paperOrders.agentId, input.agentId), eq(paperOrders.tickId, input.tickId)));
      return { decision: toDecision(stored), duplicate: true, orderCount: orders.length };
    }

    const idByKey = new Map<string, string>();
    for (const change of execution.portfolio.changes) {
      const position = change.position;
      if (change.action === "open") {
        const id = randomUUID();
        idByKey.set(change.key, id);
        await tx.insert(paperPositions).values({
          id, agentId: input.agentId, symbol: position.symbol, quantity: position.quantity, averageEntryUsd: position.averageEntryUsd,
          markPriceUsd: position.markPriceUsd, peakMarkPriceUsd: position.peakMarkPriceUsd, instrumentType: "modeled_option",
          optionType: position.optionType, side: position.side, strikeUsd: position.strikeUsd, expiryAt: new Date(position.expiryAt),
          impliedVolatility: position.impliedVolatility, modelName: position.modelName, premiumSource: "modeled", modelInputs: position.modelInputs,
          collateralUsd: position.collateralUsd, structureId: position.structureId, legRole: position.legRole,
          openedAt: new Date(position.openedAt), closedAt: null, realizedPnlUsd: "0",
          unrealizedPnlUsd: unrealized(position), status: "open", updatedAt: createdAt,
        });
      } else {
        const id = position.id ?? change.key;
        idByKey.set(change.key, id);
        if (change.action === "update") {
          await tx.update(paperPositions).set({
            markPriceUsd: position.markPriceUsd, peakMarkPriceUsd: position.peakMarkPriceUsd, impliedVolatility: position.impliedVolatility,
            unrealizedPnlUsd: unrealized(position), updatedAt: createdAt,
          }).where(and(eq(paperPositions.id, id), eq(paperPositions.agentId, input.agentId), eq(paperPositions.status, "open")));
        } else {
          const closed = await tx.update(paperPositions).set({
            markPriceUsd: position.markPriceUsd, peakMarkPriceUsd: position.peakMarkPriceUsd, impliedVolatility: position.impliedVolatility,
            unrealizedPnlUsd: "0", realizedPnlUsd: position.realizedPnlUsd ?? "0", status: "closed", closedAt: createdAt, updatedAt: createdAt,
          }).where(and(eq(paperPositions.id, id), eq(paperPositions.agentId, input.agentId), eq(paperPositions.status, "open"))).returning({ id: paperPositions.id });
          if (closed.length !== 1) throw new StrategyTickStateError("CONFLICT", "A position closed by this tick was no longer open.");
        }
      }
    }

    for (const [orderSeq, order] of execution.orderIntents.entries()) {
      await tx.insert(paperOrders).values({
        agentId: input.agentId, decisionId: insertedDecision.id, orderSeq, positionId: idByKey.get(order.positionKey) ?? null,
        tickId: execution.decision.tickId, symbol: order.symbol, instrumentType: order.instrumentType, optionType: order.optionType,
        strikeUsd: order.strikeUsd, expiryAt: new Date(order.expiryAt), impliedVolatility: order.impliedVolatility, modelPremiumUsd: order.modelPremiumUsd,
        modelName: order.modelName, premiumSource: order.premiumSource, modelInputs: order.modelInputs, purpose: order.purpose, legRole: order.legRole,
        side: order.side, quantity: order.quantity, priceUsd: order.priceUsd, feeUsd: order.feeUsd, slippageBps: order.slippageBps,
        status: "filled", executionMode: "PAPER", createdAt,
      });
    }

    const account = execution.portfolio.account;
    const values = {
      initialCapitalUsd: account.initialCapitalUsd, cashUsd: account.cashUsd, realizedPnlUsd: account.realizedPnlUsd,
      peakEquityUsd: account.peakEquityUsd, dailyStartEquityUsd: account.dailyStartEquityUsd, dailyStartDate: account.dailyStartDate,
      meta: account.meta as unknown as Record<string, unknown>, updatedAt: createdAt,
    };
    if (accountRow) await tx.update(paperAccounts).set(values).where(eq(paperAccounts.agentId, input.agentId));
    else if (Number(account.initialCapitalUsd) > 0) await tx.insert(paperAccounts).values({ agentId: input.agentId, ...values });
    return { decision: toDecision(insertedDecision), duplicate: false, orderCount: execution.orderIntents.length };
  });
}

function unrealized(position: StrategyPosition): string {
  const sign = position.side === "short" ? -1 : 1;
  return (sign * (Number(position.markPriceUsd) - Number(position.averageEntryUsd)) * Number(position.quantity)).toFixed(6);
}
