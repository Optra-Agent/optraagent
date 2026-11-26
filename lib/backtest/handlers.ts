import { z } from "zod";
import {
  AgentSchema,
  ApiErrorSchema,
  BacktestCoverageSchema,
  BacktestRunSchema,
  RecipeV1Schema,
  SessionSchema,
} from "../domain/contracts";
import type { Session } from "../domain/contracts";
import { evaluatePaperLaunch } from "./launch-gate";
import { inspectCandleCoverage, inspectHourlyCoverage, runBacktest } from "./run";
import type { DrizzleBacktestRepository } from "./drizzle-repository";
import type { DrizzlePaperRepository } from "../paper/drizzle-repository";
import type { MarketHistoryResult } from "../market/crius-history";
import type { EarningsSnapshot } from "../market/earnings";
import { isHouseStrategyTemplate } from "../hooks/house-specs";

type BacktestRepository = Pick<DrizzleBacktestRepository, "listHourlySnapshots" | "createBacktestRun" | "getBacktestRun" | "launchAgent">;
type AgentRepository = Pick<DrizzlePaperRepository, "findAgent">;

export type BacktestHandlerOptions = {
  repository: BacktestRepository;
  agents: AgentRepository;
  readSession: (request: Request) => Promise<Session | Response>;
  listMarkets: () => Promise<Array<{ symbol: string }>>;
  getHistory?: (symbol: string) => Promise<MarketHistoryResult>;
  getEarnings?: (symbol: string) => Promise<EarningsSnapshot | null>;
  now?: () => Date;
  newRunId: () => string;
};

const SymbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,16}$/);
const AgentIdSchema = z.uuid();
const LaunchInputSchema = z.object({ backtestRunId: z.uuid() }).strict();

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function error(
  code: "UNAUTHORIZED" | "DATA_MISSING" | "BACKTEST_REQUIRED" | "CONFLICT" | "VALIDATION_ERROR" | "NOT_FOUND" | "UPSTREAM_UNAVAILABLE" | "INTERNAL_ERROR",
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  return json(ApiErrorSchema.parse({ error: { code, message, retryable: status >= 500, ...(details ? { details } : {}) } }), status);
}

function sessionOrResponse(value: Session | Response): { session: Session } | { response: Response } {
  if (value instanceof Response) return { response: value };
  const parsed = SessionSchema.safeParse(value);
  return parsed.success ? { session: parsed.data } : { response: error("INTERNAL_ERROR", "Unable to validate the current session.", 500) };
}

async function readBody(request: Request): Promise<unknown | null> {
  try { return await request.json(); } catch { return null; }
}

export function createBacktestHandlers(options: BacktestHandlerOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async coverage(request: Request): Promise<Response> {
      const symbol = SymbolSchema.safeParse(new URL(request.url).searchParams.get("symbol") ?? "");
      if (!symbol.success) return error("VALIDATION_ERROR", "A supported market symbol is required.", 400);
      try {
        const markets = await options.listMarkets();
        if (!markets.some((market) => market.symbol === symbol.data)) return error("DATA_MISSING", `No active market is available for ${symbol.data}.`, 404);
        if (options.getHistory) {
          const history = await options.getHistory(symbol.data);
          if (history.providerError) return error("UPSTREAM_UNAVAILABLE", history.providerError, 503);
          const currentTime = now().toISOString();
          return json(BacktestCoverageSchema.parse(inspectCandleCoverage({ symbol: symbol.data, candles: history.candles, now: currentTime })));
        }
        const currentTime = now().toISOString();
        const snapshots = await options.repository.listHourlySnapshots(symbol.data);
        return json(BacktestCoverageSchema.parse(inspectHourlyCoverage({ symbol: symbol.data, snapshots, now: currentTime })));
      } catch {
        return error("UPSTREAM_UNAVAILABLE", "Hourly market history is temporarily unavailable.", 503);
      }
    },

    async create(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;

      const body = await readBody(request);
      const recipeInput = typeof body === "object" && body !== null ? (body as Record<string, unknown>).recipe : undefined;
      const recipe = RecipeV1Schema.safeParse(recipeInput);
      if (!recipe.success) return error("VALIDATION_ERROR", "A valid RecipeV1 is required for a backtest.", 400);

      try {
        const markets = await options.listMarkets();
        if (!markets.some((market) => market.symbol === recipe.data.underlyingSymbol)) {
          return error("DATA_MISSING", `No active market is available for ${recipe.data.underlyingSymbol}.`, 404);
        }
        const history = options.getHistory ? await options.getHistory(recipe.data.underlyingSymbol) : null;
        if (history?.providerError) return error("UPSTREAM_UNAVAILABLE", history.providerError, 503);
        let earnings: EarningsSnapshot | null = null;
        if (isHouseStrategyTemplate(recipe.data.templateId)) {
          if (!options.getEarnings) return error("UPSTREAM_UNAVAILABLE", "Earnings history is not configured for this House backtest.", 503);
          try {
            earnings = await options.getEarnings(recipe.data.underlyingSymbol);
          } catch {
            return error("UPSTREAM_UNAVAILABLE", "Earnings history is temporarily unavailable. No backtest was recorded.", 503);
          }
          if (!earnings) return error("UPSTREAM_UNAVAILABLE", "Earnings history is temporarily unavailable. No backtest was recorded.", 503);
        }
        const currentTime = now().toISOString();
        const run = runBacktest({
          runId: options.newRunId(),
          recipe: recipe.data,
          candles: history?.candles ?? [],
          corporateActionDates: history?.corporateActionDates ?? [],
          earnings,
          requestedCandles: history?.coverage.requestedCandles,
          now: currentTime,
        });
        const persisted = await options.repository.createBacktestRun(auth.session.user.id, recipe.data, run, history?.candles ?? []);
        return json(BacktestRunSchema.parse(persisted), 201);
      } catch {
        return error("INTERNAL_ERROR", "Unable to create the backtest record.", 500);
      }
    },

    async launch(request: Request, agentIdInput: string): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const agentId = AgentIdSchema.safeParse(agentIdInput);
      const body = LaunchInputSchema.safeParse(await readBody(request));
      if (!agentId.success || !body.success) return error("VALIDATION_ERROR", "A valid agent ID and backtest run ID are required.", 400);

      try {
        const ownerId = auth.session.user.id;
        const agent = await options.agents.findAgent(ownerId, agentId.data);
        if (!agent) return error("NOT_FOUND", "Paper agent was not found.", 404);
        if (agent.status !== "draft") return error("CONFLICT", "Only a draft agent can be launched.", 409);
        const backtest = await options.repository.getBacktestRun(ownerId, body.data.backtestRunId);
        const eligibility = evaluatePaperLaunch({ recipe: agent.recipe, recipeHash: agent.recipeHash, backtest });
        if (!eligibility.allowed) {
          return error("BACKTEST_REQUIRED", "A complete, matching, verified backtest is required before paper launch.", 409, { reasons: eligibility.reasons });
        }
        const launchedAt = now();
        const updated = await options.repository.launchAgent(ownerId, agent.id, body.data.backtestRunId, agent.recipeHash, launchedAt);
        if (!updated) return error("CONFLICT", "Agent state changed before paper launch completed.", 409);
        return json(AgentSchema.parse({
          id: agent.id,
          ownerId: agent.ownerId,
          name: agent.name,
          templateId: agent.templateId,
          status: "running",
          recipeHash: agent.recipeHash,
          backtestRunId: body.data.backtestRunId,
          createdAt: agent.createdAt,
          updatedAt: launchedAt.toISOString(),
        }));
      } catch {
        return error("INTERNAL_ERROR", "Unable to launch the paper agent.", 500);
      }
    },
  };
}
