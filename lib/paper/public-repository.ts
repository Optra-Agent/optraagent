import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  AgentDecisionSchema, BacktestRunSchema, PaperOrderSchema, PaperPositionSchema, PublicHouseAgentDetailSchema, PublicHouseAgentSchema, RecipeV1Schema,
} from "../domain/contracts";
import type { AgentDecision, PaperOrder, PaperPosition, PublicHouseAgent, PublicHouseAgentDetail } from "../domain/contracts";
import { parseStrategyMeta } from "../engine/strategy/types";
import { agents, backtestRuns, paperAccounts, paperDecisions, paperOrders, paperPositions } from "../../db/schema";

type AgentRow = typeof agents.$inferSelect;

/**
 * Public responses carry the evidence, not the raw series: a stored decision can embed the 721-candle history it read
 * (hundreds of kilobytes). The public view keeps the hash, window and observation, and drops the candle array.
 */
function publicContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context) return null;
  const { history, ...rest } = context;
  if (!Array.isArray(history)) return context;
  const first = history[0] as { startAt?: unknown } | undefined;
  const last = history.at(-1) as { endAt?: unknown } | undefined;
  return rest.historyWindow ? rest : { ...rest, historyWindow: { startAt: first?.startAt ?? null, endAt: last?.endAt ?? null, candles: history.length } };
}

function decisionOf(row: typeof paperDecisions.$inferSelect): AgentDecision {
  const marketContext = publicContext(row.marketContext);
  return AgentDecisionSchema.parse({
    id: row.id, agentId: row.agentId, tickId: row.tickId, action: row.action, reason: row.reason, hookResults: row.hookResults,
    ...(marketContext ? { marketContext } : {}), snapshotSource: row.snapshotSource, recipeHash: row.recipeHash, createdAt: row.createdAt.toISOString(),
  });
}

function positionOf(row: typeof paperPositions.$inferSelect): PaperPosition {
  const sign = row.side === "short" ? -1 : 1;
  return PaperPositionSchema.parse({
    id: row.id, agentId: row.agentId, symbol: row.symbol, quantity: row.quantity, averageEntryUsd: row.averageEntryUsd, markPriceUsd: row.markPriceUsd,
    peakMarkPriceUsd: row.peakMarkPriceUsd, instrumentType: row.instrumentType, optionType: row.optionType, side: row.side, strikeUsd: row.strikeUsd,
    expiryAt: row.expiryAt.toISOString(), impliedVolatility: row.impliedVolatility, modelName: row.modelName, premiumSource: row.premiumSource,
    modelInputs: row.modelInputs, collateralUsd: row.collateralUsd, structureId: row.structureId, legRole: row.legRole, openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null, realizedPnlUsd: row.realizedPnlUsd,
    unrealizedPnlUsd: row.status === "open" ? (sign * (Number(row.markPriceUsd) - Number(row.averageEntryUsd)) * Number(row.quantity)).toFixed(6) : "0",
    status: row.status, updatedAt: row.updatedAt.toISOString(),
  });
}

function orderOf(row: typeof paperOrders.$inferSelect): PaperOrder {
  return PaperOrderSchema.parse({
    id: row.id, agentId: row.agentId, decisionId: row.decisionId, tickId: row.tickId, symbol: row.symbol, instrumentType: row.instrumentType,
    optionType: row.optionType, strikeUsd: row.strikeUsd, expiryAt: row.expiryAt.toISOString(), impliedVolatility: row.impliedVolatility,
    modelPremiumUsd: row.modelPremiumUsd, modelName: row.modelName, premiumSource: row.premiumSource, modelInputs: row.modelInputs, side: row.side,
    quantity: row.quantity, priceUsd: row.priceUsd, feeUsd: row.feeUsd, slippageBps: row.slippageBps, status: row.status, createdAt: row.createdAt.toISOString(),
    executionMode: row.executionMode, purpose: row.purpose, legRole: row.legRole,
  });
}

function equityFrom(decision: AgentDecision | undefined, fallback: number | null): string | null {
  const derived = decision?.marketContext && typeof decision.marketContext === "object" ? (decision.marketContext as { derived?: Record<string, unknown> }).derived : undefined;
  const value = derived?.equityAfterUsd;
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  return fallback === null ? null : fallback.toFixed(2);
}

/**
 * Read-only queries for OPTRA's public House Agents. Only rows with `visibility = 'public'` and `kind = 'house'` are
 * ever selected, so a user's private agent can never reach a public route.
 */
export class DrizzlePublicRepository {
  constructor(private readonly db: AppDatabase) {}

  private async summarize(row: AgentRow): Promise<PublicHouseAgent> {
    const [latestRow] = await this.db.select().from(paperDecisions).where(eq(paperDecisions.agentId, row.id)).orderBy(desc(paperDecisions.createdAt)).limit(1);
    const [counted] = await this.db.select({ value: count() }).from(paperDecisions).where(eq(paperDecisions.agentId, row.id));
    const openRows = await this.db.select().from(paperPositions).where(and(eq(paperPositions.agentId, row.id), eq(paperPositions.status, "open")));
    const [account] = await this.db.select().from(paperAccounts).where(eq(paperAccounts.agentId, row.id)).limit(1);
    const [run] = row.backtestRunId ? await this.db.select().from(backtestRuns).where(eq(backtestRuns.id, row.backtestRunId)).limit(1) : [];
    const latest = latestRow ? decisionOf(latestRow) : undefined;
    const marks = openRows.reduce((total, position) => total + (position.side === "short" ? -1 : 1) * Number(position.markPriceUsd) * Number(position.quantity), 0);
    const locked = openRows.filter((position) => position.side === "short" && position.optionType === "put").reduce((total, position) => total + Number(position.collateralUsd), 0);
    const metrics = run?.metrics ?? null;
    return PublicHouseAgentSchema.parse({
      id: row.id,
      name: row.name,
      templateId: row.templateId,
      underlyingSymbol: row.recipe.underlyingSymbol,
      status: row.status,
      recipeHash: row.recipeHash,
      by: "Optra",
      executionMode: "PAPER",
      launchedAt: row.launchedAt?.toISOString() ?? null,
      latestDecision: latest ? { id: latest.id, action: latest.action, reason: latest.reason, createdAt: latest.createdAt } : null,
      decisionCount: counted?.value ?? 0,
      openPositions: openRows.length,
      account: account ? {
        initialCapitalUsd: account.initialCapitalUsd,
        cashUsd: account.cashUsd,
        realizedPnlUsd: account.realizedPnlUsd,
        equityUsd: equityFrom(latest, row.templateId === "protective_put" ? Number(account.cashUsd) + marks : null),
        lockedCollateralUsd: locked.toFixed(2),
      } : null,
      backtest: run && metrics ? {
        id: run.id,
        totalReturnPct: metrics.totalReturnPct,
        vsHoldingPct: metrics.benchmarks?.vsHoldingPct ?? null,
        vsCashPct: metrics.benchmarks?.vsCashPct ?? null,
        maxDrawdownPct: metrics.maxDrawdownPct,
        premiumSource: run.premiumSource,
        startAt: run.startAt.toISOString(),
        endAt: run.endAt.toISOString(),
      } : null,
    });
  }

  async listHouseAgents(): Promise<PublicHouseAgent[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.kind, "house"), eq(agents.visibility, "public"), inArray(agents.status, ["running", "paused", "stopped"])))
      .orderBy(agents.createdAt);
    // Retired recipe versions are hidden: one current version per House Agent.
    const current = rows.filter((row) => row.status !== "stopped" || !rows.some((other) => other.houseKey === row.houseKey && other.id !== row.id && other.status !== "stopped"));
    return Promise.all(current.map((row) => this.summarize(row)));
  }

  private async publicAgent(agentId: string): Promise<AgentRow | null> {
    const [row] = await this.db.select().from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.kind, "house"), eq(agents.visibility, "public"))).limit(1);
    return row ?? null;
  }

  async getHouseAgent(agentId: string, limit = 50): Promise<PublicHouseAgentDetail | null> {
    const row = await this.publicAgent(agentId);
    if (!row) return null;
    const summary = await this.summarize(row);
    const decisions = await this.db.select().from(paperDecisions).where(eq(paperDecisions.agentId, row.id)).orderBy(desc(paperDecisions.createdAt)).limit(limit);
    const orders = await this.db.select().from(paperOrders).where(eq(paperOrders.agentId, row.id)).orderBy(desc(paperOrders.createdAt)).limit(limit);
    const positions = await this.db.select().from(paperPositions).where(eq(paperPositions.agentId, row.id)).orderBy(desc(paperPositions.updatedAt)).limit(100);
    const [account] = await this.db.select().from(paperAccounts).where(eq(paperAccounts.agentId, row.id)).limit(1);
    const [run] = row.backtestRunId ? await this.db.select().from(backtestRuns).where(eq(backtestRuns.id, row.backtestRunId)).limit(1) : [];
    const meta = account ? parseStrategyMeta(account.meta) : null;
    const isStrategy = row.templateId !== "protective_put";
    return PublicHouseAgentDetailSchema.parse({
      ...summary,
      recipe: RecipeV1Schema.parse(row.recipe),
      positions: positions.map(positionOf),
      orders: orders.map(orderOf),
      decisions: decisions.map(decisionOf),
      strategy: isStrategy && meta ? {
        entries: meta.entries, closes: meta.closes, winningCloses: meta.winningCloses, rolls: meta.rolls, settledItm: meta.settledItm, settledOtm: meta.settledOtm,
        premiumCollectedUsd: meta.premiumCollectedUsd, premiumPaidUsd: meta.premiumPaidUsd, worstTradeUsd: meta.worstTradeUsd, referenceShares: meta.referenceShares,
        tradedEarnings: meta.tradedEarnings,
      } : null,
      backtestRun: run ? BacktestRunSchema.parse({
        id: run.id, recipeHash: run.recipeHash, dataSource: run.dataSource, startAt: run.startAt.toISOString(), endAt: run.endAt.toISOString(), sampleCount: run.sampleCount,
        entryOrderCount: run.entryOrderCount, exitOrderCount: run.exitOrderCount, hourlyCoverageComplete: run.hourlyCoverageComplete, premiumSource: run.premiumSource,
        pricingMethod: run.pricingMethod, status: run.status, metrics: run.metrics,
        ...(run.historyDataHash ? { historyDataHash: run.historyDataHash } : {}), ...(run.historyProvenance ? { historyProvenance: run.historyProvenance } : {}),
        ...(run.pricingAssumptions ? { pricingAssumptions: run.pricingAssumptions } : {}), reason: run.reason, createdAt: run.createdAt.toISOString(),
      }) : null,
    });
  }

  /** How many decisions the public House Agents have persisted, and when the latest was recorded. */
  async tapeStats(): Promise<{ decisions: number; latestAt: string | null }> {
    const [row] = await this.db.select({ decisions: count(), latestAt: max(paperDecisions.createdAt) }).from(paperDecisions)
      .innerJoin(agents, eq(paperDecisions.agentId, agents.id)).where(and(eq(agents.kind, "house"), eq(agents.visibility, "public")));
    return { decisions: row?.decisions ?? 0, latestAt: row?.latestAt ? row.latestAt.toISOString() : null };
  }

  /** The newest public decisions across every House Agent, or one agent's, with the agent's name for the Tape row. */
  async listPublicTape(options: { agentId?: string; limit: number }): Promise<{ decisions: Array<AgentDecision & { agentName: string; underlyingSymbol: string; templateId: AgentRow["templateId"] }>; orders: PaperOrder[] }> {
    const filter = and(eq(agents.kind, "house"), eq(agents.visibility, "public"), ...(options.agentId ? [eq(agents.id, options.agentId)] : []));
    const rows = await this.db.select({ decision: paperDecisions, agent: agents }).from(paperDecisions)
      .innerJoin(agents, eq(paperDecisions.agentId, agents.id)).where(filter).orderBy(desc(paperDecisions.createdAt)).limit(options.limit);
    const orderRows = await this.db.select({ order: paperOrders }).from(paperOrders)
      .innerJoin(agents, eq(paperOrders.agentId, agents.id)).where(filter).orderBy(desc(paperOrders.createdAt)).limit(options.limit);
    return {
      decisions: rows.map((row) => ({ ...decisionOf(row.decision), agentName: row.agent.name, underlyingSymbol: row.agent.recipe.underlyingSymbol, templateId: row.agent.templateId })),
      orders: orderRows.map((row) => orderOf(row.order)),
    };
  }
}
