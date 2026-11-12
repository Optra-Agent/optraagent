import { describe, expect, it, vi } from "vitest";
import { createAgentHandlers } from "../../lib/paper/agents";
import type { RecipeV1, Session } from "../../lib/domain/contracts";

const owner: Session = { user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z" };
const unsupportedRecipe: RecipeV1 = { version: 1, name: "Draft", templateId: "custom", underlyingSymbol: "AAPL", hookIds: ["unknown.hook"], parameters: {} };

describe("Forge draft persistence", () => {
  it("forge_saves_only_recipes_with_verified_evaluators", async () => {
    const createAgent = vi.fn();
    const handlers = createAgentHandlers({
      repository: {
        createAgent,
        findAgent: async () => null,
        listAgents: async () => [],
        transitionAgent: async () => null,
      },
      backtests: { getBacktestRun: async () => null },
      readSession: async () => owner,
    });
    const response = await handlers.create(new Request("http://localhost/api/recipes", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipe: unsupportedRecipe }),
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNSUPPORTED_HOOK" } });
    expect(createAgent).not.toHaveBeenCalled();
  });
});
