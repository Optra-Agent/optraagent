import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agents, paperAccounts, users } from "../../db/schema";
import { GET as volatilityOracleGet } from "../../app/api/x402/providers/volatility/route";
import { createDatabase } from "../../lib/db/client";
import type { DatabaseConnection } from "../../lib/db/client";
import { parseUsdgToAtomic, ROBINHOOD_MAINNET_CAIP2, USDG_ADDRESS_MAINNET } from "../../lib/economics/atomic";
import { acquireVolatilityResourceForTick, recordStrategyEvaluatedEvent } from "../../lib/economics/acquire-volatility-resource";
import { DrizzleEconomicRepository } from "../../lib/economics/drizzle-repository";
import { DEFAULT_HOUSE_ECONOMIC_MANDATE, OPTRA_VOLATILITY_PROVIDER_ID } from "../../lib/economics/types";
import { verifyX402ExactEvmPayment } from "../../lib/economics/x402-signer";
import { runTick } from "../../lib/engine/run-tick";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOW = new Date("2026-11-28T16:00:00.000Z");
const PAY_TO = "0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848" as const;

function makeLiveRouteBackedFetcher() {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const req = new Request(`http://localhost${url}`, init);
    const headers = new Headers(init?.headers);
    if (!headers.get("payment-signature")) {
      // Exercise the real Next.js 402 route handler directly!
      return volatilityOracleGet(req);
    }
    const sig = headers.get("payment-signature")!;
    const verified = await verifyX402ExactEvmPayment(
      sig,
      PAY_TO,
      parseUsdgToAtomic("0.02"),
      USDG_ADDRESS_MAINNET,
      ROBINHOOD_MAINNET_CAIP2,
    );
    if (!verified.valid) return Response.json({ error: verified.reason }, { status: 402 });

    const parsedUrl = new URL(url, "http://localhost");
    const receipt = {
      success: true,
      settlementMode: "PAPER_REHEARSAL",
      paymentReference: "x402-eip3009-runtime-proof",
      settlementReference: null,
      txHash: null,
    };
    return Response.json(
      {
        data: {
          schema: "optra.volatility.v1",
          providerId: OPTRA_VOLATILITY_PROVIDER_ID,
          symbol: parsedUrl.searchParams.get("symbol") ?? "NVDA",
          observedAt: NOW.toISOString(),
          spotUsd: 139.2,
          realizedVolatility30d: 0.39,
          impliedVolatility: 0.429,
          ivRank: 58,
          regime: "NORMAL_VOL",
          source: "crius_robinhood_chain_candles",
          sampleCount: 721,
          requestNonce: parsedUrl.searchParams.get("requestNonce") ?? undefined,
          decisionId: parsedUrl.searchParams.get("decisionId") ?? undefined,
        },
        x402Receipt: receipt,
      },
      {
        status: 200,
        headers: { "payment-response": Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url") },
      },
    );
  };
}

describe("Wave A House & Custom Agent Runtime Integration", () => {
  let rootDir: string | undefined;
  const open: DatabaseConnection[] = [];

  afterEach(async () => {
    for (const conn of open.splice(0)) await conn.close().catch(() => undefined);
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  it("exposes HTTP 402 Payment Required and health check on /api/x402/providers/volatility", async () => {
    const healthRes = await volatilityOracleGet(new Request("http://localhost/api/x402/providers/volatility?health=1"));
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean; ownership: string; liveSettlementEnabled: boolean };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.ownership).toBe("OPTRA_OWNED");
    expect(healthJson.liveSettlementEnabled).toBe(false);

    const quoteRes = await volatilityOracleGet(new Request("http://localhost/api/x402/providers/volatility?symbol=NVDA"));
    expect(quoteRes.status).toBe(402);
    expect(quoteRes.headers.get("payment-required")).toBeTruthy();
  });

  it("integrates autonomous x402 acquisition into both House Agent and Custom Agent decision ticks", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-runtime-"));
    const conn = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    open.push(conn);

    const [user] = await conn.db.insert(users).values({ address: "0x2222222222222222222222222222222222222222" }).returning();
    const houseRecipe = buildProtectivePutRecipe({ underlyingSymbol: "NVDA", protectedShares: "100", initialCapitalUsd: "100000", name: "House Protective Put" });
    const customRecipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "50", initialCapitalUsd: "50000", name: "Custom Protective Put" });

    const [houseAgent] = await conn.db.insert(agents).values({
      ownerId: user!.id, name: houseRecipe.name, templateId: "protective_put", status: "running",
      recipe: houseRecipe, recipeHash: canonicalRecipeHash(houseRecipe), kind: "house", visibility: "public",
    }).returning();
    const [customAgent] = await conn.db.insert(agents).values({
      ownerId: user!.id, name: customRecipe.name, templateId: "custom", status: "running",
      recipe: customRecipe, recipeHash: canonicalRecipeHash(customRecipe), kind: "user", visibility: "private",
    }).returning();

    const econRepo = new DrizzleEconomicRepository(conn.db);
    await econRepo.getOrCreateEconomicAccount(customAgent!.id, user!.id, {
      isHouseAgent: false,
      initialMandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      initialBalanceAtomic: parseUsdgToAtomic("1.00"),
      now: NOW,
    });

    await conn.db.insert(paperAccounts).values([
      { agentId: houseAgent!.id, initialCapitalUsd: "100000", cashUsd: "100000", realizedPnlUsd: "0", peakEquityUsd: "100000", dailyStartEquityUsd: "100000", dailyStartDate: "2026-11-28" },
      { agentId: customAgent!.id, initialCapitalUsd: "50000", cashUsd: "50000", realizedPnlUsd: "0", peakEquityUsd: "50000", dailyStartEquityUsd: "50000", dailyStartDate: "2026-11-28" },
    ]);

    const fetcher = makeLiveRouteBackedFetcher();

    for (const [agent, recipe, isHouse] of [
      [houseAgent!, houseRecipe, true],
      [customAgent!, customRecipe, false],
    ] as const) {
      const tickId = `tick-runtime-${isHouse ? "house" : "custom"}`;
      const acquired = await acquireVolatilityResourceForTick({
        db: conn.db,
        agentId: agent.id,
        ownerId: user!.id,
        agentStatus: "running",
        isHouseAgent: isHouse,
        underlyingSymbol: recipe.underlyingSymbol,
        tickId,
        occurredAt: NOW.toISOString(),
        fetcher,
        now: NOW,
      });

      expect(acquired.status).toBe("acquired");
      expect(acquired.volatilityData?.symbol).toBe(recipe.underlyingSymbol);

      const decision = runTick({
        agentId: agent.id,
        tickId,
        occurredAt: NOW.toISOString(),
        recipe,
        recipeHash: agent.recipeHash,
        snapshot: null,
        paidVolatilityResource: acquired.volatilityData,
        state: { status: "running" },
      });

      await recordStrategyEvaluatedEvent({
        db: conn.db,
        agentId: agent.id,
        decisionId: decision.decision.id,
        action: decision.decision.action,
        reason: decision.decision.reason,
        now: NOW,
      });

      expect(decision.decision.id).toBe(acquired.decisionId);
      const tape = await econRepo.listEconomicTapeEvents(agent.id, 50);
      expect(tape.some((e) => e.eventType === "STRATEGY_EVALUATED" && e.decisionId === decision.decision.id)).toBe(true);
      expect(tape.some((e) => e.eventType === "X402_PAYMENT_SETTLED" && e.decisionId === decision.decision.id)).toBe(true);
    }
  });

  it("blocks non-pilot agents when X402_FACILITATOR_MODE=live and X402_PILOT_AGENT_ID is set", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-pilot-guard-"));
    const conn = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    open.push(conn);

    const [user] = await conn.db.insert(users).values({ address: "0x3333333333333333333333333333333333333333" }).returning();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "NVDA", protectedShares: "100", initialCapitalUsd: "100000", name: "Non-Pilot Agent" });
    const [otherAgent] = await conn.db.insert(agents).values({
      ownerId: user!.id, name: recipe.name, templateId: "custom", status: "running",
      recipe, recipeHash: canonicalRecipeHash(recipe), kind: "user", visibility: "private",
    }).returning();
    const econRepo = new DrizzleEconomicRepository(conn.db);
    await econRepo.getOrCreateEconomicAccount(otherAgent!.id, user!.id, {
      isHouseAgent: false,
      initialMandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      initialBalanceAtomic: parseUsdgToAtomic("1.00"),
      now: NOW,
    });

    const prevMode = process.env.X402_FACILITATOR_MODE;
    const prevPilot = process.env.X402_PILOT_AGENT_ID;
    process.env.X402_FACILITATOR_MODE = "live";
    process.env.X402_PILOT_AGENT_ID = "00000000-0000-0000-0000-000000000001";
    try {
      const res = await acquireVolatilityResourceForTick({
        db: conn.db,
        agentId: otherAgent!.id,
        ownerId: user!.id,
        agentStatus: "running",
        isHouseAgent: false,
        underlyingSymbol: "NVDA",
        tickId: "tick-non-pilot",
        occurredAt: NOW.toISOString(),
        now: NOW,
      });
      expect(res.status).toBe("disabled");
      expect(res.reason).toContain("X402_PILOT_AGENT_ID");
    } finally {
      if (prevMode === undefined) delete process.env.X402_FACILITATOR_MODE;
      else process.env.X402_FACILITATOR_MODE = prevMode;
      if (prevPilot === undefined) delete process.env.X402_PILOT_AGENT_ID;
      else process.env.X402_PILOT_AGENT_ID = prevPilot;
    }
  });

  it("enforces atomic one-payment pilot cap across concurrent reservations", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-pilot-cap-"));
    const conn = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    open.push(conn);

    const [user] = await conn.db.insert(users).values({ address: "0x4444444444444444444444444444444444444444" }).returning();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "NVDA", protectedShares: "100", initialCapitalUsd: "100000", name: "Pilot Agent" });
    const [pilotAgent] = await conn.db.insert(agents).values({
      ownerId: user!.id, name: recipe.name, templateId: "custom", status: "running",
      recipe, recipeHash: canonicalRecipeHash(recipe), kind: "user", visibility: "private",
    }).returning();

    const econRepo = new DrizzleEconomicRepository(conn.db);
    await econRepo.getOrCreateEconomicAccount(pilotAgent!.id, user!.id, {
      isHouseAgent: false,
      initialMandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      initialBalanceAtomic: parseUsdgToAtomic("1.00"),
      now: NOW,
    });
    const provider = await econRepo.getServiceProvider(OPTRA_VOLATILITY_PROVIDER_ID);

    const prevMode = process.env.X402_FACILITATOR_MODE;
    const prevPilot = process.env.X402_PILOT_AGENT_ID;
    const prevMax = process.env.X402_PILOT_MAX_PAYMENTS;
    process.env.X402_FACILITATOR_MODE = "live";
    process.env.X402_PILOT_AGENT_ID = pilotAgent!.id;
    process.env.X402_PILOT_MAX_PAYMENTS = "1";

    try {
      const [r1, r2] = await Promise.all([
        econRepo.authorizePaymentRequest({
          agentId: pilotAgent!.id,
          agentStatus: "running",
          request: {
            decisionId: `${pilotAgent!.id}:tick-c1`,
            agentId: pilotAgent!.id,
            category: "VOLATILITY_DATA",
            providerId: OPTRA_VOLATILITY_PROVIDER_ID,
            purpose: "Concurrent tick 1",
            underlyingSymbol: "NVDA",
            maxPriceAtomic: parseUsdgToAtomic("0.05"),
            quotedPriceAtomic: parseUsdgToAtomic("0.02"),
            asset: "USDG",
            criticality: "OPTIONAL",
            requestNonce: "nonce-c1",
            idempotencyKey: "idemp-c1",
            createdAt: NOW.toISOString(),
          },
          requestHash: "sha256:" + "a".repeat(64),
          provider,
          now: NOW,
        }),
        econRepo.authorizePaymentRequest({
          agentId: pilotAgent!.id,
          agentStatus: "running",
          request: {
            decisionId: `${pilotAgent!.id}:tick-c2`,
            agentId: pilotAgent!.id,
            category: "VOLATILITY_DATA",
            providerId: OPTRA_VOLATILITY_PROVIDER_ID,
            purpose: "Concurrent tick 2",
            underlyingSymbol: "NVDA",
            maxPriceAtomic: parseUsdgToAtomic("0.05"),
            quotedPriceAtomic: parseUsdgToAtomic("0.02"),
            asset: "USDG",
            criticality: "OPTIONAL",
            requestNonce: "nonce-c2",
            idempotencyKey: "idemp-c2",
            createdAt: NOW.toISOString(),
          },
          requestHash: "sha256:" + "b".repeat(64),
          provider,
          now: NOW,
        }),
      ]);

      const allowedCount = [r1.decision.allowed, r2.decision.allowed].filter(Boolean).length;
      expect(allowedCount).toBe(1);
    } finally {
      if (prevMode === undefined) delete process.env.X402_FACILITATOR_MODE;
      else process.env.X402_FACILITATOR_MODE = prevMode;
      if (prevPilot === undefined) delete process.env.X402_PILOT_AGENT_ID;
      else process.env.X402_PILOT_AGENT_ID = prevPilot;
      if (prevMax === undefined) delete process.env.X402_PILOT_MAX_PAYMENTS;
      else process.env.X402_PILOT_MAX_PAYMENTS = prevMax;
    }
  });
});

