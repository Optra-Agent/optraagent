import { timingSafeEqual } from "node:crypto";
import { MarketCandleSchema } from "../domain/contracts";
import type { AgentDecision, MarketCandle } from "../domain/contracts";
import { runTick } from "../engine/run-tick";
import { runStrategyTick } from "../engine/strategy/run-strategy-tick";
import { isHouseStrategyTemplate } from "../hooks/house-specs";
import type { EarningsSnapshot } from "../market/earnings";
import { isRegularEquitySession } from "../engine/us-market-session";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";
import type { MarketHistoryResult } from "../market/crius-history";
import { PaperTickStateError } from "./drizzle-repository";
import { StrategyTickStateError } from "./strategy-persistence";
import type { DrizzlePaperRepository } from "./drizzle-repository";

const HOUR_MS = 60 * 60 * 1000;
const FINALIZATION_GRACE_MS = 5 * 60 * 1000;
const MAX_CANDLE_AGE_MS = 2 * HOUR_MS;
const REQUIRED_PRIOR_CANDLES = 721;

type SchedulerLock = { release: () => Promise<void> };
type SchedulerRepository = Pick<DrizzlePaperRepository, "listRunningAgents" | "listTape" | "persistTick" | "persistStrategyTick">;
type SchedulerLog = (entry: Record<string, unknown>) => void;

export type PaperSchedulerOptions = {
  repository: SchedulerRepository;
  secret?: string;
  getHistory: (symbol: string) => Promise<MarketHistoryResult>;
  /** Earnings calendar for the strategy templates that read it. A rejection or null is recorded as missing data, never guessed. */
  getEarnings?: (symbol: string) => Promise<EarningsSnapshot | null>;
  acquireLock: () => Promise<SchedulerLock | null>;
  now?: () => Date;
  log?: SchedulerLog;
  finalizationGraceMs?: number;
  maxCandleAgeMs?: number;
};

type SchedulerSummary = {
  status: "complete" | "partial";
  agentsConsidered: number;
  evaluated: number;
  opened: number;
  skipped: number;
  duplicates: number;
  deferred: number;
  failures: number;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function matchesBearerToken(header: string | null, secret: string): boolean {
  if (!header) return false;
  const separator = header.indexOf(" ");
  if (separator < 1 || header.slice(0, separator).toLowerCase() !== "bearer") return false;
  const candidate = Buffer.from(header.slice(separator + 1));
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function hasValidPaperSchedulerCredential(request: Request, secret: string | undefined): boolean {
  return Boolean(secret?.trim() && matchesBearerToken(request.headers.get("authorization"), secret));
}

function safeMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Unknown scheduler failure.";
  return cause.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[DATABASE_URL]").slice(0, 240);
}

function emit(log: SchedulerLog, entry: Record<string, unknown>): void {
  try {
    log(entry);
  } catch {
    // Logging failure must not change paper execution behavior.
  }
}

function validCandle(value: MarketCandle, symbol: string, nowMs: number): boolean {
  const parsed = MarketCandleSchema.safeParse(value);
  if (!parsed.success) return false;
  const candle = parsed.data;
  const startMs = Date.parse(candle.startAt);
  const endMs = Date.parse(candle.endAt);
  const receivedMs = Date.parse(candle.receivedAt);
  return candle.symbol === symbol &&
    candle.source === "crius_robinhood_chain_candles" &&
    candle.interval === "1h" &&
    candle.multiplierStatus === "stable_verified" &&
    !candle.filled &&
    candle.tradeCount > 0 &&
    Number(candle.shareCloseUsd) > 0 &&
    endMs - startMs === HOUR_MS &&
    receivedMs <= nowMs;
}

function completeEvaluationWindow(candles: MarketCandle[], index: number, symbol: string, nowMs: number): boolean {
  if (index < REQUIRED_PRIOR_CANDLES) return false;
  const window = candles.slice(index - REQUIRED_PRIOR_CANDLES, index + 1);
  if (window.length !== REQUIRED_PRIOR_CANDLES + 1 || !window.every((candle) => validCandle(candle, symbol, nowMs))) return false;
  for (let position = 1; position < window.length; position += 1) {
    if (window[position - 1]!.endAt !== window[position]!.startAt) return false;
  }
  return true;
}

function blankSummary(): SchedulerSummary {
  return { status: "complete", agentsConsidered: 0, evaluated: 0, opened: 0, skipped: 0, duplicates: 0, deferred: 0, failures: 0 };
}

function tickIdFor(candle: MarketCandle): string {
  return `replay-${Date.parse(candle.endAt)}`;
}

export function createPaperScheduler(options: PaperSchedulerOptions) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((entry) => console.info(JSON.stringify(entry)));
  const finalizationGraceMs = options.finalizationGraceMs ?? FINALIZATION_GRACE_MS;
  const maxCandleAgeMs = options.maxCandleAgeMs ?? MAX_CANDLE_AGE_MS;

  return {
    async run(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      if (!options.secret?.trim()) {
        return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "CRON_SECRET is required for scheduled paper evaluation.", retryable: true } }, 503);
      }
      if (!hasValidPaperSchedulerCredential(request, options.secret)) {
        return json({ error: { code: "UNAUTHORIZED", message: "A valid scheduler credential is required.", retryable: false } }, 401);
      }
      return execute();
    },

    /** The same evaluation without an HTTP credential, for the in-process scheduler only. It is never reachable over HTTP. */
    async runInProcess(): Promise<Response> {
      return execute();
    },
  };

  async function execute(): Promise<Response> {
    {
      let lock: SchedulerLock | null;
      try {
        lock = await options.acquireLock();
      } catch (cause) {
        emit(log, { event: "paper_scheduler.lock_failed", message: safeMessage(cause) });
        return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The paper scheduler could not acquire its PostgreSQL lock.", retryable: true } }, 503);
      }
      if (!lock) {
        emit(log, { event: "paper_scheduler.overlap_skipped" });
        return json({ status: "already_running" }, 202);
      }

      const startedAt = now();
      const startedAtMs = startedAt.getTime();
      const summary = blankSummary();
      const historyCache = new Map<string, Promise<MarketHistoryResult>>();
      const getHistory = (symbol: string): Promise<MarketHistoryResult> => {
        let pending = historyCache.get(symbol);
        if (!pending) {
          pending = options.getHistory(symbol);
          historyCache.set(symbol, pending);
        }
        return pending;
      };

      const earningsCache = new Map<string, Promise<EarningsSnapshot | null>>();
      const getEarnings = (symbol: string): Promise<EarningsSnapshot | null> => {
        let pending = earningsCache.get(symbol);
        if (!pending) {
          pending = (options.getEarnings?.(symbol) ?? Promise.resolve(null)).catch(() => null);
          earningsCache.set(symbol, pending);
        }
        return pending;
      };

      try {
        const agents = await options.repository.listRunningAgents();
        summary.agentsConsidered = agents.length;

        for (const agent of agents) {
          const symbol = agent.recipe.underlyingSymbol;
          if (agent.status !== "running" || agent.templateId !== agent.recipe.templateId || !validateRecipe(agent.recipe).valid || canonicalRecipeHash(agent.recipe) !== agent.recipeHash) {
            summary.deferred += 1;
            emit(log, { event: "paper_scheduler.agent_deferred", agentId: agent.id, symbol, reason: "agent_not_supported_or_recipe_invalid" });
            continue;
          }

          let history: MarketHistoryResult;
          let latest: AgentDecision[];
          let earnings: EarningsSnapshot | null = null;
          const strategyAgent = isHouseStrategyTemplate(agent.templateId);
          try {
            [history, latest, earnings] = await Promise.all([
              getHistory(symbol),
              options.repository.listTape(agent.ownerId, agent.id, 1),
              strategyAgent ? getEarnings(symbol) : Promise.resolve(null),
            ]);
          } catch (cause) {
            summary.failures += 1;
            emit(log, { event: "paper_scheduler.agent_failed", agentId: agent.id, symbol, stage: "market_data", message: safeMessage(cause) });
            continue;
          }

          if (
            history.coverage.symbol !== symbol ||
            history.coverage.source !== "crius_robinhood_chain_candles" ||
            history.coverage.multiplierStatus !== "stable_verified" ||
            history.coverage.fillApplied
          ) {
            summary.deferred += 1;
            emit(log, { event: "paper_scheduler.agent_deferred", agentId: agent.id, symbol, reason: "market_history_provenance_unverified" });
            continue;
          }

          const latestDecisionAt = latest[0] ? Date.parse(latest[0].createdAt) : Number.NEGATIVE_INFINITY;
          const agentActivatedAt = Date.parse(agent.updatedAt);
          const lastProcessedAt = Math.max(latestDecisionAt, agentActivatedAt);
          if (!Number.isFinite(lastProcessedAt)) {
            summary.deferred += 1;
            emit(log, { event: "paper_scheduler.agent_deferred", agentId: agent.id, symbol, reason: "agent_timeline_invalid" });
            continue;
          }

          const candles = history.candles;
          let invalidWindowReported = false;
          let staleCandleReported = false;
          for (let index = 0; index < candles.length; index += 1) {
            const candle = candles[index]!;
            const endMs = Date.parse(candle.endAt);
            if (!Number.isFinite(endMs) || endMs <= lastProcessedAt || !isRegularEquitySession(candle.endAt)) continue;
            if (endMs > startedAtMs - finalizationGraceMs) continue;
            if (startedAtMs - endMs > maxCandleAgeMs) {
              if (!staleCandleReported) {
                summary.deferred += 1;
                staleCandleReported = true;
                emit(log, { event: "paper_scheduler.agent_deferred", agentId: agent.id, symbol, candleEndAt: candle.endAt, reason: "finalized_candle_stale" });
              }
              continue;
            }
            if (!validCandle(candle, symbol, startedAtMs) || !completeEvaluationWindow(candles, index, symbol, startedAtMs)) {
              if (!invalidWindowReported) {
                summary.deferred += 1;
                invalidWindowReported = true;
                emit(log, { event: "paper_scheduler.agent_deferred", agentId: agent.id, symbol, candleEndAt: candle.endAt, reason: "hourly_history_incomplete_or_invalid" });
              }
              continue;
            }

            const tickId = tickIdFor(candle);
            try {
              const priorCandles = candles.slice(0, index);
              const result = strategyAgent
                ? await options.repository.persistStrategyTick({
                  ownerId: agent.ownerId,
                  agentId: agent.id,
                  tickId,
                  occurredAt: candle.endAt,
                  snapshot: null,
                  evaluate: (context) => runStrategyTick({
                    agentId: context.agent.id,
                    tickId,
                    occurredAt: candle.endAt,
                    recipe: context.agent.recipe,
                    recipeHash: context.agent.recipeHash,
                    snapshot: null,
                    currentCandle: candle,
                    history: priorCandles,
                    corporateActionDates: history.corporateActionDates,
                    earnings,
                    account: context.account,
                    positions: context.positions,
                    state: { status: context.agent.status as "running" },
                  }),
                })
                : await options.repository.persistTick({
                ownerId: agent.ownerId,
                agentId: agent.id,
                tickId,
                occurredAt: candle.endAt,
                snapshot: null,
                evaluate: (context) => runTick({
                  agentId: context.agent.id,
                  tickId,
                  occurredAt: candle.endAt,
                  recipe: context.agent.recipe,
                  recipeHash: context.agent.recipeHash,
                  snapshot: null,
                  currentCandle: candle,
                  history: candles.slice(Math.max(0, index - REQUIRED_PRIOR_CANDLES), index),
                  corporateActionDates: history.corporateActionDates,
                  account: context.account,
                  position: context.position,
                  state: { status: context.agent.status },
                }),
              });

              if (result.duplicate) {
                summary.duplicates += 1;
              } else {
                summary.evaluated += 1;
                if (result.decision.action === "open") summary.opened += 1;
                if (result.decision.action === "skip") summary.skipped += 1;
              }
              emit(log, {
                event: "paper_scheduler.candle_evaluated",
                agentId: agent.id,
                symbol,
                candleEndAt: candle.endAt,
                action: result.decision.action,
                orderCount: result.orderCount ?? 0,
                duplicate: result.duplicate,
              });
            } catch (cause) {
              if (cause instanceof PaperTickStateError || cause instanceof StrategyTickStateError) {
                summary.deferred += 1;
                emit(log, { event: "paper_scheduler.agent_deferred", agentId: agent.id, symbol, candleEndAt: candle.endAt, reason: "agent_lifecycle_changed" });
                break;
              }
              summary.failures += 1;
              emit(log, { event: "paper_scheduler.agent_failed", agentId: agent.id, symbol, candleEndAt: candle.endAt, stage: "persist_tick", message: safeMessage(cause) });
              break;
            }
          }
        }
      } catch (cause) {
        summary.failures += 1;
        emit(log, { event: "paper_scheduler.run_failed", message: safeMessage(cause) });
      } finally {
        try {
          await lock.release();
        } catch (cause) {
          summary.failures += 1;
          emit(log, { event: "paper_scheduler.lock_release_failed", message: safeMessage(cause) });
        }
      }

      summary.status = summary.failures > 0 ? "partial" : "complete";
      emit(log, { event: "paper_scheduler.run_completed", ...summary, durationMs: Math.max(0, now().getTime() - startedAtMs) });
      return json(summary, summary.failures > 0 ? 503 : 200);
    }
  }
}
