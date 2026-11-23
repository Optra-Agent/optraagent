import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agents, paperAccounts, paperOrders } from "../../db/schema";
import { createDatabase } from "../../lib/db/client";
import type { DatabaseConnection } from "../../lib/db/client";
import { isRegularEquitySession } from "../../lib/engine/us-market-session";
import { HOUSE_AGENT_DEFINITIONS, ensureHouseAgents } from "../../lib/house/house-agents";
import type { MarketHistoryResult } from "../../lib/market/crius-history";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";
import { DrizzlePublicRepository } from "../../lib/paper/public-repository";
import { createPaperScheduler } from "../../lib/paper/scheduler";
import { createPublicHandlers } from "../../lib/public/handlers";
import { CAPTURE, earningsFor, historyAt } from "./market-capture";

vi.setConfig({ testTimeout: 240_000 });

const LAUNCH_AT = new Date("2026-11-19T12:00:00.000Z");
const SECRET = "test-scheduler-secret-0123456789abcdef";

type PublicDecision = { id: string; agentId: string; agentName: string; templateId: string; underlyingSymbol: string; action: string; reason: string; createdAt: string; snapshotSource: string; hookResults: Array<{ hookId: string; status: string }>; marketContext?: Record<string, unknown> };

/**
 * Isolated, database-backed Paper simulation of the production Decision Tape. Every record here lives in a throwaway
 * PGlite directory and is built from the real archived 2026-11-21 Crius/Robinhood capture. None of it exists in
 * production and none of it is a production record.
 */
describe("House Agent Decision Tape persistence (isolated database, archived real candles)", () => {
  let rootDir: string | undefined;
  const open: DatabaseConnection[] = [];

  afterEach(async () => {
    for (const connection of open.splice(0)) await connection.close().catch(() => undefined);
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  it("persists evaluations and a data ERROR, keeps them identical across a process restart, and serves provenance on the public Tape", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-tape-"));
    const dataDir = join(rootDir, "db");
    let connection = await createDatabase({ dataDir, nodeEnv: "test" });
    open.push(connection);
    const getEarnings = async (symbol: string) => earningsFor(symbol);

    await ensureHouseAgents({
      db: connection.db, now: () => LAUNCH_AT, getHistory: (symbol) => historyAt(symbol, LAUNCH_AT), getEarnings,
      newRunId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
    });
    expect(await connection.db.select().from(agents)).toHaveLength(HOUSE_AGENT_DEFINITIONS.length);

    const reference = await historyAt("NVDA", new Date(CAPTURE.capturedAt));
    const sessionEnds = reference.candles.map((candle) => Date.parse(candle.endAt)).filter((endMs) => endMs > LAUNCH_AT.getTime() && isRegularEquitySession(new Date(endMs).toISOString()));
    expect(sessionEnds.length).toBeGreaterThanOrEqual(8);
    const brokenEnd = sessionEnds[2]!;

    const paper = new DrizzlePaperRepository(connection.db);
    const summaries: Array<{ evaluated: number; dataErrors: number; failures: number; agentsConsidered: number }> = [];
    const logs: Array<Record<string, unknown>> = [];
    for (const endMs of sessionEnds) {
      const at = new Date(endMs + 6 * 60_000);
      const scheduler = createPaperScheduler({
        repository: paper, secret: SECRET, acquireLock: async () => ({ release: async () => undefined }), now: () => at, getEarnings, log: (entry) => logs.push(entry),
        getHistory: async (symbol): Promise<MarketHistoryResult> => {
          const history = await historyAt(symbol, at);
          if (endMs !== brokenEnd) return history;
          // A transient upstream defect at one hour: the candle comes back synthetic (forward-filled) with no trades.
          return { ...history, candles: history.candles.map((candle) => (Date.parse(candle.endAt) === brokenEnd ? { ...candle, filled: true, tradeCount: 0 } : candle)) } as unknown as MarketHistoryResult;
        },
      });
      const response = await scheduler.runInProcess();
      expect(response.status).toBe(200);
      summaries.push(await response.json() as (typeof summaries)[number]);
    }
    expect(summaries.every((summary) => summary.agentsConsidered === 4 && summary.failures === 0)).toBe(true);
    expect(summaries.reduce((total, summary) => total + summary.dataErrors, 0)).toBe(4);
    expect(summaries.reduce((total, summary) => total + summary.evaluated, 0)).toBe(sessionEnds.length * 4 - 4);
    expect(logs.filter((entry) => entry.event === "paper_scheduler.error_recorded")).toHaveLength(4);

    // Re-running the same window changes nothing: every decision is idempotent per candle.
    const at = new Date(sessionEnds.at(-1)! + 6 * 60_000);
    const again = await createPaperScheduler({ repository: paper, secret: SECRET, acquireLock: async () => ({ release: async () => undefined }), now: () => at, getEarnings, getHistory: (symbol) => historyAt(symbol, at), log: () => undefined }).runInProcess();
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ evaluated: 0, dataErrors: 0 });

    const readTape = async (db: DatabaseConnection["db"]) => {
      const handlers = createPublicHandlers({ repository: new DrizzlePublicRepository(db), now: () => new Date("2026-11-22T00:20:00.000Z"), heartbeat: () => null });
      const response = await handlers.tape(new Request("http://localhost/api/public/v1/tape?limit=200"));
      expect(response.status).toBe(200);
      return await response.json() as { decisions: PublicDecision[]; orders: unknown[]; executionMode: string; scheduler: Record<string, unknown> };
    };
    const before = await readTape(connection.db);
    expect(before.decisions).toHaveLength(sessionEnds.length * 4);
    expect(new Set(before.decisions.map((decision) => decision.agentName))).toEqual(new Set(["Covered Call NVDA", "Cash-Secured Put TSLA", "Protective Put NVDA", "Earnings Straddle NVDA"]));
    expect(before.decisions.every((decision) => decision.action !== undefined && decision.createdAt && decision.snapshotSource && decision.hookResults.length > 0)).toBe(true);

    // The ERROR outcome: a skip with a system.market_data hook in status error, no orders, no account change.
    const errors = before.decisions.filter((decision) => decision.hookResults.some((hook) => hook.status === "error"));
    expect(errors).toHaveLength(4);
    expect(errors.every((decision) => decision.action === "skip" && decision.createdAt === new Date(brokenEnd).toISOString() && decision.hookResults[0]!.hookId === "system.market_data")).toBe(true);
    expect(errors[0]!.reason).toMatch(/^Evaluation could not run: /);
    expect(errors[0]!.reason).toMatch(/No order was created/);
    expect(await connection.db.select().from(paperOrders)).toSatisfy((rows: Array<{ tickId: string }>) => rows.every((row) => row.tickId !== `replay-${brokenEnd}`));
    for (const account of await connection.db.select().from(paperAccounts)) expect(Number(account.initialCapitalUsd)).toBeGreaterThan(0);

    // Provenance is on the record, and the public payload carries the window and hash, not the raw 721-candle array.
    const protective = before.decisions.find((decision) => decision.templateId === "protective_put" && !decision.hookResults.some((hook) => hook.status === "error"))!;
    expect(protective.marketContext?.history).toBeUndefined();
    expect(protective.marketContext?.historyWindow).toMatchObject({ candles: 721 });
    expect(String(protective.marketContext?.historyDataHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(protective.snapshotSource).toBe("crius_robinhood_chain_candles");
    expect(JSON.stringify(before).length).toBeLessThan(5_000_000);

    // The status explains an empty Tape: a Sunday, with the next eligible tick on Monday at 10:00 ET.
    expect(before.scheduler).toMatchObject({ marketOpen: false, marketClosedReason: "weekend", nextEligibleCandleEndAt: "2026-11-23T15:00:00.000Z", nextEvaluationNotBeforeAt: "2026-11-23T15:05:00.000Z", intervalMinutes: 10, finalizationGraceMinutes: 5, heartbeat: null });

    // The Verify payload reports the persisted count from the database, not a hand-written claim.
    const verifyBody = await (await createPublicHandlers({ repository: new DrizzlePublicRepository(connection.db), now: () => new Date("2026-11-22T00:20:00.000Z"), heartbeat: () => null }).verify()).json() as { claims: Array<{ id: string; status: string; statement: string; evidencePath: string }> };
    const tapeClaim = verifyBody.claims.find((claim) => claim.id === "decision_tape")!;
    expect(tapeClaim).toMatchObject({ status: "verified", evidencePath: "/api/public/v1/tape" });
    // Evaluated decisions and data-error records are reported separately and add up to every persisted record.
    const counted = /^(\d+) House Agent decisions are persisted.* (\d+) further records? (?:are|is) data-error outcomes/.exec(tapeClaim.statement);
    expect(counted, tapeClaim.statement).not.toBeNull();
    expect(Number(counted![1]) + Number(counted![2])).toBe(sessionEnds.length * 4);
    expect(Number(counted![2])).toBeGreaterThan(0);

    // Process restart: close the connection and open the same data directory again. Nothing changes.
    await connection.close();
    open.splice(0);
    connection = await createDatabase({ dataDir, nodeEnv: "test" });
    open.push(connection);
    const after = await readTape(connection.db);
    expect(after.decisions.map((decision) => [decision.id, decision.createdAt, decision.action, decision.reason])).toEqual(before.decisions.map((decision) => [decision.id, decision.createdAt, decision.action, decision.reason]));
    expect(JSON.stringify(after.orders)).toBe(JSON.stringify(before.orders));

    // The restarted scheduler resumes from the persisted state: no duplicates, and the next candle is the only new work.
    const resumed = new DrizzlePaperRepository(connection.db);
    const nextEnd = reference.candles.map((candle) => Date.parse(candle.endAt)).find((endMs) => endMs > sessionEnds.at(-1)! && isRegularEquitySession(new Date(endMs).toISOString()));
    if (nextEnd) {
      const resumeAt = new Date(nextEnd + 6 * 60_000);
      const response = await createPaperScheduler({ repository: resumed, secret: SECRET, acquireLock: async () => ({ release: async () => undefined }), now: () => resumeAt, getEarnings, getHistory: (symbol) => historyAt(symbol, resumeAt), log: () => undefined }).runInProcess();
      expect(await response.json()).toMatchObject({ evaluated: 4, duplicates: 0, failures: 0 });
      expect((await readTape(connection.db)).decisions).toHaveLength(sessionEnds.length * 4 + 4);
    }
  });

  it("does not describe data-error records as evaluated decisions on the Verify payload", async () => {
    const claimFor = async (stats: { decisions: number; latestAt: string | null; errors?: number; evaluated?: number; latestEvaluatedAt?: string | null }) => {
      const repository = { listHouseAgents: async () => [], getHouseAgent: async () => null, listPublicTape: async () => ({ decisions: [], orders: [] }), tapeStats: async () => stats };
      const body = await (await createPublicHandlers({ repository, now: () => new Date("2026-11-23T16:20:00.000Z"), heartbeat: () => null }).verify()).json() as { claims: Array<{ id: string; status: string; statement: string }> };
      return body.claims.find((item) => item.id === "decision_tape")!;
    };
    const onlyErrors = await claimFor({ decisions: 4, latestAt: "2026-11-23T15:00:00.000Z", errors: 4, evaluated: 0, latestEvaluatedAt: null });
    expect(onlyErrors.status).toBe("preview");
    expect(onlyErrors.statement).toContain("No House Agent has evaluated a candle yet");
    expect(onlyErrors.statement).not.toContain("decisions are persisted");
    const mixed = await claimFor({ decisions: 6, latestAt: "2026-11-23T16:00:00.000Z", errors: 4, evaluated: 2, latestEvaluatedAt: "2026-11-23T16:00:00.000Z" });
    expect(mixed.status).toBe("verified");
    expect(mixed.statement).toContain("2 House Agent decisions are persisted");
    expect(mixed.statement).toContain("4 further records are data-error outcomes");
  });

  it("explains an empty persisted Tape on the Verify payload instead of implying activity", async () => {
    const repository = { listHouseAgents: async () => [], getHouseAgent: async () => null, listPublicTape: async () => ({ decisions: [], orders: [] }), tapeStats: async () => ({ decisions: 0, latestAt: null }) };
    const body = await (await createPublicHandlers({ repository, now: () => new Date("2026-11-22T00:20:00.000Z"), heartbeat: () => null }).verify()).json() as { claims: Array<{ id: string; status: string; statement: string }> };
    const claim = body.claims.find((item) => item.id === "decision_tape")!;
    expect(claim.status).toBe("preview");
    expect(claim.statement).toMatch(/No House Agent decision has been persisted yet\. The US market is closed \(weekend\)/);
    expect(claim.statement).toContain("2026-11-23T15:00:00.000Z");
  });

  it("reports a market-open scheduler status and the heartbeat of this server instance", async () => {
    const heartbeat = { startedAt: "2026-11-23T14:20:00.000Z", lastPassAt: "2026-11-23T15:10:07.000Z", lastPassDurationMs: 6100, lastPass: { status: "complete" as const, agentsConsidered: 4, evaluated: 4, opened: 0, skipped: 4, duplicates: 0, deferred: 0, dataErrors: 0, failures: 0 } };
    const handlers = createPublicHandlers({ now: () => new Date("2026-11-23T15:12:00.000Z"), heartbeat: () => heartbeat });
    const body = await (await handlers.tape()).json() as { scheduler: { marketOpen: boolean; marketClosedReason: string | null; nextEligibleCandleEndAt: string; heartbeat: unknown } };
    expect(body.scheduler.marketOpen).toBe(true);
    expect(body.scheduler.marketClosedReason).toBeNull();
    expect(body.scheduler.nextEligibleCandleEndAt).toBe("2026-11-23T16:00:00.000Z");
    expect(body.scheduler.heartbeat).toEqual(heartbeat);
  });
});
