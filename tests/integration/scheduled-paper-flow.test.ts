import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createAuthHandlers } from "../../lib/auth/handlers";
import { createWalletAuthService } from "../../lib/auth/service";
import { createBacktestHandlers } from "../../lib/backtest/handlers";
import { DrizzleBacktestRepository } from "../../lib/backtest/drizzle-repository";
import { createDatabase } from "../../lib/db/client";
import { SessionSchema } from "../../lib/domain/contracts";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";
import { createAgentHandlers } from "../../lib/paper/agents";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";
import { createPaperScheduler } from "../../lib/paper/scheduler";

const APP_ORIGIN = "http://localhost:3000";
const ACCOUNT = privateKeyToAccount(generatePrivateKey());
const PRELAUNCH = new Date("2026-11-09T22:15:00.000Z");
const SCHEDULED_AT = new Date("2026-11-10T15:15:00.000Z");
const CAPTURE = JSON.parse(readFileSync(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  asset: Record<string, unknown>;
  candles: unknown;
  corpActions: unknown[];
};

function makeHistory(now: Date) {
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

describe("wallet-to-scheduled-paper integration", () => {
  let rootDir: string;
  afterEach(() => { if (rootDir) rmSync(rootDir, { recursive: true, force: true }); });

  it("authenticates, drafts, validates, backtests, launches, schedules one modeled decision, and reads Tape", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-scheduled-flow-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const authRepository = new DrizzleAuthRepository(connection.db);
      const authService = createWalletAuthService(authRepository, { appOrigin: APP_ORIGIN, now: () => PRELAUNCH });
      const auth = createAuthHandlers(authService, { secureCookie: false, now: () => PRELAUNCH });
      const challenge = await auth.challenge(new Request(`${APP_ORIGIN}/api/auth/challenge`, {
        method: "POST",
        headers: { origin: APP_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ address: ACCOUNT.address }),
      }));
      expect(challenge.status).toBe(200);
      const challengePayload = await challenge.json() as { nonce: string; message: string };
      const signature = await ACCOUNT.signMessage({ message: challengePayload.message });
      const verified = await auth.verify(new Request(`${APP_ORIGIN}/api/auth/verify`, {
        method: "POST",
        headers: { origin: APP_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ address: ACCOUNT.address, nonce: challengePayload.nonce, signature }),
      }));
      expect(verified.status).toBe(200);
      const cookie = verified.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toMatch(/^optra_session=/);
      const sessionResponse = await auth.me(new Request(`${APP_ORIGIN}/api/me`, { headers: { cookie: cookie! } }));
      const session = SessionSchema.parse(await sessionResponse.json());
      const readSession = async (request: Request) => {
        const response = await auth.me(request);
        return response.ok ? SessionSchema.parse(await response.json()) : response;
      };

      const paperRepository = new DrizzlePaperRepository(connection.db);
      const backtestRepository = new DrizzleBacktestRepository(connection.db);
      const agents = createAgentHandlers({
        repository: paperRepository,
        backtests: backtestRepository,
        readSession,
        now: () => PRELAUNCH,
      });
      const recipe = buildProtectivePutRecipe({
        underlyingSymbol: "AAPL",
        protectedShares: "10",
        initialCapitalUsd: "100000",
        name: "Scheduled AAPL Protective Put",
      });
      const draftResponse = await agents.create(new Request(`${APP_ORIGIN}/api/agents`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ recipe }),
      }));
      expect(draftResponse.status).toBe(201);
      const draft = await draftResponse.json() as { id: string; status: string; recipeHash: string };
      expect(draft.status).toBe("draft");

      const backtestHistory = await makeHistory(PRELAUNCH).getHistory("AAPL");
      expect(backtestHistory.coverage).toMatchObject({ ready: true, availableCandles: 1441, multiplierStatus: "stable_verified", fillApplied: false });
      const backtests = createBacktestHandlers({
        repository: backtestRepository,
        agents: paperRepository,
        readSession,
        listMarkets: async () => [{ symbol: "AAPL" }],
        getHistory: async () => backtestHistory,
        now: () => PRELAUNCH,
        newRunId: () => "123e4567-e89b-42d3-a456-426614174001",
      });
      const backtestResponse = await backtests.create(new Request(`${APP_ORIGIN}/api/backtests`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ recipe }),
      }));
      expect(backtestResponse.status).toBe(201);
      const backtest = await backtestResponse.json() as { id: string; status: string; sampleCount: number; entryOrderCount: number };
      expect(backtest).toMatchObject({ status: "complete", sampleCount: 720 });
      expect(backtest.entryOrderCount).toBeGreaterThan(0);

      const launch = await backtests.launch(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/launch`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ backtestRunId: backtest.id }),
      }), draft.id);
      expect(launch.status).toBe(200);
      await expect(launch.json()).resolves.toMatchObject({ status: "running", backtestRunId: backtest.id });

      const scheduledHistory = await makeHistory(SCHEDULED_AT).getHistory("AAPL");
      const logs: Record<string, unknown>[] = [];
      const scheduler = createPaperScheduler({
        repository: paperRepository,
        secret: "scheduled-paper-integration-secret",
        getHistory: async () => scheduledHistory,
        acquireLock: async () => ({ release: async () => undefined }),
        now: () => SCHEDULED_AT,
        log: (entry) => logs.push(entry),
      });
      const scheduledResponse = await scheduler.run(new Request(`${APP_ORIGIN}/api/cron/paper-evaluations`, {
        method: "POST",
        headers: { authorization: "Bearer scheduled-paper-integration-secret" },
      }));
      expect(scheduledResponse.status, JSON.stringify(logs)).toBe(200);
      await expect(scheduledResponse.json()).resolves.toMatchObject({ evaluated: 1, opened: 1, failures: 0 });

      const tape = await paperRepository.listTape(session.user.id, draft.id, 10);
      expect(tape).toHaveLength(1);
      expect(tape[0]).toMatchObject({
        tickId: `replay-${Date.parse("2026-11-10T15:00:00.000Z")}`,
        action: "open",
        snapshotSource: "crius_robinhood_chain_candles",
      });
      expect(await paperRepository.listOrders(session.user.id, draft.id, 10)).toMatchObject([
        { executionMode: "PAPER", status: "filled", premiumSource: "modeled" },
      ]);
      const replay = await scheduler.run(new Request(`${APP_ORIGIN}/api/cron/paper-evaluations`, {
        method: "POST",
        headers: { authorization: "Bearer scheduled-paper-integration-secret" },
      }));
      await expect(replay.json()).resolves.toMatchObject({ evaluated: 0, opened: 0, failures: 0 });
      expect(await paperRepository.listTape(session.user.id, draft.id, 10)).toHaveLength(1);
    } finally {
      await connection.close();
    }
  }, 30_000);
});
