import { z } from "zod";
import {
  ApiErrorSchema,
  PaperPositionsResponseSchema,
  PaperTickResponseSchema,
  SessionSchema,
  TapeResponseSchema,
} from "../domain/contracts";
import type { MarketCandle, MarketSnapshot, Session } from "../domain/contracts";
import type { MarketHistoryResult } from "../market/crius-history";
import { runTick } from "../engine/run-tick";
import { runStrategyTick } from "../engine/strategy/run-strategy-tick";
import { isHouseStrategyTemplate } from "../hooks/house-specs";
import type { EarningsSnapshot } from "../market/earnings";
import { StrategyTickStateError } from "./strategy-persistence";
import { PaperTickStateError } from "./drizzle-repository";
import type { PersistTickResult, DrizzlePaperRepository } from "./drizzle-repository";

type PaperRepository = Pick<DrizzlePaperRepository, "getDecision" | "findAgent" | "persistTick" | "listTape" | "listPositions"> &
  Partial<Pick<DrizzlePaperRepository, "persistStrategyTick">> &
  Partial<Pick<DrizzlePaperRepository, "getOrderCount" | "listOrders">>;
type SessionReader = (request: Request) => Promise<Session | Response>;
type SnapshotReader = (symbol: string) => Promise<MarketSnapshot>;

export type PaperHandlerOptions = {
  repository: PaperRepository;
  readSession: SessionReader;
  getSnapshot: SnapshotReader;
  getHistory?: (symbol: string) => Promise<MarketHistoryResult>;
  getEarnings?: (symbol: string) => Promise<EarningsSnapshot | null>;
  now?: () => Date;
};

const AgentIdSchema = z.uuid();
const TickIdSchema = z.string().trim().min(1).max(128);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function error(code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "DATA_MISSING" | "INTERNAL_ERROR", message: string, status: number): Response {
  return json(ApiErrorSchema.parse({ error: { code, message, retryable: status >= 500 } }), status);
}

function sessionOrResponse(value: Session | Response): { session: Session } | { response: Response } {
  if (value instanceof Response) return { response: value };
  const parsed = SessionSchema.safeParse(value);
  return parsed.success
    ? { session: parsed.data }
    : { response: error("INTERNAL_ERROR", "Unable to validate the current wallet session.", 500) };
}

function tickResponse(result: PersistTickResult): Response {
  return json(PaperTickResponseSchema.parse({
    decision: result.decision,
    executionMode: "PAPER",
    orderCount: result.orderCount ?? 0,
    idempotentReplay: result.duplicate,
  }));
}

export function createPaperHandlers(options: PaperHandlerOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async tick(request: Request, agentIdInput: string): Promise<Response> {
      if (request.method !== "POST") return error("VALIDATION_ERROR", "Paper tick requires POST.", 405);
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;

      const agentId = AgentIdSchema.safeParse(agentIdInput);
      const idempotencyKey = TickIdSchema.safeParse(request.headers.get("idempotency-key"));
      if (!agentId.success || !idempotencyKey.success) return error("VALIDATION_ERROR", "A valid agent ID and Idempotency-Key are required.", 400);

      try {
        const ownerId = auth.session.user.id;
        const agent = await options.repository.findAgent(ownerId, agentId.data);
        if (!agent) return error("NOT_FOUND", "Paper agent was not found.", 404);
        if (agent.status !== "running") return error("CONFLICT", `Agent is ${agent.status}; only running agents can be ticked.`, 409);
        const asOfInput = new URL(request.url).searchParams.get("asOf");
        const asOfDate = asOfInput ? new Date(asOfInput) : null;
        if (asOfInput && (!asOfDate || !Number.isFinite(asOfDate.getTime()))) return error("VALIDATION_ERROR", "Historical replay requires a valid candle end timestamp.", 400);
        const occurredAt = asOfDate?.toISOString() ?? now().toISOString();
        const tickId = asOfDate ? `replay-${asOfDate.getTime()}` : idempotencyKey.data;
        const existing = await options.repository.getDecision(ownerId, agentId.data, tickId);
        if (existing) return tickResponse({ decision: existing, duplicate: true, orderCount: await options.repository.getOrderCount?.(ownerId, agentId.data, tickId) ?? 0 });

        let snapshot = null;
        let currentCandle: MarketCandle | null = null;
        const historyPromise = options.getHistory?.(agent.recipe.underlyingSymbol).catch(() => null) ?? Promise.resolve(null);
        const snapshotPromise = asOfDate ? Promise.resolve(null) : options.getSnapshot(agent.recipe.underlyingSymbol).catch(() => null);
        const [history, snapshotRead] = await Promise.all([historyPromise, snapshotPromise]);
        snapshot = snapshotRead;
        if (asOfDate && history) {
          const index = history.candles.findIndex((candle) => candle.endAt === occurredAt);
          if (index < 721) return error("DATA_MISSING", "The requested historical candle is absent or lacks the 721 preceding bars required for RV30.", 409);
          currentCandle = history.candles[index]!;
        }
        const priorCandles = history?.candles.filter((candle) => new Date(candle.endAt).getTime() <= new Date(occurredAt).getTime() && candle.endAt !== occurredAt);
        if (isHouseStrategyTemplate(agent.templateId) && options.repository.persistStrategyTick) {
          const earnings = options.getEarnings ? await options.getEarnings(agent.recipe.underlyingSymbol).catch(() => null) : null;
          const persistedStrategy = await options.repository.persistStrategyTick({
            ownerId,
            agentId: agent.id,
            tickId,
            occurredAt,
            snapshot,
            evaluate: (context) => runStrategyTick({
              agentId: context.agent.id,
              tickId,
              occurredAt,
              recipe: context.agent.recipe,
              recipeHash: context.agent.recipeHash,
              snapshot,
              currentCandle,
              ...(priorCandles ? { history: priorCandles } : {}),
              ...(history ? { corporateActionDates: history.corporateActionDates } : {}),
              earnings,
              account: context.account,
              positions: context.positions,
              state: { status: context.agent.status as "running" },
            }),
          });
          return tickResponse(persistedStrategy);
        }
        const persisted = await options.repository.persistTick({
          ownerId,
          agentId: agent.id,
          tickId,
          occurredAt,
          snapshot,
          evaluate: (context) => runTick({
            agentId: context.agent.id,
            tickId,
            occurredAt,
            recipe: context.agent.recipe,
            recipeHash: context.agent.recipeHash,
            snapshot,
            currentCandle,
            history: priorCandles,
            corporateActionDates: history?.corporateActionDates,
            account: context.account,
            position: context.position,
            state: { status: context.agent.status },
          }),
        });
        return tickResponse(persisted);
      } catch (cause) {
        if (cause instanceof PaperTickStateError || cause instanceof StrategyTickStateError) {
          return error(cause.code, cause.message, cause.code === "NOT_FOUND" ? 404 : 409);
        }
        return error("INTERNAL_ERROR", "Unable to persist this paper tick.", 500);
      }
    },

    async tape(request: Request, agentIdInput: string): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const agentId = AgentIdSchema.safeParse(agentIdInput);
      if (!agentId.success) return error("NOT_FOUND", "Paper agent was not found.", 404);

      try {
        const ownerId = auth.session.user.id;
        if (!await options.repository.findAgent(ownerId, agentId.data)) return error("NOT_FOUND", "Paper agent was not found.", 404);
        const limitParam = new URL(request.url).searchParams.get("limit");
        const limit = limitParam === null ? 100 : Number(limitParam);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) return error("VALIDATION_ERROR", "Tape limit must be an integer from 1 to 200.", 400);
        return json(TapeResponseSchema.parse({
          decisions: await options.repository.listTape(ownerId, agentId.data, limit),
          orders: await options.repository.listOrders?.(ownerId, agentId.data, limit) ?? [],
          executionMode: "PAPER",
        }));
      } catch {
        return error("INTERNAL_ERROR", "Unable to load the paper Tape.", 500);
      }
    },

    async positions(request: Request, agentIdInput: string): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const agentId = AgentIdSchema.safeParse(agentIdInput);
      if (!agentId.success) return error("NOT_FOUND", "Paper agent was not found.", 404);

      try {
        const ownerId = auth.session.user.id;
        if (!await options.repository.findAgent(ownerId, agentId.data)) return error("NOT_FOUND", "Paper agent was not found.", 404);
        return json(PaperPositionsResponseSchema.parse({ positions: await options.repository.listPositions(ownerId, agentId.data), executionMode: "PAPER" }));
      } catch {
        return error("INTERNAL_ERROR", "Unable to load paper positions.", 500);
      }
    },
  };
}
