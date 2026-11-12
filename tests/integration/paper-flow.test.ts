import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createAuthHandlers } from "../../lib/auth/handlers";
import { createWalletAuthService } from "../../lib/auth/service";
import { createBacktestHandlers } from "../../lib/backtest/handlers";
import { DrizzleBacktestRepository } from "../../lib/backtest/drizzle-repository";
import { createDatabase } from "../../lib/db/client";
import { SessionSchema } from "../../lib/domain/contracts";
import type { MarketSnapshot } from "../../lib/domain/contracts";
import { runTick } from "../../lib/engine/run-tick";
import { hashMarketCandles } from "../../lib/backtest/run";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";
import { createAgentHandlers } from "../../lib/paper/agents";
import { createPaperHandlers } from "../../lib/paper/handlers";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";

const APP_ORIGIN = "http://localhost:3000";
const ACCOUNT = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const capture = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  capturedAt: string;
  asset: Record<string, unknown>;
  candles: unknown;
  corpActions: unknown[];
  quote: { quotes: Array<Record<string, string | boolean>> };
};
const NOW = new Date(capture.capturedAt);
const quote = capture.quote.quotes[0]!;
const SNAPSHOT: MarketSnapshot = {
  symbol: "AAPL",
  source: "robinhood_stock_token_api",
  observedAt: String(quote.generatedAt),
  receivedAt: NOW.toISOString(),
  underlyingBidUsd: String(quote.bid),
  underlyingAskUsd: String(quote.ask),
  currentMultiplier: String(capture.asset.currentMultiplier),
  tokenBidUsd: String(quote.tokenBid),
  tokenAskUsd: String(quote.tokenAsk),
  currency: "USD",
  stale: false,
  tradingHalt: Boolean(quote.isTradingHalt),
  pricingMethod: "recorded",
};

describe("wallet-to-paper API integration with captured provider data and database persistence", () => {
  let rootDir: string;
  afterEach(() => { if (rootDir) rmSync(rootDir, { recursive: true, force: true }); });

  it("authenticates, backtests, launches, records blocked and successful paper ticks, and replays idempotently", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-paper-flow-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const marketFeed = createCriusHistoryFeed({
        fetcher: (async (input: string | URL | Request) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
          if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: capture.corpActions });
          return Response.json(url.pathname.endsWith("/candles") ? capture.candles : { assets: [capture.asset] });
        }) as typeof fetch,
        now: () => NOW,
        listMarkets: async () => [{ symbol: "AAPL", name: "Apple", currentMultiplier: String(capture.asset.currentMultiplier), tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" }],
      });
      const history = await marketFeed.getHistory("AAPL");
      expect(history.coverage).toMatchObject({ ready: true, availableCandles: 1499, fillApplied: false, multiplierStatus: "stable_verified" });

      const authRepository = new DrizzleAuthRepository(connection.db);
      const authService = createWalletAuthService(authRepository, { appOrigin: APP_ORIGIN, now: () => NOW });
      const auth = createAuthHandlers(authService, { secureCookie: false, now: () => NOW });
      const challengeResponse = await auth.challenge(new Request(`${APP_ORIGIN}/api/auth/challenge`, {
        method: "POST", headers: { origin: APP_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ address: ACCOUNT.address }),
      }));
      expect(challengeResponse.status).toBe(200);
      const challenge = await challengeResponse.json() as { nonce: string; message: string };
      const signature = await ACCOUNT.signMessage({ message: challenge.message });
      const verifyResponse = await auth.verify(new Request(`${APP_ORIGIN}/api/auth/verify`, {
        method: "POST", headers: { origin: APP_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ address: ACCOUNT.address, nonce: challenge.nonce, signature }),
      }));
      expect(verifyResponse.status).toBe(200);
      const cookie = verifyResponse.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toMatch(/^optra_session=/);
      const sessionResponse = await auth.me(new Request(`${APP_ORIGIN}/api/me`, { headers: { cookie: cookie! } }));
      const session = SessionSchema.parse(await sessionResponse.json());

      const readSession = async (request: Request) => {
        const response = await auth.me(request);
        return response.ok ? SessionSchema.parse(await response.json()) : response;
      };
      const paperRepository = new DrizzlePaperRepository(connection.db);
      const backtestRepository = new DrizzleBacktestRepository(connection.db);
      const agentHandlers = createAgentHandlers({ repository: paperRepository, backtests: backtestRepository, readSession, now: () => NOW });
      const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000", name: "AAPL Protective Put" });
      const createResponse = await agentHandlers.create(new Request(`${APP_ORIGIN}/api/agents`, {
        method: "POST", headers: { cookie: cookie!, "content-type": "application/json" }, body: JSON.stringify({ recipe }),
      }));
      expect(createResponse.status).toBe(201);
      const draft = await createResponse.json() as { id: string; recipeHash: string; status: string };
      expect(draft.status).toBe("draft");

      const backtestHandlers = createBacktestHandlers({
        repository: backtestRepository,
        agents: paperRepository,
        readSession,
        listMarkets: async () => [{ symbol: "AAPL" }],
        getHistory: async () => history,
        now: () => NOW,
        newRunId: () => "123e4567-e89b-42d3-a456-426614174001",
      });
      const backtestResponse = await backtestHandlers.create(new Request(`${APP_ORIGIN}/api/backtests`, {
        method: "POST", headers: { cookie: cookie!, "content-type": "application/json" }, body: JSON.stringify({ recipe }),
      }));
      expect(backtestResponse.status).toBe(201);
      const backtest = await backtestResponse.json() as {
        id: string;
        status: string;
        entryOrderCount: number;
        historyDataHash: string;
        metrics: {
          benchmarks?: {
            window: { decisionSamples: number };
            underlying: { method: string; dividendsIncluded: boolean; feesIncluded: boolean };
            cash: { denomination: string; method: string; usdGPricePath: string };
          };
        };
      };
      expect(backtest).toMatchObject({ status: "complete", entryOrderCount: expect.any(Number), historyDataHash: expect.stringMatching(/^sha256:/), metrics: expect.any(Object) });
      expect(backtest.entryOrderCount).toBeGreaterThan(0);
      expect(backtest.metrics.benchmarks).toMatchObject({
        window: { decisionSamples: 720 },
        underlying: { method: "buy_and_hold_price_only", dividendsIncluded: false, feesIncluded: false },
        cash: { denomination: "USD", method: "flat_no_yield", usdGPricePath: "not_modeled" },
      });
      expect(await backtestRepository.getBacktestRun(session.user.id, backtest.id)).toMatchObject({
        status: "complete",
        historyDataHash: backtest.historyDataHash,
        metrics: { benchmarks: { window: { decisionSamples: 720 }, cash: { usdGPricePath: "not_modeled" } } },
      });
      const persistedHistory = await backtestRepository.getBacktestHistory(session.user.id, backtest.id);
      expect(persistedHistory).toHaveLength(history.candles.length);
      expect(persistedHistory).toHaveLength(1499);
      expect(hashMarketCandles(persistedHistory!)).toBe(backtest.historyDataHash);

      const launchResponse = await backtestHandlers.launch(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/launch`, {
        method: "POST", headers: { cookie: cookie!, "content-type": "application/json" }, body: JSON.stringify({ backtestRunId: backtest.id }),
      }), draft.id);
      const launchPayload = await launchResponse.json();
      expect(launchResponse.status, JSON.stringify(launchPayload)).toBe(200);
      expect(launchPayload).toMatchObject({ status: "running", backtestRunId: backtest.id });

      const replayRecipeHash = canonicalRecipeHash(recipe);
      let replayAt: string | null = null;
      let secondReplayAt: string | null = null;
      for (let index = 721; index < history.candles.length; index += 1) {
        const candle = history.candles[index]!;
        const probe = runTick({
          agentId: draft.id, tickId: `probe-${index}`, occurredAt: candle.endAt, recipe, recipeHash: replayRecipeHash,
          snapshot: null, currentCandle: candle, history: history.candles.slice(0, index),
          corporateActionDates: history.corporateActionDates,
          account: { initialCapitalUsd: "100000.00", cashUsd: "100000.00", realizedPnlUsd: "0", peakEquityUsd: "100000.00", dailyStartEquityUsd: "100000.00", dailyStartDate: candle.endAt.slice(0, 10) },
          state: { status: "running" },
        });
        if (probe.decision.action === "open") {
          if (replayAt === null) replayAt = candle.endAt;
          else { secondReplayAt = candle.endAt; break; }
        }
      }
      expect(replayAt).not.toBeNull();
      expect(secondReplayAt).not.toBeNull();

      const paper = createPaperHandlers({
        repository: paperRepository,
        readSession,
        getSnapshot: async () => SNAPSHOT,
        getHistory: async () => history,
        now: () => NOW,
      });
      const blockedAt = history.candles[721]!.endAt;
      const blockedTick = await paper.tick(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/tick?asOf=${encodeURIComponent(blockedAt)}`, {
        method: "POST", headers: { cookie: cookie!, "idempotency-key": "closed-session-tick" },
      }), draft.id);
      expect(blockedTick.status).toBe(200);
      await expect(blockedTick.json()).resolves.toMatchObject({ executionMode: "PAPER", orderCount: 0, decision: { action: "skip", hookResults: expect.arrayContaining([expect.objectContaining({ hookId: "sessia", status: "block" })]) } });

      let stateReadCount = 0;
      let releaseStateReads!: () => void;
      const bothStateReads = new Promise<void>((resolve) => { releaseStateReads = resolve; });
      const getPaperState = paperRepository.getPaperState.bind(paperRepository);
      // If an unlocked portfolio read returns, release two callers only after they hold the same pre-tick state.
      const raceRepository = new Proxy(paperRepository, {
        get(target, property, receiver) {
          if (property === "getPaperState") {
            return async (...args: Parameters<typeof paperRepository.getPaperState>) => {
              const state = await getPaperState(...args);
              stateReadCount += 1;
              if (stateReadCount === 2) releaseStateReads();
              await bothStateReads;
              return state;
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const racePaper = createPaperHandlers({
        repository: raceRepository,
        readSession,
        getSnapshot: async () => SNAPSHOT,
        getHistory: async () => history,
        now: () => NOW,
      });
      const replayRequest = (at: string) => new Request(`${APP_ORIGIN}/api/agents/${draft.id}/tick?asOf=${encodeURIComponent(at)}`, {
        method: "POST", headers: { cookie: cookie!, "idempotency-key": `historical-paper-replay-${Date.parse(at)}` },
      });
      const concurrentResponses = await Promise.all([
        racePaper.tick(replayRequest(replayAt!), draft.id),
        racePaper.tick(replayRequest(secondReplayAt!), draft.id),
      ]);
      expect(stateReadCount).toBe(0);
      expect(concurrentResponses.map((response) => response.status)).toEqual([200, 200]);
      const concurrentPayloads = await Promise.all(concurrentResponses.map((response) => response.json())) as Array<{
        decision: { action: string; tickId: string; snapshotSource: string };
        orderCount: number;
        idempotentReplay: boolean;
      }>;
      expect(concurrentPayloads.map((payload) => payload.decision.action).sort()).toEqual(["hold", "open"]);
      expect(concurrentPayloads.find((payload) => payload.decision.action === "open")).toMatchObject({
        orderCount: 1, idempotentReplay: false, decision: { snapshotSource: "crius_robinhood_chain_candles" },
      });
      expect(concurrentPayloads.find((payload) => payload.decision.action === "hold")).toMatchObject({ orderCount: 0, idempotentReplay: false });
      const openedTickId = concurrentPayloads.find((payload) => payload.decision.action === "open")!.decision.tickId;
      const openedAt = [replayAt!, secondReplayAt!].find((at) => `replay-${Date.parse(at)}` === openedTickId)!;
      const replayRetry = await paper.tick(replayRequest(openedAt), draft.id);
      await expect(replayRetry.json()).resolves.toMatchObject({ executionMode: "PAPER", orderCount: 1, idempotentReplay: true });
      const closedSessionLiveTick = await paper.tick(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/tick`, {
        method: "POST", headers: { cookie: cookie!, "idempotency-key": "closed-session-live-tick" },
      }), draft.id);
      expect(closedSessionLiveTick.status).toBe(200);
      await expect(closedSessionLiveTick.json()).resolves.toMatchObject({
        executionMode: "PAPER", orderCount: 0,
        decision: { action: "hold", hookResults: expect.arrayContaining([expect.objectContaining({ hookId: "sessia", status: "block" })]) },
      });
      const backdatedTick = await paper.tick(replayRequest(history.candles[759]!.endAt), draft.id);
      expect(backdatedTick.status).toBe(409);
      await expect(backdatedTick.json()).resolves.toMatchObject({ error: { code: "CONFLICT" } });

      const tape = await paper.tape(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/tape`, { headers: { cookie: cookie! } }), draft.id);
      const positions = await paper.positions(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/positions`, { headers: { cookie: cookie! } }), draft.id);
      const tapePayload = await tape.json() as { decisions: Array<{ action: string; hookResults: unknown[]; marketContext?: Record<string, unknown> }>; orders: Array<Record<string, unknown>> };
      expect(tapePayload.decisions).toHaveLength(4);
      expect(tapePayload.decisions.map((decision) => decision.action)).toContain("skip");
      expect(tapePayload.decisions.map((decision) => decision.action)).toContain("open");
      expect(tapePayload.decisions.map((decision) => decision.action)).toContain("hold");
      expect(tapePayload.decisions.find((decision) => decision.action === "open")?.hookResults).toHaveLength(16);
      expect(tapePayload.decisions.find((decision) => decision.action === "open")?.marketContext?.historyDataHash).toMatch(/^sha256:/);
      expect(tapePayload.orders).toHaveLength(1);
      expect(tapePayload.orders[0]).toMatchObject({ executionMode: "PAPER", status: "filled", instrumentType: "modeled_option", premiumSource: "modeled", modelName: "black_scholes_european_put" });
      const persistedOrder = tapePayload.orders[0]!;
      const persistedPaperState = await paperRepository.getPaperState(session.user.id, draft.id);
      expect(persistedPaperState.position).toMatchObject({
        symbol: "AAPL", status: "open", quantity: persistedOrder.quantity, averageEntryUsd: persistedOrder.priceUsd,
      });
      expect(persistedPaperState.account).not.toBeNull();
      expect(Number(persistedPaperState.account!.cashUsd)).toBeCloseTo(
        Number(persistedPaperState.account!.initialCapitalUsd) - Number(persistedOrder.priceUsd) * Number(persistedOrder.quantity),
        2,
      );
      await expect(positions.json()).resolves.toMatchObject({ executionMode: "PAPER", positions: [expect.objectContaining({ status: "open", instrumentType: "modeled_option", optionType: "put", premiumSource: "modeled" })] });
      expect(await paperRepository.getOrderCount(session.user.id, draft.id, openedTickId)).toBe(1);

      const otherOwner = await authRepository.findOrCreateUser("0x0000000000000000000000000000000000000002");
      const privatePaper = createPaperHandlers({
        repository: paperRepository,
        readSession: async () => ({ user: { id: otherOwner.id, address: otherOwner.address }, expiresAt: "2026-11-19T08:10:04.500Z" }),
        getSnapshot: async () => SNAPSHOT,
        getHistory: async () => history,
        now: () => NOW,
      });
      const denied = await privatePaper.tick(new Request(`${APP_ORIGIN}/api/agents/${draft.id}/tick`, { method: "POST", headers: { "idempotency-key": "other-owner" } }), draft.id);
      expect(otherOwner.id).not.toBe(session.user.id);
      expect(denied.status).toBe(404);
    } finally {
      await connection.close();
    }
  }, 30_000);
});
