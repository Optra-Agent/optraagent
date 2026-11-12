import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { paperPositions } from "../../db/schema";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase } from "../../lib/db/client";
import type { AgentDecision, BacktestRun, RecipeV1, Session } from "../../lib/domain/contracts";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { createPaperHandlers } from "../../lib/paper/handlers";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";
import { createAgentHandlers } from "../../lib/paper/agents";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;
const OTHER_ADDRESS = "0x0000000000000000000000000000000000000002" as const;
const recipe: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: [], parameters: {} };
const now = new Date("2026-11-12T03:31:00.000Z");

function makeRun(recipeHash: string): BacktestRun {
  return {
    id: "123e4567-e89b-42d3-a456-426614174009", recipeHash, dataSource: "verified-hourly-snapshots",
    startAt: "2026-10-01T00:00:00.000Z", endAt: "2026-10-30T23:00:00.000Z", sampleCount: 720,
    hourlyCoverageComplete: true, premiumSource: "recorded", pricingMethod: "recorded", status: "complete",
    metrics: { totalReturnPct: "0", maxDrawdownPct: "0", endingCashUsd: "10000" },
    entryOrderCount: 1, historyDataHash: `sha256:${"a".repeat(64)}`, historyProvenance: { provider: "test fixture" }, pricingAssumptions: { model: "test fixture" },
    reason: "Complete verified run.", createdAt: now.toISOString(),
  };
}

function makeDecision(agentId: string, recipeHash: string): AgentDecision {
  return {
    id: `decision:${agentId}:initial`, agentId, tickId: "initial", action: "skip", reason: "No supported hook.", hookResults: [],
    snapshotSource: "unavailable", recipeHash, createdAt: now.toISOString(),
  };
}

describe("persisted agent lifecycle", () => {
  let rootDir: string;
  afterEach(() => { if (rootDir) rmSync(rootDir, { recursive: true, force: true }); });

  async function createHarness() {
    rootDir = mkdtempSync(join(tmpdir(), "optra-agent-lifecycle-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    const auth = new DrizzleAuthRepository(connection.db);
    const owner = await auth.findOrCreateUser(ADDRESS);
    const other = await auth.findOrCreateUser(OTHER_ADDRESS);
    const session: Session = { user: { id: owner.id, address: ADDRESS }, expiresAt: "2026-11-19T03:31:00.000Z" };
    const otherSession: Session = { user: { id: other.id, address: OTHER_ADDRESS }, expiresAt: "2026-11-19T03:31:00.000Z" };
    const repository = new DrizzlePaperRepository(connection.db);
    const backtest = makeRun(canonicalRecipeHash(recipe));
    const handlers = (activeSession: Session = session) => createAgentHandlers({
      repository,
      backtests: { getBacktestRun: async (ownerId, runId) => ownerId === owner.id && runId === backtest.id ? backtest : null },
      readSession: async () => activeSession,
      now: () => now,
    });
    return { connection, auth, owner, other, session, otherSession, repository, handlers, backtest };
  }

  it("fork_has_a_new_recipe_hash_and_copies_no_positions_or_tick_ids", async () => {
    const { connection, owner, repository, handlers } = await createHarness();
    try {
      const source = await repository.createAgent({ ownerId: owner.id, name: recipe.name, templateId: "custom", status: "running", recipe, recipeHash: canonicalRecipeHash(recipe), createdAt: now });
      await repository.persistTick({
        ownerId: owner.id,
        agentId: source.id,
        tickId: "initial",
        occurredAt: now.toISOString(),
        snapshot: null,
        evaluate: ({ agent, account, position }) => ({
          decision: makeDecision(agent.id, agent.recipeHash),
          orderIntents: [],
          portfolio: {
            account: account ?? { initialCapitalUsd: "0", cashUsd: "0", realizedPnlUsd: "0", peakEquityUsd: "0", dailyStartEquityUsd: "0", dailyStartDate: now.toISOString().slice(0, 10) },
            position,
            positionAction: "unchanged",
          },
        }),
      });
      await connection.db.insert(paperPositions).values({
        agentId: source.id, symbol: "AAPL", quantity: "1", averageEntryUsd: "100", markPriceUsd: "101", unrealizedPnlUsd: "1", status: "open", updatedAt: now,
      });

      const response = await handlers().fork(new Request("http://localhost/api/agents/id/fork", { method: "POST", body: JSON.stringify({}) }), source.id);
      const forked = await response.json();
      const tape = await repository.listTape(owner.id, forked.id);
      const positions = await repository.listPositions(owner.id, forked.id);

      expect(response.status).toBe(201);
      expect(forked).toMatchObject({ status: "draft", backtestRunId: null });
      expect(forked.recipeHash).not.toBe(source.recipeHash);
      expect(tape).toEqual([]);
      expect(positions).toEqual([]);
      expect(await repository.listTape(owner.id, source.id)).toHaveLength(1);
    } finally {
      await connection.close();
    }
  });

  it("other_owner_cannot_list_or_read_an_agent", async () => {
    const { connection, owner, repository, handlers, otherSession } = await createHarness();
    try {
      const source = await repository.createAgent({ ownerId: owner.id, name: recipe.name, templateId: recipe.templateId, status: "running", recipe, recipeHash: canonicalRecipeHash(recipe), createdAt: now });
      const privateHandlers = handlers(otherSession);
      const list = await privateHandlers.list(new Request("http://localhost/api/agents"));
      const detail = await privateHandlers.detail(new Request("http://localhost/api/agents/id"), source.id);

      expect(list.status).toBe(200);
      await expect(list.json()).resolves.toMatchObject({ agents: [] });
      expect(detail.status).toBe(404);
    } finally {
      await connection.close();
    }
  });

  it("stopped_agent_cannot_create_another_paper_tick", async () => {
    const { connection, owner, session, repository, handlers } = await createHarness();
    let snapshotCalls = 0;
    try {
      const source = await repository.createAgent({ ownerId: owner.id, name: recipe.name, templateId: recipe.templateId, status: "running", recipe, recipeHash: canonicalRecipeHash(recipe), createdAt: now });
      const stop = await handlers().lifecycle(new Request("http://localhost", { method: "POST", body: JSON.stringify({ action: "stop" }) }), source.id);
      const paper = createPaperHandlers({
        repository,
        readSession: async () => session,
        getSnapshot: async () => { snapshotCalls += 1; throw new Error("must not request data"); },
        now: () => now,
      });
      const tick = await paper.tick(new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "after-stop" } }), source.id);

      expect(stop.status).toBe(200);
      expect(tick.status).toBe(409);
      expect(snapshotCalls).toBe(0);
    } finally {
      await connection.close();
    }
  });

  it("rejects_a_tick_when_the_agent_stops_after_preflight", async () => {
    const { connection, owner, session, repository } = await createHarness();
    try {
      const source = await repository.createAgent({ ownerId: owner.id, name: recipe.name, templateId: "custom", status: "running", recipe, recipeHash: canonicalRecipeHash(recipe), createdAt: now });
      const racedRepository = new Proxy(repository, {
        get(target, property, receiver) {
          if (property === "persistTick") {
            return async (...args: Parameters<typeof repository.persistTick>) => {
              await target.transitionAgent(owner.id, source.id, "running", "stopped", now);
              return target.persistTick(...args);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const paper = createPaperHandlers({
        repository: racedRepository,
        readSession: async () => session,
        getSnapshot: async () => { throw new Error("Captured failure should produce a skip evaluation."); },
        now: () => now,
      });

      const tick = await paper.tick(new Request("http://localhost", { method: "POST", headers: { "idempotency-key": "stop-race" } }), source.id);

      expect(tick.status).toBe(409);
      await expect(tick.json()).resolves.toMatchObject({ error: { code: "CONFLICT" } });
      await expect(repository.listTape(owner.id, source.id)).resolves.toEqual([]);
    } finally {
      await connection.close();
    }
  });
});
