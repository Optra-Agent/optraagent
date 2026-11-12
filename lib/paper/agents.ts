import {
  AgentCreateInputSchema,
  AgentDetailSchema,
  AgentForkInputSchema,
  AgentLifecycleInputSchema,
  AgentListResponseSchema,
  ApiErrorSchema,
  RecipeV1Schema,
  SessionSchema,
} from "../domain/contracts";
import type { Agent, Session } from "../domain/contracts";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";
import type { DrizzleBacktestRepository } from "../backtest/drizzle-repository";
import type { DrizzlePaperRepository } from "./drizzle-repository";

type AgentRepository = Pick<DrizzlePaperRepository, "createAgent" | "findAgent" | "listAgents" | "transitionAgent">;
type BacktestRepository = Pick<DrizzleBacktestRepository, "getBacktestRun">;

export type AgentHandlerOptions = {
  repository: AgentRepository;
  backtests: BacktestRepository;
  readSession: (request: Request) => Promise<Session | Response>;
  now?: () => Date;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function error(
  code: "UNAUTHORIZED" | "NOT_FOUND" | "VALIDATION_ERROR" | "UNSUPPORTED_HOOK" | "BACKTEST_REQUIRED" | "CONFLICT" | "INTERNAL_ERROR",
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  return json(ApiErrorSchema.parse({ error: { code, message, retryable: status >= 500, ...(details ? { details } : {}) } }), status);
}

function sessionOrResponse(value: Session | Response): { session: Session } | { response: Response } {
  if (value instanceof Response) return { response: value };
  const parsed = SessionSchema.safeParse(value);
  return parsed.success
    ? { session: parsed.data }
    : { response: error("INTERNAL_ERROR", "Unable to validate the current wallet session.", 500) };
}

function readBody(request: Request): Promise<unknown | null> {
  return request.json().catch(() => null);
}

function toSummary(agent: Awaited<ReturnType<AgentRepository["findAgent"]>>): Agent | null {
  if (!agent) return null;
  return {
    id: agent.id,
    ownerId: agent.ownerId,
    name: agent.name,
    templateId: agent.templateId,
    status: agent.status,
    recipeHash: agent.recipeHash,
    backtestRunId: agent.backtestRunId,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function hasValidResumeProof(agent: NonNullable<Awaited<ReturnType<AgentRepository["findAgent"]>>>, run: Awaited<ReturnType<BacktestRepository["getBacktestRun"]>>): boolean {
  return Boolean(
    run && agent.backtestRunId === run.id && agent.recipeHash === run.recipeHash && run.status === "complete" &&
    run.sampleCount >= 720 && run.hourlyCoverageComplete && run.metrics !== null &&
    run.historyDataHash !== undefined && run.historyProvenance !== undefined && run.pricingAssumptions !== undefined && (run.entryOrderCount ?? 0) >= 1 &&
    run.premiumSource !== "unavailable" && run.pricingMethod !== "unavailable",
  );
}

function summarizeIssues(issues: ReturnType<typeof validateRecipe>["issues"]): Record<string, unknown> {
  return { issues };
}

export function createAgentHandlers(options: AgentHandlerOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async list(request: Request): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      try {
        const rows = await options.repository.listAgents(auth.session.user.id);
        const agents = rows.map((agent) => toSummary(agent)).filter((agent): agent is Agent => agent !== null);
        return json(AgentListResponseSchema.parse({ agents }));
      } catch {
        return error("INTERNAL_ERROR", "Unable to load wallet agents.", 500);
      }
    },

    async create(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const body = AgentCreateInputSchema.safeParse(await readBody(request));
      if (!body.success) return error("VALIDATION_ERROR", "A RecipeV1 JSON body is required.", 400);

      const validation = validateRecipe(body.data.recipe);
      if (!validation.valid || !validation.recipeHash) {
        return error("UNSUPPORTED_HOOK", "This recipe cannot be saved until every hook has a verified evaluator.", 422, summarizeIssues(validation.issues));
      }

      try {
        const created = await options.repository.createAgent({
          ownerId: auth.session.user.id,
          name: body.data.recipe.name,
          templateId: body.data.recipe.templateId,
          status: "draft",
          recipe: body.data.recipe,
          recipeHash: validation.recipeHash,
          createdAt: now(),
        });
        return json(AgentDetailSchema.parse(created), 201);
      } catch {
        return error("INTERNAL_ERROR", "Unable to save the paper agent draft.", 500);
      }
    },

    async detail(request: Request, agentId: string): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      try {
        const agent = await options.repository.findAgent(auth.session.user.id, agentId);
        return agent ? json(AgentDetailSchema.parse(agent)) : error("NOT_FOUND", "Paper agent was not found.", 404);
      } catch {
        return error("INTERNAL_ERROR", "Unable to load this paper agent.", 500);
      }
    },

    async lifecycle(request: Request, agentId: string): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const body = AgentLifecycleInputSchema.safeParse(await readBody(request));
      if (!body.success) return error("VALIDATION_ERROR", "Choose pause, resume, or stop.", 400);

      try {
        const ownerId = auth.session.user.id;
        const agent = await options.repository.findAgent(ownerId, agentId);
        if (!agent) return error("NOT_FOUND", "Paper agent was not found.", 404);
        const action = body.data.action;
        if (action === "stop" && agent.status === "stopped") return json(AgentDetailSchema.parse(agent));

        let targetStatus: Agent["status"];
        if (action === "pause" && agent.status === "running") targetStatus = "paused";
        else if (action === "resume" && agent.status === "paused") {
          const run = agent.backtestRunId ? await options.backtests.getBacktestRun(ownerId, agent.backtestRunId) : null;
          if (!hasValidResumeProof(agent, run)) {
            return error("BACKTEST_REQUIRED", "This agent cannot resume without its complete, matching paper backtest.", 409);
          }
          targetStatus = "running";
        } else if (action === "stop" && agent.status !== "stopped") targetStatus = "stopped";
        else return error("CONFLICT", `Cannot ${action} an agent that is ${agent.status}.`, 409);

        const updated = await options.repository.transitionAgent(ownerId, agent.id, agent.status, targetStatus, now());
        return updated
          ? json(AgentDetailSchema.parse(updated))
          : error("CONFLICT", "Agent state changed before the lifecycle action completed.", 409);
      } catch {
        return error("INTERNAL_ERROR", "Unable to change this paper agent's state.", 500);
      }
    },

    async fork(request: Request, agentId: string): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = sessionOrResponse(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const body = AgentForkInputSchema.safeParse(await readBody(request));
      if (!body.success) return error("VALIDATION_ERROR", "Fork name must be 1 to 80 characters.", 400);

      try {
        const ownerId = auth.session.user.id;
        const source = await options.repository.findAgent(ownerId, agentId);
        if (!source) return error("NOT_FOUND", "Paper agent was not found.", 404);
        const defaultName = `${source.name.slice(0, 74)} (fork)`;
        const name = body.data.name ?? defaultName;
        if (name === source.recipe.name) return error("VALIDATION_ERROR", "Choose a new name to create a distinct recipe version.", 400);
        const recipe = RecipeV1Schema.parse({ ...source.recipe, name });
        const recipeHash = canonicalRecipeHash(recipe);
        if (recipeHash === canonicalRecipeHash(source.recipe)) return error("VALIDATION_ERROR", "Fork must create a distinct recipe version.", 400);
        const forked = await options.repository.createAgent({
          ownerId,
          name,
          templateId: recipe.templateId,
          status: "draft",
          recipe,
          recipeHash,
          createdAt: now(),
        });
        return json(AgentDetailSchema.parse(forked), 201);
      } catch {
        return error("INTERNAL_ERROR", "Unable to fork this paper agent.", 500);
      }
    },
  };
}
