import { z } from "zod";
import {
  ApiErrorSchema,
  HookCatalogResponseSchema,
  HouseAgentTemplateCatalogResponseSchema,
  PublicAgentsResponseSchema,
  PublicHouseAgentDetailSchema,
  PublicTapeResponseSchema,
  PublicVerificationSchema,
} from "../domain/contracts";
import { getHookCatalog, getHouseAgentTemplates } from "../hooks/catalog";
import type { DrizzlePublicRepository } from "../paper/public-repository";

type PublicRepository = Pick<DrizzlePublicRepository, "listHouseAgents" | "getHouseAgent" | "listPublicTape">;

export type PublicHandlerOptions = {
  /** Omitted only by unit tests that exercise the static claims; every route passes the database-backed repository. */
  repository?: PublicRepository;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function failure(code: "NOT_FOUND" | "VALIDATION_ERROR" | "INTERNAL_ERROR", message: string, status: number): Response {
  return json(ApiErrorSchema.parse({ error: { code, message, retryable: status >= 500 } }), status);
}

const AgentIdSchema = z.uuid();

export function createPublicHandlers(options: PublicHandlerOptions = {}) {
  const repository = options.repository;

  return {
    async hooks(): Promise<Response> {
      return json(HookCatalogResponseSchema.parse(getHookCatalog()));
    },

    async templates(): Promise<Response> {
      return json(HouseAgentTemplateCatalogResponseSchema.parse(getHouseAgentTemplates()));
    },

    /** OPTRA-owned House Agents only. A user's private agent is never selected by any public query. */
    async agents(): Promise<Response> {
      try {
        const agents = repository ? await repository.listHouseAgents() : [];
        return json(PublicAgentsResponseSchema.parse({ agents, executionMode: "PAPER" }));
      } catch {
        return failure("INTERNAL_ERROR", "Unable to load the House Agents.", 500);
      }
    },

    async agent(agentIdInput: string): Promise<Response> {
      const agentId = AgentIdSchema.safeParse(agentIdInput);
      if (!agentId.success) return failure("NOT_FOUND", "House Agent was not found.", 404);
      try {
        const detail = repository ? await repository.getHouseAgent(agentId.data) : null;
        return detail ? json(PublicHouseAgentDetailSchema.parse(detail)) : failure("NOT_FOUND", "House Agent was not found.", 404);
      } catch {
        return failure("INTERNAL_ERROR", "Unable to load this House Agent.", 500);
      }
    },

    async tape(request?: Request): Promise<Response> {
      const params = request ? new URL(request.url).searchParams : new URLSearchParams();
      const limitParam = params.get("limit");
      const limit = limitParam === null ? 50 : Number(limitParam);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) return failure("VALIDATION_ERROR", "Tape limit must be an integer from 1 to 200.", 400);
      const agentParam = params.get("agentId");
      const agentId = agentParam === null ? undefined : AgentIdSchema.safeParse(agentParam);
      if (agentId && !agentId.success) return failure("VALIDATION_ERROR", "agentId must be a House Agent id.", 400);
      try {
        const tape = repository ? await repository.listPublicTape({ ...(agentId?.success ? { agentId: agentId.data } : {}), limit }) : { decisions: [], orders: [] };
        return json(PublicTapeResponseSchema.parse({ ...tape, executionMode: "PAPER" }));
      } catch {
        return failure("INTERNAL_ERROR", "Unable to load the public Tape.", 500);
      }
    },

    async verify(): Promise<Response> {
      const hooks = getHookCatalog();
      const templates = getHouseAgentTemplates().templates;
      const paperReadyCount = templates.filter((template) => template.availability === "paper_ready").length;
      let running = 0;
      let published = 0;
      if (repository) {
        try {
          const agents = await repository.listHouseAgents();
          published = agents.length;
          running = agents.filter((agent) => agent.status === "running").length;
        } catch {
          // Verify stays available: the live count is simply reported as unavailable below.
          published = -1;
        }
      }
      const implemented = hooks.definitions.filter((hook) => hook.availability === "implemented").length;
      const catalogOnly = hooks.definitions.filter((hook) => hook.availability === "catalog_only").length;
      return json(PublicVerificationSchema.parse({
        v4ClaimLevel: "L0",
        liveTradingEnabled: false,
        claims: [
          {
            id: "market_data",
            status: "limited",
            statement: "Current Robinhood Chain underlying/token quotes are read-only; verified hourly candles support paper modeling, but option venue quotes and historical option pricing are unavailable.",
            evidencePath: "/api/markets",
          },
          {
            id: "hook_catalog",
            status: hooks.coverage.sourceStatus === "available" ? "limited" : "unavailable",
            statement: `${hooks.coverage.registeredCount} PM hook entries are cataloged; ${implemented} have deterministic evaluators and ${catalogOnly} remain catalog-only.`,
            evidencePath: "/api/public/v1/hooks",
          },
          {
            id: "house_agents",
            status: paperReadyCount > 0 ? "verified" : "preview",
            statement: `${paperReadyCount} of ${templates.length} House Agent templates are paper ready.`,
            evidencePath: "/api/public/v1/templates",
          },
          {
            id: "public_house_agents",
            status: published < 0 ? "unavailable" : running > 0 ? "limited" : "preview",
            statement: published < 0
              ? "The running House Agent count is temporarily unavailable."
              : `${running} OPTRA House Agents are running in public paper mode, owned by OPTRA and excluded from any community-adoption count. Every decision is on the public Tape; premiums are modeled and no order is a venue fill.`,
            evidencePath: "/api/public/v1/agents",
          },
          {
            id: "historical_backtest",
            status: "limited",
            statement: "Paper backtests use verified hourly Robinhood Chain candles and disclosed modeled Black–Scholes premiums; a run requires 1,441 consecutive closed candles and at least one modeled entry.",
            evidencePath: "/api/backtests/coverage",
          },
          {
            id: "live_execution",
            status: "disabled",
            statement: "This build has no real-money execution path enabled.",
            evidencePath: "/api/public/v1/verify",
          },
          {
            id: "v4_claim_level",
            status: "verified",
            statement: "V4 claim level is L0; the product does not claim deployed or onchain v4 hooks.",
            evidencePath: "/api/public/v1/verify",
          },
        ],
      }));
    },
  };
}
