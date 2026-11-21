import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agents } from "../../db/schema";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase, type DatabaseConnection } from "../../lib/db/client";
import { isRegularEquitySession } from "../../lib/engine/us-market-session";
import { applyPositionChanges } from "../../lib/engine/strategy/portfolio";
import { initialStrategyAccount, runStrategyTick } from "../../lib/engine/strategy/run-strategy-tick";
import type { StrategyAccount, StrategyPosition } from "../../lib/engine/strategy/types";
import { HOUSE_AGENT_DEFINITIONS, HOUSE_USER_ADDRESS, ensureHouseAgents } from "../../lib/house/house-agents";
import { buildHouseRecipe } from "../../lib/hooks/house-specs";
import { canonicalRecipeHash, validateRecipe } from "../../lib/hooks/recipe-validator";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";
import { DrizzlePublicRepository } from "../../lib/paper/public-repository";
import { createPaperScheduler } from "../../lib/paper/scheduler";
import { createPublicHandlers } from "../../lib/public/handlers";
import { CAPTURE, earningsFor, historyAt } from "./market-capture";

vi.setConfig({ testTimeout: 240_000 });

const SECRET = "test-scheduler-secret-0123456789abcdef";
const LAUNCH_AT = new Date("2026-11-19T12:00:00.000Z");
const CAPTURED = new Date(CAPTURE.capturedAt);

describe("OPTRA House Agents on the persisted strategy engine", () => {
  let rootDir: string | undefined;
  const open: DatabaseConnection[] = [];

  afterEach(async () => {
    for (const connection of open.splice(0)) await connection.close();
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  async function database() {
    rootDir = mkdtempSync(join(tmpdir(), "optra-house-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    open.push(connection);
    return connection;
  }

  it("persisted ticks equal the pure engine tick for tick (paper/backtest parity), including restart recovery and idempotency", async () => {
    const connection = await database();
    const repository = new DrizzlePaperRepository(connection.db);
    const owner = await new DrizzleAuthRepository(connection.db).findOrCreateUser("0x000000000000000000000000000000000000dEaD");
    const now = new Date(CAPTURE.capturedAt);
    const history = await historyAt("NVDA", now);
    const earnings = earningsFor("NVDA");
    const recipe = buildHouseRecipe("earnings_straddle", { underlyingSymbol: "NVDA", initialCapitalUsd: 10_000 });
    const recipeHash = canonicalRecipeHash(recipe);
    const created = await repository.createAgent({ ownerId: owner.id, name: recipe.name, templateId: "earnings_straddle", status: "draft", recipe, recipeHash, createdAt: new Date("2026-11-01T00:00:00.000Z") });
    await connection.db.update(agents).set({ status: "running" }).where(eq(agents.id, created.id));

    const candles = history.candles;
    const startIndex = candles.length - 200;
    let account: StrategyAccount | null = initialStrategyAccount(recipe, candles[startIndex]!.endAt);
    let positions: StrategyPosition[] = [];
    let opened = 0;
    for (let index = startIndex; index < candles.length; index += 1) {
      const candle = candles[index]!;
      const tickId = `replay-${Date.parse(candle.endAt)}`;
      const input = {
        agentId: created.id, tickId, occurredAt: candle.endAt, recipe, recipeHash, snapshot: null, currentCandle: candle, history: candles.slice(0, index),
        corporateActionDates: history.corporateActionDates, earnings, state: { status: "running" as const },
      };
      const pure = runStrategyTick({ ...input, account, positions, includeMarketContext: true });
      const persisted = await repository.persistStrategyTick({
        ownerId: owner.id, agentId: created.id, tickId, occurredAt: candle.endAt, snapshot: null,
        evaluate: (context) => runStrategyTick({ ...input, account: context.account, positions: context.positions, includeMarketContext: true }),
      });
      expect(persisted.duplicate).toBe(false);
      expect(persisted.decision.action).toBe(pure.decision.action);
      expect(persisted.decision.reason).toBe(pure.decision.reason);
      expect(persisted.decision.hookResults).toEqual(pure.decision.hookResults);
      expect(persisted.orderCount).toBe(pure.orderIntents.length);
      opened += pure.orderIntents.filter((order) => order.action === "open").length;
      account = pure.portfolio.account;
      positions = applyPositionChanges(positions, pure.portfolio.changes, (key) => key);
      // The restart check: reload state from the database, as a fresh process would, and keep going from it.
      if (index === startIndex + 120) {
        const state = await repository.getStrategyState(owner.id, created.id);
        expect(state.positions.map((position) => position.strikeUsd).sort()).toEqual(positions.map((position) => position.strikeUsd).sort());
        expect(state.account?.cashUsd).toBe(account.cashUsd);
      }
    }
    expect(opened).toBe(2);

    // A repeated tick id is an idempotent replay and changes nothing.
    const last = candles.at(-1)!;
    const replay = await repository.persistStrategyTick({
      ownerId: owner.id, agentId: created.id, tickId: `replay-${Date.parse(last.endAt)}`, occurredAt: last.endAt, snapshot: null,
      evaluate: () => { throw new Error("a duplicate tick must not be re-evaluated"); },
    });
    expect(replay.duplicate).toBe(true);

    const finalState = await repository.getStrategyState(owner.id, created.id);
    expect(finalState.account?.cashUsd).toBe(account!.cashUsd);
    expect(finalState.account?.meta.tradedEarnings).toEqual(["2026-11-17"]);
    expect(finalState.positions).toHaveLength(positions.length);
    const orders = await repository.listOrders(owner.id, created.id, 50);
    expect(orders.map((order) => order.purpose)).toEqual(expect.arrayContaining(["open"]));
    expect(orders.every((order) => order.executionMode === "PAPER" && order.premiumSource === "modeled")).toBe(true);
    const allPositions = await repository.listPositions(owner.id, created.id);
    expect(allPositions.filter((position) => position.status === "closed")).toHaveLength(2);
    expect(allPositions.every((position) => position.side === "long" && position.structureId)).toBe(true);
  });

  it("provisions the four public House Agents, evaluates them on the scheduler, and serves only OPTRA-owned data publicly", async () => {
    const connection = await database();
    const paper = new DrizzlePaperRepository(connection.db);
    const getEarnings = async (symbol: string) => earningsFor(symbol);

    const outcomes = await ensureHouseAgents({
      db: connection.db, now: () => LAUNCH_AT, newRunId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
      getHistory: (symbol) => historyAt(symbol, LAUNCH_AT), getEarnings,
    });
    expect(outcomes.map((outcome) => [outcome.key, outcome.status])).toEqual(HOUSE_AGENT_DEFINITIONS.map((definition) => [definition.key, "launched"]));

    // Provisioning is idempotent: a second pass finds every agent running and creates nothing new.
    const again = await ensureHouseAgents({ db: connection.db, now: () => LAUNCH_AT, getHistory: (symbol) => historyAt(symbol, LAUNCH_AT), getEarnings });
    expect(again.every((outcome) => outcome.status === "running")).toBe(true);
    expect(await connection.db.select().from(agents)).toHaveLength(4);

    // Every House Agent is owned by the reserved OPTRA user, so no wallet session can ever act as it.
    const owners = await new DrizzleAuthRepository(connection.db).findOrCreateUser(HOUSE_USER_ADDRESS);
    expect((await connection.db.select().from(agents)).every((agent) => agent.ownerId === owners.id && agent.kind === "house" && agent.visibility === "public")).toBe(true);

    // A user's own agent must never reach a public route.
    const user = await new DrizzleAuthRepository(connection.db).findOrCreateUser("0x000000000000000000000000000000000000bEEF");
    const userRecipe = buildHouseRecipe("covered_call", { underlyingSymbol: "MSFT", referenceShares: 5, initialCapitalUsd: 1000, name: "My private call" });
    await paper.createAgent({ ownerId: user.id, name: userRecipe.name, templateId: "covered_call", status: "draft", recipe: userRecipe, recipeHash: canonicalRecipeHash(userRecipe), createdAt: LAUNCH_AT });

    if (process.env.HOUSE_DEBUG) {
      for (const agent of await paper.listRunningAgents()) {
        const v = validateRecipe(agent.recipe);
        console.log("DBG", agent.name, agent.status, agent.templateId, agent.recipe.templateId, v.valid, JSON.stringify(v.issues), canonicalRecipeHash(agent.recipe) === agent.recipeHash);
      }
    }
    // Step the scheduler once per in-session hourly candle after launch, as the Railway cron would.
    const reference = await historyAt("NVDA", new Date(CAPTURE.capturedAt));
    const sessionEnds = reference.candles.map((candle) => Date.parse(candle.endAt)).filter((endMs) => endMs > LAUNCH_AT.getTime() && isRegularEquitySession(new Date(endMs).toISOString()));
    expect(sessionEnds.length).toBeGreaterThanOrEqual(8);
    const summaries = [];
    for (const endMs of sessionEnds) {
      const at = new Date(endMs + 6 * 60_000);
      const scheduler = createPaperScheduler({
        repository: paper, secret: SECRET, getHistory: (symbol) => historyAt(symbol, at), getEarnings, acquireLock: async () => ({ release: async () => undefined }),
        now: () => at, log: (entry) => { if (process.env.HOUSE_DEBUG && entry.event !== "paper_scheduler.candle_evaluated") console.log(JSON.stringify(entry)); },
      });
      const response = await scheduler.run(new Request("http://localhost/api/cron/paper-evaluations", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
      expect(response.status).toBe(200);
      summaries.push(await response.json() as { evaluated: number; agentsConsidered: number; failures: number });
    }
    expect(summaries.every((summary) => summary.agentsConsidered === 4 && summary.failures === 0)).toBe(true);
    expect(summaries.reduce((total, summary) => total + summary.evaluated, 0)).toBe(sessionEnds.length * 4);

    const handlers = createPublicHandlers({ repository: new DrizzlePublicRepository(connection.db) });
    const listed = await (await handlers.agents()).json() as { agents: Array<{ id: string; name: string; templateId: string; by: string; status: string; decisionCount: number; underlyingSymbol: string; backtest: { vsHoldingPct: string | null } | null; latestDecision: unknown }>; executionMode: string };
    expect(listed.executionMode).toBe("PAPER");
    expect(listed.agents.map((agent) => agent.templateId).sort()).toEqual(["cash_secured_put", "covered_call", "earnings_straddle", "protective_put"]);
    expect(listed.agents.every((agent) => agent.by === "Optra" && agent.status === "running" && agent.decisionCount === sessionEnds.length && agent.latestDecision !== null)).toBe(true);
    expect(listed.agents.every((agent) => agent.backtest !== null && agent.backtest.vsHoldingPct !== null)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("My private call");
    expect(JSON.stringify(listed)).not.toContain("ownerId");

    const tape = await (await handlers.tape(new Request("http://localhost/api/public/v1/tape?limit=200"))).json() as { decisions: Array<{ agentName: string; hookResults: unknown[]; recipeHash: string }>; orders: unknown[]; executionMode: string };
    expect(tape.executionMode).toBe("PAPER");
    expect(tape.decisions.length).toBe(sessionEnds.length * 4);
    expect(tape.decisions.every((decision) => decision.hookResults.length >= 10 && /^sha256:/.test(decision.recipeHash))).toBe(true);
    expect(new Set(tape.decisions.map((decision) => decision.agentName))).toEqual(new Set(["Covered Call NVDA", "Cash-Secured Put TSLA", "Protective Put NVDA", "Earnings Straddle NVDA"]));
    expect(JSON.stringify(tape)).not.toContain("My private call");

    const call = listed.agents.find((agent) => agent.templateId === "covered_call")!;
    const detail = await (await handlers.agent(call.id)).json() as { recipe: { hookIds: string[] }; positions: unknown[]; decisions: unknown[]; strategy: { entries: number } | null; backtestRun: { status: string } | null };
    expect(detail.recipe.hookIds).toContain("coverix");
    expect(detail.decisions.length).toBeGreaterThan(0);
    expect(detail.strategy).not.toBeNull();
    expect(detail.backtestRun?.status).toBe("complete");

    // A private (user) agent id is not found publicly.
    const privateAgent = (await connection.db.select().from(agents).where(eq(agents.ownerId, user.id)))[0]!;
    expect((await handlers.agent(privateAgent.id)).status).toBe(404);
    expect((await handlers.agent("not-a-uuid")).status).toBe(404);
    expect((await handlers.tape(new Request("http://localhost/api/public/v1/tape?agentId=" + privateAgent.id))).status).toBe(200);
    const privateTape = await (await handlers.tape(new Request("http://localhost/api/public/v1/tape?agentId=" + privateAgent.id))).json() as { decisions: unknown[] };
    expect(privateTape.decisions).toEqual([]);
    expect((await handlers.tape(new Request("http://localhost/api/public/v1/tape?limit=0"))).status).toBe(400);
  });

  it("follows the fixed symbol rule: a blocked backtest creates no agent and the next candidate is tried", async () => {
    const connection = await database();
    // In the 30 days before the capture TSLA has no confirmed earnings report, so its straddle backtest has no entry and the rule moves on to NVDA.
    const outcomes = await ensureHouseAgents({
      db: connection.db, now: () => CAPTURED, getHistory: (symbol) => historyAt(symbol, CAPTURED), getEarnings: async (symbol) => earningsFor(symbol),
      definitions: HOUSE_AGENT_DEFINITIONS.filter((definition) => definition.key === "optra-earnings-straddle"),
      symbols: () => ["TSLA", "NVDA"],
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "launched", underlyingSymbol: "NVDA" });
    const rows = await connection.db.select().from(agents);
    expect(rows.map((row) => [row.recipe.underlyingSymbol, row.status])).toEqual([["NVDA", "running"]]);

    // When no candidate passes, nothing is created and the reason is reported.
    const blocked = await database();
    const none = await ensureHouseAgents({
      db: blocked.db, now: () => CAPTURED, getHistory: (symbol) => historyAt(symbol, CAPTURED), getEarnings: async (symbol) => earningsFor(symbol),
      definitions: HOUSE_AGENT_DEFINITIONS.filter((definition) => definition.key === "optra-earnings-straddle"),
      symbols: () => ["TSLA"],
    });
    expect(none[0]).toMatchObject({ status: "backtest_blocked", agentId: null, underlyingSymbol: "TSLA" });
    expect(await blocked.db.select().from(agents)).toHaveLength(0);

    // A background pass remembers the blocked search instead of repeating the backtests every ten minutes.
    const hold = new Map<string, number>();
    const options = { db: blocked.db, now: () => CAPTURED, getHistory: (symbol: string) => historyAt(symbol, CAPTURED), getEarnings: async (symbol: string) => earningsFor(symbol), definitions: HOUSE_AGENT_DEFINITIONS.filter((definition) => definition.key === "optra-earnings-straddle"), symbols: () => ["TSLA"], blockedUntil: hold };
    await ensureHouseAgents(options);
    expect(hold.get("optra-earnings-straddle")).toBeGreaterThan(CAPTURED.getTime());
    let reads = 0;
    const again = await ensureHouseAgents({ ...options, getHistory: async (symbol) => { reads += 1; return historyAt(symbol, CAPTURED); } });
    expect(reads).toBe(0);
    expect(again[0]).toMatchObject({ status: "backtest_blocked", agentId: null });
  });
});
