import {
  HookCatalogResponseSchema,
  HouseAgentTemplateCatalogResponseSchema,
  PublicAgentsResponseSchema,
  PublicTapeResponseSchema,
  PublicVerificationSchema,
} from "../domain/contracts";
import { getHookCatalog, getHouseAgentTemplates } from "../hooks/catalog";

function json(body: unknown): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

export function createPublicHandlers() {
  return {
    async hooks(): Promise<Response> {
      return json(HookCatalogResponseSchema.parse(getHookCatalog()));
    },

    async templates(): Promise<Response> {
      return json(HouseAgentTemplateCatalogResponseSchema.parse(getHouseAgentTemplates()));
    },

    async agents(): Promise<Response> {
      // No public visibility flag exists, so private owner records are never queried or returned.
      return json(PublicAgentsResponseSchema.parse({ agents: [] }));
    },

    async tape(): Promise<Response> {
      // There is no public Tape opt-in; private decisions remain on owner-scoped routes.
      return json(PublicTapeResponseSchema.parse({ decisions: [], executionMode: "PAPER" }));
    },

    async verify(): Promise<Response> {
      const hooks = getHookCatalog();
      const templates = getHouseAgentTemplates().templates;
      const paperReadyCount = templates.filter((template) => template.availability === "paper_ready").length;
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
            statement: `${hooks.coverage.registeredCount} PM hook entries are cataloged; ${hooks.definitions.filter((hook) => hook.availability === "implemented").length} have deterministic evaluators and ${hooks.definitions.filter((hook) => hook.availability === "catalog_only").length} remain catalog-only.`,
            evidencePath: "/api/public/v1/hooks",
          },
          {
            id: "house_agents",
            status: paperReadyCount > 0 ? "verified" : "preview",
            statement: `${paperReadyCount} of ${templates.length} House Agent templates are paper ready.`,
            evidencePath: "/api/public/v1/templates",
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
