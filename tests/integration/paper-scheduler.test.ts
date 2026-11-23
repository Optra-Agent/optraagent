import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase } from "../../lib/db/client";
import type { AgentDecision } from "../../lib/domain/contracts";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";

const OWNER_ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;
const CRON_SECRET = "paper-scheduler-test-secret";
const CAPTURE = JSON.parse(readFileSync(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  asset: Record<string, unknown>;
  candles: unknown;
  corpActions: unknown[];
};

function makeFeed(now: Date) {
  return createCriusHistoryFeed({
    fetcher: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: CAPTURE.corpActions });
      return Response.json(url.pathname.endsWith("/candles") ? CAPTURE.candles : { assets: [CAPTURE.asset] });
    }) as typeof fetch,
    now: () => now,
    listMarkets: async () => [{
      symbol: "AAPL",
      currentMultiplier: String(CAPTURE.asset.currentMultiplier),
      tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    }],
  });
}

function cronRequest(authorization = `Bearer ${CRON_SECRET}`): Request {
  return new Request("https://optra.example/api/cron/paper-evaluations", {
    method: "POST",
    headers: { authorization },
  });
}

describe("scheduled Protective Put paper evaluation", () => {
  let rootDir: string;
  afterEach(() => { if (rootDir) rmSync(rootDir, { recursive: true, force: true }); });

  async function setup() {
    rootDir = mkdtempSync(join(tmpdir(), "optra-paper-scheduler-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    const auth = new DrizzleAuthRepository(connection.db);
    const owner = await auth.findOrCreateUser(OWNER_ADDRESS);
    const repository = new DrizzlePaperRepository(connection.db);
    const recipe = buildProtectivePutRecipe({
      underlyingSymbol: "AAPL",
      protectedShares: "10",
      initialCapitalUsd: "100000",
      name: "Scheduled Protective Put",
    });
    const agent = await repository.createAgent({
      ownerId: owner.id,
      name: recipe.name,
      templateId: recipe.templateId,
      status: "running",
      recipe,
      recipeHash: canonicalRecipeHash(recipe),
      createdAt: new Date("2026-10-01T12:00:00.000Z"),
    });
    return { connection, owner, repository, agent, recipe };
  }

  async function seedLastDecision(repository: DrizzlePaperRepository, ownerId: string, agentId: string, recipeHash: string, occurredAt: string) {
    const tickId = `seed-${Date.parse(occurredAt)}`;
    await repository.persistTick({
      ownerId,
      agentId,
      tickId,
      occurredAt,
      snapshot: null,
      evaluate: ({ agent, account, position }) => ({
        decision: {
          id: `${agent.id}:${tickId}`,
          agentId: agent.id,
          tickId,
          action: "skip",
          reason: "Fixture establishes the prior processed candle.",
          hookResults: [],
          snapshotSource: "crius_robinhood_chain_candles",
          recipeHash,
          createdAt: occurredAt,
        } satisfies AgentDecision,
        orderIntents: [],
        portfolio: {
          account: account!,
          position,
          positionAction: "unchanged",
        },
      }),
    });
  }

  it("persists one modeled order for a fresh finalized candle and replays it idempotently", async () => {
    const schedulerModule = await import("../../lib/paper/scheduler").catch(() => null);
    expect(schedulerModule, "the protected paper scheduler handler is implemented").not.toBeNull();
    const { createPaperScheduler } = schedulerModule!;
    const now = new Date("2026-10-12T14:15:00.000Z");
    const feed = makeFeed(now);
    const history = await feed.getHistory("AAPL");
    const candle = history.candles.find((item) => item.endAt === "2026-10-12T14:00:00.000Z")!;
    expect(candle).toBeDefined();
    const { connection, owner, repository, agent } = await setup();
    try {
      await seedLastDecision(repository, owner.id, agent.id, agent.recipeHash, "2026-10-12T13:00:00.000Z");
      const logs: Record<string, unknown>[] = [];
      const handler = createPaperScheduler({
        repository,
        secret: CRON_SECRET,
        getHistory: (symbol: string) => feed.getHistory(symbol),
        acquireLock: async () => ({ release: async () => undefined }),
        now: () => now,
        log: (entry) => logs.push(entry),
      });

      const first = await handler.run(cronRequest());
      expect(first.status, JSON.stringify(logs)).toBe(200);
      await expect(first.json()).resolves.toMatchObject({ opened: 1, failures: 0 });
      const tapeAfterFirst = await repository.listTape(owner.id, agent.id, 10);
      const ordersAfterFirst = await repository.listOrders(owner.id, agent.id, 10);
      const positionsAfterFirst = await repository.listPositions(owner.id, agent.id);
      expect(tapeAfterFirst[0]).toMatchObject({ tickId: `replay-${Date.parse(candle.endAt)}`, action: "open" });
      expect(ordersAfterFirst).toHaveLength(1);
      expect(ordersAfterFirst[0]).toMatchObject({ executionMode: "PAPER", premiumSource: "modeled" });
      expect(positionsAfterFirst).toHaveLength(1);

      const retry = await handler.run(cronRequest());
      expect(retry.status).toBe(200);
      await expect(retry.json()).resolves.toMatchObject({ evaluated: 0, failures: 0 });
      expect(await repository.listTape(owner.id, agent.id, 10)).toHaveLength(2);
      expect(await repository.listOrders(owner.id, agent.id, 10)).toHaveLength(1);
    } finally {
      await connection.close();
    }
  });

  it("evaluates a fresh candle when the history is fetched after the pass starts (a real clock moves between the two)", async () => {
    const { createPaperScheduler } = await import("../../lib/paper/scheduler");
    const base = new Date("2026-10-12T14:15:00.000Z").getTime();
    const candleEndAt = "2026-10-12T14:00:00.000Z";
    let reads = 0;
    const advancingClock = () => new Date(base + (reads++) * 1500);
    const feed = makeFeed(new Date(base));
    const advancingFeed = createCriusHistoryFeed({
      fetcher: (async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: CAPTURE.corpActions });
        return Response.json(url.pathname.endsWith("/candles") ? CAPTURE.candles : { assets: [CAPTURE.asset] });
      }) as typeof fetch,
      now: advancingClock,
      listMarkets: async () => [{ symbol: "AAPL", currentMultiplier: String(CAPTURE.asset.currentMultiplier), tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" }],
    });
    expect((await feed.getHistory("AAPL")).candles.some((item) => item.endAt === candleEndAt)).toBe(true);
    const { connection, owner, repository, agent } = await setup();
    try {
      await seedLastDecision(repository, owner.id, agent.id, agent.recipeHash, "2026-10-12T13:00:00.000Z");
      const logs: Record<string, unknown>[] = [];
      const handler = createPaperScheduler({
        repository,
        secret: CRON_SECRET,
        getHistory: (symbol: string) => advancingFeed.getHistory(symbol),
        acquireLock: async () => ({ release: async () => undefined }),
        now: advancingClock,
        log: (entry) => logs.push(entry),
      });
      const response = await handler.run(cronRequest());
      expect(response.status, JSON.stringify(logs)).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ opened: 1, dataErrors: 0, failures: 0 });
      const tape = await repository.listTape(owner.id, agent.id, 10);
      expect(tape[0]).toMatchObject({ tickId: `replay-${Date.parse(candleEndAt)}`, action: "open" });
    } finally {
      await connection.close();
    }
  });

  it("persists a risk-gated skip from a finalized in-session candle without an order", async () => {
    const schedulerModule = await import("../../lib/paper/scheduler").catch(() => null);
    expect(schedulerModule, "the protected paper scheduler handler is implemented").not.toBeNull();
    const { createPaperScheduler } = schedulerModule!;
    const now = new Date("2026-10-16T14:15:00.000Z");
    const feed = makeFeed(now);
    const history = await feed.getHistory("AAPL");
    const candle = history.candles.find((item) => item.endAt === "2026-10-16T14:00:00.000Z")!;
    expect(candle).toBeDefined();
    const { connection, owner, repository, agent } = await setup();
    try {
      await seedLastDecision(repository, owner.id, agent.id, agent.recipeHash, "2026-10-16T13:00:00.000Z");
      const logs: Record<string, unknown>[] = [];
      const handler = createPaperScheduler({
        repository,
        secret: CRON_SECRET,
        getHistory: (symbol: string) => feed.getHistory(symbol),
        acquireLock: async () => ({ release: async () => undefined }),
        now: () => now,
        log: (entry) => logs.push(entry),
      });

      const response = await handler.run(cronRequest());
      expect(response.status, JSON.stringify(logs)).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ skipped: 1, failures: 0 });
      const tape = await repository.listTape(owner.id, agent.id, 10);
      expect(tape[0]).toMatchObject({ tickId: `replay-${Date.parse(candle.endAt)}`, action: "skip", reason: "Entry blocked by calmo." });
      expect(tape[0]?.hookResults).toContainEqual(expect.objectContaining({ hookId: "calmo", status: "block" }));
      expect(await repository.listOrders(owner.id, agent.id, 10)).toEqual([]);
    } finally {
      await connection.close();
    }
  });

  it("requires the cron credential and does not run without the scheduler lease", async () => {
    const schedulerModule = await import("../../lib/paper/scheduler").catch(() => null);
    expect(schedulerModule, "the protected paper scheduler handler is implemented").not.toBeNull();
    const { createPaperScheduler } = schedulerModule!;
    let historyReads = 0;
    let agentReads = 0;
    const handler = createPaperScheduler({
      repository: {
        listRunningAgents: async () => { agentReads += 1; return []; },
        listTape: async () => [],
        persistTick: async () => { throw new Error("no agents should be ticked"); },
        persistStrategyTick: async () => { throw new Error("no agents should be ticked"); },
      },
      secret: CRON_SECRET,
      getHistory: async () => { historyReads += 1; throw new Error("no feed reads should occur"); },
      acquireLock: async () => null,
      now: () => new Date("2026-10-12T14:15:00.000Z"),
      log: () => undefined,
    });

    const unauthorized = await handler.run(cronRequest("Bearer wrong"));
    expect(unauthorized.status).toBe(401);
    const overlap = await handler.run(cronRequest());
    expect(overlap.status).toBe(202);
    expect(agentReads).toBe(0);
    expect(historyReads).toBe(0);
  });

  it("lists only running agents as lifecycle actions pause, resume, and stop scheduled eligibility", async () => {
    const { connection, owner, repository, agent, recipe } = await setup();
    try {
      const paused = await repository.createAgent({
        ownerId: owner.id,
        name: "Paused Protective Put",
        templateId: recipe.templateId,
        status: "paused",
        recipe,
        recipeHash: agent.recipeHash,
        createdAt: new Date("2026-10-01T12:00:00.000Z"),
      });
      const stopped = await repository.createAgent({
        ownerId: owner.id,
        name: "Stopped Protective Put",
        templateId: recipe.templateId,
        status: "stopped",
        recipe,
        recipeHash: agent.recipeHash,
        createdAt: new Date("2026-10-01T12:00:00.000Z"),
      });
      expect((await repository.listRunningAgents()).map((item) => item.id)).toEqual([agent.id]);

      await repository.transitionAgent(owner.id, agent.id, "running", "paused", new Date("2026-10-12T13:15:00.000Z"));
      expect(await repository.listRunningAgents()).toEqual([]);
      await repository.transitionAgent(owner.id, paused.id, "paused", "running", new Date("2026-10-12T13:15:00.000Z"));
      expect((await repository.listRunningAgents()).map((item) => item.id)).toEqual([paused.id]);
      await repository.transitionAgent(owner.id, paused.id, "running", "stopped", new Date("2026-10-12T13:30:00.000Z"));
      expect(await repository.listRunningAgents()).toEqual([]);
      expect((await repository.listAgents(owner.id)).find((item) => item.id === stopped.id)?.status).toBe("stopped");
    } finally {
      await connection.close();
    }
  });
});
