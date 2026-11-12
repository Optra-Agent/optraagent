import { describe, expect, it } from "vitest";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { createAgentHandlers } from "../../lib/paper/agents";
import type { BacktestRun, RecipeV1, Session } from "../../lib/domain/contracts";
import type { StoredPaperAgent } from "../../lib/paper/drizzle-repository";

const OWNER: Session = { user: { id: "owner-1", address: "0xfcad0b19bb29d4674531d6f115237e16afce377c" }, expiresAt: "2026-11-19T03:31:00.000Z" };
const OTHER: Session = { user: { id: "owner-2", address: "0x0000000000000000000000000000000000000002" }, expiresAt: "2026-11-19T03:31:00.000Z" };
const RECIPE: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: [], parameters: {} };
const RUN: BacktestRun = {
  id: "123e4567-e89b-42d3-a456-426614174009", recipeHash: canonicalRecipeHash(RECIPE), dataSource: "verified-hourly-snapshots",
  startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-30T23:00:00.000Z", sampleCount: 720, hourlyCoverageComplete: true,
  premiumSource: "recorded", pricingMethod: "recorded", status: "complete",
  metrics: { totalReturnPct: "0", maxDrawdownPct: "0", endingCashUsd: "10000" },
  entryOrderCount: 1, historyDataHash: `sha256:${"a".repeat(64)}`, historyProvenance: { provider: "test fixture" }, pricingAssumptions: { model: "test fixture" },
  reason: "Complete verified run.", createdAt: "2026-11-12T03:00:00.000Z",
};
const AGENT: StoredPaperAgent = {
  id: "123e4567-e89b-42d3-a456-426614174000", ownerId: OWNER.user.id, name: RECIPE.name, templateId: RECIPE.templateId, status: "running",
  recipeHash: canonicalRecipeHash(RECIPE), backtestRunId: RUN.id, createdAt: "2026-11-12T03:00:00.000Z", updatedAt: "2026-11-12T03:00:00.000Z", recipe: RECIPE,
};

function setup(session: Session = OWNER) {
  const agents = new Map<string, StoredPaperAgent>([[AGENT.id, { ...AGENT }]]);
  const repository = {
    async listAgents(ownerId: string) { return [...agents.values()].filter((agent) => agent.ownerId === ownerId); },
    async findAgent(ownerId: string, agentId: string) { const agent = agents.get(agentId); return agent?.ownerId === ownerId ? agent : null; },
    async createAgent(input: Omit<StoredPaperAgent, "id" | "backtestRunId" | "createdAt" | "updatedAt"> & { createdAt: Date }) {
      const createdAt = input.createdAt.toISOString();
      const agent: StoredPaperAgent = { ...input, id: "123e4567-e89b-42d3-a456-426614174008", backtestRunId: null, createdAt, updatedAt: createdAt };
      agents.set(agent.id, agent);
      return agent;
    },
    async transitionAgent(ownerId: string, agentId: string, expectedStatus: StoredPaperAgent["status"], status: StoredPaperAgent["status"], updatedAt: Date) {
      const agent = agents.get(agentId);
      if (!agent || agent.ownerId !== ownerId || agent.status !== expectedStatus) return null;
      const updated = { ...agent, status, updatedAt: updatedAt.toISOString() };
      agents.set(agentId, updated);
      return updated;
    },
  };
  return createAgentHandlers({
    repository,
    backtests: { getBacktestRun: async (ownerId, runId) => ownerId === OWNER.user.id && runId === RUN.id ? RUN : null },
    readSession: async () => session,
    now: () => new Date("2026-11-12T03:31:00.000Z"),
  });
}

describe("agent management handlers", () => {
  it("owner_can_pause_resume_stop_with_the_attached_matching_backtest", async () => {
    const handlers = setup();
    const pause = await handlers.lifecycle(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "pause" }) }), AGENT.id);
    const resume = await handlers.lifecycle(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "resume" }) }), AGENT.id);
    const stop = await handlers.lifecycle(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "stop" }) }), AGENT.id);

    expect(pause.status).toBe(200);
    await expect(pause.json()).resolves.toMatchObject({ status: "paused" });
    expect(resume.status).toBe(200);
    await expect(resume.json()).resolves.toMatchObject({ status: "running" });
    expect(stop.status).toBe(200);
    await expect(stop.json()).resolves.toMatchObject({ status: "stopped" });
  });

  it("other_owner_cannot_access_or_transition_an_agent", async () => {
    const handlers = setup(OTHER);
    const detail = await handlers.detail(new Request("http://localhost"), AGENT.id);
    const stop = await handlers.lifecycle(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "stop" }) }), AGENT.id);

    expect(detail.status).toBe(404);
    expect(stop.status).toBe(404);
  });

  it("agent_creation_rejects_unverified_recipes_without_persisting_them", async () => {
    const handlers = setup();
    const response = await handlers.create(new Request("http://localhost/api/agents", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipe: { ...RECIPE, hookIds: ["unknown.hook"] } }),
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNSUPPORTED_HOOK" } });
  });
});
