import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  AgentSchema,
  AgentDecisionSchema,
  MarketSnapshotSchema,
  RecipeV1Schema,
  PaperPositionSchema,
  PaperOrderSchema,
} from "../domain/contracts";
import type { Agent, AgentDecision, MarketSnapshot, PaperOrder, PaperPosition, RecipeV1 } from "../domain/contracts";
import type { PaperAccountState, PaperOptionPositionState, PaperOrderIntent, PaperPortfolioUpdate } from "../engine/run-tick";
import { agents, marketSnapshots, paperAccounts, paperDecisions, paperOrders, paperPositions } from "../../db/schema";

export type StoredPaperAgent = Agent & { recipe: RecipeV1 };

export type PersistTickInput = {
  ownerId: string;
  agentId: string;
  snapshot: MarketSnapshot | null;
  decision: AgentDecision;
  orders?: PaperOrderIntent[];
  portfolio?: PaperPortfolioUpdate;
};

export type PersistTickResult = {
  decision: AgentDecision;
  duplicate: boolean;
  orderCount?: number;
};

function toAgent(row: typeof agents.$inferSelect): StoredPaperAgent {
  return {
    ...AgentSchema.parse({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      templateId: row.templateId,
      status: row.status,
      recipeHash: row.recipeHash,
      backtestRunId: row.backtestRunId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
    recipe: RecipeV1Schema.parse(row.recipe),
  };
}

function toDecision(row: typeof paperDecisions.$inferSelect): AgentDecision {
  return AgentDecisionSchema.parse({
    id: row.id,
    agentId: row.agentId,
    tickId: row.tickId,
    action: row.action,
    reason: row.reason,
    hookResults: row.hookResults,
    ...(row.marketContext ? { marketContext: row.marketContext } : {}),
    snapshotSource: row.snapshotSource,
    recipeHash: row.recipeHash,
    createdAt: row.createdAt.toISOString(),
  });
}

function toPosition(row: typeof paperPositions.$inferSelect): PaperPosition {
  return PaperPositionSchema.parse({
    id: row.id,
    agentId: row.agentId,
    symbol: row.symbol,
    quantity: row.quantity,
    averageEntryUsd: row.averageEntryUsd,
    markPriceUsd: row.markPriceUsd,
    peakMarkPriceUsd: row.peakMarkPriceUsd,
    instrumentType: row.instrumentType,
    optionType: row.optionType,
    strikeUsd: row.strikeUsd,
    expiryAt: row.expiryAt.toISOString(),
    impliedVolatility: row.impliedVolatility,
    modelName: row.modelName,
    premiumSource: row.premiumSource,
    modelInputs: row.modelInputs,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    realizedPnlUsd: row.realizedPnlUsd,
    unrealizedPnlUsd: row.status === "open" ? ((Number(row.markPriceUsd) - Number(row.averageEntryUsd)) * Number(row.quantity)).toFixed(6) : "0",
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toOrder(row: typeof paperOrders.$inferSelect): PaperOrder {
  return PaperOrderSchema.parse({
    id: row.id,
    agentId: row.agentId,
    decisionId: row.decisionId,
    tickId: row.tickId,
    symbol: row.symbol,
    instrumentType: row.instrumentType,
    optionType: row.optionType,
    strikeUsd: row.strikeUsd,
    expiryAt: row.expiryAt.toISOString(),
    impliedVolatility: row.impliedVolatility,
    modelPremiumUsd: row.modelPremiumUsd,
    modelName: row.modelName,
    premiumSource: row.premiumSource,
    modelInputs: row.modelInputs,
    side: row.side,
    quantity: row.quantity,
    priceUsd: row.priceUsd,
    feeUsd: row.feeUsd,
    slippageBps: row.slippageBps,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    executionMode: row.executionMode,
  });
}

function toPositionState(row: typeof paperPositions.$inferSelect): PaperOptionPositionState {
  return {
    id: row.id,
    symbol: row.symbol,
    quantity: row.quantity,
    averageEntryUsd: row.averageEntryUsd,
    markPriceUsd: row.markPriceUsd,
    peakMarkPriceUsd: row.peakMarkPriceUsd,
    strikeUsd: row.strikeUsd,
    expiryAt: row.expiryAt.toISOString(),
    impliedVolatility: row.impliedVolatility,
    modelName: "black_scholes_european_put",
    premiumSource: "modeled",
    modelInputs: row.modelInputs,
    openedAt: row.openedAt.toISOString(),
    status: row.status as "open" | "closed",
  };
}

function toAccountState(row: typeof paperAccounts.$inferSelect): PaperAccountState {
  return {
    initialCapitalUsd: row.initialCapitalUsd,
    cashUsd: row.cashUsd,
    realizedPnlUsd: row.realizedPnlUsd,
    peakEquityUsd: row.peakEquityUsd,
    dailyStartEquityUsd: row.dailyStartEquityUsd,
    dailyStartDate: row.dailyStartDate,
  };
}

export class DrizzlePaperRepository {
  constructor(private readonly db: AppDatabase) {}

  async createAgent(input: {
    ownerId: string;
    name: string;
    templateId: string;
    status: Agent["status"];
    recipe: RecipeV1;
    recipeHash: string;
    createdAt: Date;
  }): Promise<StoredPaperAgent> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(agents).values({
        ownerId: input.ownerId,
        name: input.name,
        templateId: input.templateId,
        status: input.status,
        recipe: input.recipe,
        recipeHash: input.recipeHash,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }).returning();
      if (!row) throw new Error("Unable to create paper agent.");
      if (input.recipe.templateId === "protective_put") {
        const initialCapital = Number(input.recipe.parameters.initialCapitalUsd);
        if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error("Protective Put paper capital is invalid.");
        const capital = initialCapital.toFixed(2);
        await tx.insert(paperAccounts).values({
          agentId: row.id,
          initialCapitalUsd: capital,
          cashUsd: capital,
          realizedPnlUsd: "0",
          peakEquityUsd: capital,
          dailyStartEquityUsd: capital,
          dailyStartDate: input.createdAt.toISOString().slice(0, 10),
          updatedAt: input.createdAt,
        });
      }
      return toAgent(row);
    });
  }

  async findAgent(ownerId: string, agentId: string): Promise<StoredPaperAgent | null> {
    const [row] = await this.db.select().from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);
    return row ? toAgent(row) : null;
  }

  async listAgents(ownerId: string): Promise<StoredPaperAgent[]> {
    const rows = await this.db.select().from(agents)
      .where(eq(agents.ownerId, ownerId))
      .orderBy(desc(agents.createdAt));
    return rows.map(toAgent);
  }

  async transitionAgent(
    ownerId: string,
    agentId: string,
    expectedStatus: Agent["status"],
    status: Agent["status"],
    updatedAt: Date,
  ): Promise<StoredPaperAgent | null> {
    const [row] = await this.db.update(agents)
      .set({ status, updatedAt })
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId), eq(agents.status, expectedStatus)))
      .returning();
    return row ? toAgent(row) : null;
  }

  async getDecision(ownerId: string, agentId: string, tickId: string): Promise<AgentDecision | null> {
    const [row] = await this.db.select({ decision: paperDecisions })
      .from(paperDecisions)
      .innerJoin(agents, eq(paperDecisions.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(paperDecisions.agentId, agentId), eq(paperDecisions.tickId, tickId)))
      .limit(1);
    return row ? toDecision(row.decision) : null;
  }

  async getOrderCount(ownerId: string, agentId: string, tickId: string): Promise<number> {
    const rows = await this.db.select({ id: paperOrders.id })
      .from(paperOrders)
      .innerJoin(agents, eq(paperOrders.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(paperOrders.agentId, agentId), eq(paperOrders.tickId, tickId)));
    return rows.length;
  }

  async getPaperState(ownerId: string, agentId: string): Promise<{ account: PaperAccountState | null; position: PaperOptionPositionState | null }> {
    const [account] = await this.db.select({ account: paperAccounts })
      .from(paperAccounts)
      .innerJoin(agents, eq(paperAccounts.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(agents.id, agentId)))
      .limit(1);
    const [position] = await this.db.select({ position: paperPositions })
      .from(paperPositions)
      .innerJoin(agents, eq(paperPositions.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(agents.id, agentId), eq(paperPositions.status, "open")))
      .limit(1);
    return { account: account ? toAccountState(account.account) : null, position: position ? toPositionState(position.position) : null };
  }

  async persistTick(input: PersistTickInput): Promise<PersistTickResult> {
    if (input.decision.agentId !== input.agentId) throw new Error("Decision agent does not match tick owner scope.");
    if (input.decision.tickId.length < 1 || input.decision.tickId.length > 128) throw new Error("Tick id must be 1–128 characters.");

    const ordersToPersist = input.orders ?? [];
    const zeroAccount: PaperAccountState = { initialCapitalUsd: "0", cashUsd: "0", realizedPnlUsd: "0", peakEquityUsd: "0", dailyStartEquityUsd: "0", dailyStartDate: input.decision.createdAt.slice(0, 10) };
    const portfolio = input.portfolio ?? { account: zeroAccount, position: null, positionAction: "unchanged" as const };
    return this.db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.ownerId, input.ownerId)))
        .limit(1);
      if (!agent) throw new Error("Paper agent was not found for this owner.");

      const [existing] = await tx.select().from(paperDecisions)
        .where(and(eq(paperDecisions.agentId, input.agentId), eq(paperDecisions.tickId, input.decision.tickId)))
        .limit(1);
      if (existing) {
        const orders = await tx.select({ id: paperOrders.id }).from(paperOrders)
          .where(and(eq(paperOrders.agentId, input.agentId), eq(paperOrders.tickId, input.decision.tickId)));
        return { decision: toDecision(existing), duplicate: true, orderCount: orders.length };
      }

      let snapshotId: string | null = null;
      if (input.snapshot) {
        const snapshot = MarketSnapshotSchema.parse(input.snapshot);
        const [insertedSnapshot] = await tx.insert(marketSnapshots).values({
          symbol: snapshot.symbol,
          source: snapshot.source,
          observedAt: new Date(snapshot.observedAt),
          receivedAt: new Date(snapshot.receivedAt),
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
        if (insertedSnapshot) snapshotId = insertedSnapshot.id;
        else {
          const [storedSnapshot] = await tx.select({ id: marketSnapshots.id }).from(marketSnapshots)
            .where(and(eq(marketSnapshots.symbol, snapshot.symbol), eq(marketSnapshots.observedAt, new Date(snapshot.observedAt))))
            .limit(1);
          snapshotId = storedSnapshot?.id ?? null;
        }
      }

      const [insertedDecision] = await tx.insert(paperDecisions).values({
        id: input.decision.id,
        agentId: input.agentId,
        tickId: input.decision.tickId,
        action: input.decision.action,
        reason: input.decision.reason,
        hookResults: input.decision.hookResults,
        marketContext: input.decision.marketContext ?? null,
        snapshotId,
        snapshotSource: input.decision.snapshotSource,
        recipeHash: input.decision.recipeHash,
        createdAt: new Date(input.decision.createdAt),
      }).onConflictDoNothing({ target: [paperDecisions.agentId, paperDecisions.tickId] }).returning();
      if (!insertedDecision) {
        const [storedDecision] = await tx.select().from(paperDecisions)
          .where(and(eq(paperDecisions.agentId, input.agentId), eq(paperDecisions.tickId, input.decision.tickId)))
          .limit(1);
        if (!storedDecision) throw new Error("Unable to load idempotent paper decision.");
        const orders = await tx.select({ id: paperOrders.id }).from(paperOrders)
          .where(and(eq(paperOrders.agentId, input.agentId), eq(paperOrders.tickId, input.decision.tickId)));
        return { decision: toDecision(storedDecision), duplicate: true, orderCount: orders.length };
      }

      const createdAt = new Date(input.decision.createdAt);
      const beforeAccount = await tx.select().from(paperAccounts).where(eq(paperAccounts.agentId, input.agentId)).limit(1);
      let positionId = portfolio.position?.id;
      if (portfolio.positionAction === "open" && portfolio.position) {
        const position = portfolio.position;
        positionId = randomUUID();
        await tx.insert(paperPositions).values({
          id: positionId,
          agentId: input.agentId,
          symbol: position.symbol,
          quantity: position.quantity,
          averageEntryUsd: position.averageEntryUsd,
          markPriceUsd: position.markPriceUsd,
          peakMarkPriceUsd: position.peakMarkPriceUsd,
          instrumentType: "modeled_option",
          optionType: "put",
          strikeUsd: position.strikeUsd,
          expiryAt: new Date(position.expiryAt),
          impliedVolatility: position.impliedVolatility,
          modelName: position.modelName,
          premiumSource: "modeled",
          modelInputs: position.modelInputs,
          openedAt: new Date(position.openedAt),
          closedAt: null,
          realizedPnlUsd: "0",
          unrealizedPnlUsd: ((Number(position.markPriceUsd) - Number(position.averageEntryUsd)) * Number(position.quantity)).toFixed(6),
          status: "open",
          updatedAt: createdAt,
        });
      } else if (portfolio.positionAction === "update" && portfolio.position) {
        const position = portfolio.position;
        const currentPositionId = position.id;
        if (!currentPositionId) throw new Error("Paper position update is missing its persisted ID.");
        await tx.update(paperPositions).set({
          markPriceUsd: position.markPriceUsd,
          peakMarkPriceUsd: position.peakMarkPriceUsd,
          impliedVolatility: position.impliedVolatility,
          modelInputs: position.modelInputs,
          unrealizedPnlUsd: ((Number(position.markPriceUsd) - Number(position.averageEntryUsd)) * Number(position.quantity)).toFixed(6),
          updatedAt: createdAt,
        }).where(and(eq(paperPositions.id, currentPositionId), eq(paperPositions.agentId, input.agentId), eq(paperPositions.status, "open")));
      } else if (portfolio.positionAction === "close" && portfolio.position) {
        const position = portfolio.position;
        const currentPositionId = position.id;
        if (!currentPositionId) throw new Error("Paper position close is missing its persisted ID.");
        const realizedDelta = Number(portfolio.account.realizedPnlUsd) - Number(beforeAccount[0]?.realizedPnlUsd ?? 0);
        await tx.update(paperPositions).set({
          markPriceUsd: position.markPriceUsd,
          peakMarkPriceUsd: position.peakMarkPriceUsd,
          impliedVolatility: position.impliedVolatility,
          unrealizedPnlUsd: "0",
          realizedPnlUsd: realizedDelta.toFixed(6),
          status: "closed",
          closedAt: createdAt,
          updatedAt: createdAt,
        }).where(and(eq(paperPositions.id, currentPositionId), eq(paperPositions.agentId, input.agentId), eq(paperPositions.status, "open")));
      }

      for (const [orderSeq, order] of ordersToPersist.entries()) {
        await tx.insert(paperOrders).values({
          agentId: input.agentId,
          decisionId: insertedDecision.id,
          orderSeq,
          positionId: positionId ?? null,
          tickId: input.decision.tickId,
          symbol: order.symbol,
          instrumentType: order.instrumentType,
          optionType: order.optionType,
          strikeUsd: order.strikeUsd,
          expiryAt: new Date(order.expiryAt),
          impliedVolatility: order.impliedVolatility,
          modelPremiumUsd: order.modelPremiumUsd,
          modelName: order.modelName,
          premiumSource: order.premiumSource,
          modelInputs: order.modelInputs,
          side: order.side,
          quantity: order.quantity,
          priceUsd: order.priceUsd,
          feeUsd: order.feeUsd,
          slippageBps: order.slippageBps,
          status: "filled",
          executionMode: "PAPER",
          createdAt,
        });
      }

      if (beforeAccount[0]) {
        await tx.update(paperAccounts).set({
          initialCapitalUsd: portfolio.account.initialCapitalUsd,
          cashUsd: portfolio.account.cashUsd,
          realizedPnlUsd: portfolio.account.realizedPnlUsd,
          peakEquityUsd: portfolio.account.peakEquityUsd,
          dailyStartEquityUsd: portfolio.account.dailyStartEquityUsd,
          dailyStartDate: portfolio.account.dailyStartDate,
          updatedAt: createdAt,
        }).where(eq(paperAccounts.agentId, input.agentId));
      } else if (Number(portfolio.account.initialCapitalUsd) > 0) {
        await tx.insert(paperAccounts).values({
          agentId: input.agentId,
          ...portfolio.account,
          updatedAt: createdAt,
        });
      }
      return { decision: toDecision(insertedDecision), duplicate: false, orderCount: ordersToPersist.length };
    });
  }

  async listTape(ownerId: string, agentId: string, limit = 100): Promise<AgentDecision[]> {
    const rows = await this.db.select({ decision: paperDecisions })
      .from(paperDecisions)
      .innerJoin(agents, eq(paperDecisions.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(paperDecisions.agentId, agentId)))
      .orderBy(desc(paperDecisions.createdAt))
      .limit(Math.max(1, Math.min(200, limit)));
    return rows.map((row) => toDecision(row.decision));
  }

  async listOrders(ownerId: string, agentId: string, limit = 100): Promise<PaperOrder[]> {
    const rows = await this.db.select({ order: paperOrders })
      .from(paperOrders)
      .innerJoin(agents, eq(paperOrders.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(paperOrders.agentId, agentId)))
      .orderBy(desc(paperOrders.createdAt))
      .limit(Math.max(1, Math.min(200, limit)));
    return rows.map((row) => toOrder(row.order));
  }

  async listPositions(ownerId: string, agentId: string): Promise<PaperPosition[]> {
    const rows = await this.db.select({ position: paperPositions })
      .from(paperPositions)
      .innerJoin(agents, eq(paperPositions.agentId, agents.id))
      .where(and(eq(agents.ownerId, ownerId), eq(paperPositions.agentId, agentId)))
      .orderBy(desc(paperPositions.updatedAt));
    return rows.map((row) => toPosition(row.position));
  }
}
