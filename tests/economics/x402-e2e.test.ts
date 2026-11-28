import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agents, paperAccounts, users } from "../../db/schema";
import { createDatabase } from "../../lib/db/client";
import type { DatabaseConnection } from "../../lib/db/client";
import { parseUsdgToAtomic, ROBINHOOD_MAINNET_CAIP2, USDG_ADDRESS_MAINNET } from "../../lib/economics/atomic";
import { DrizzleEconomicRepository } from "../../lib/economics/drizzle-repository";
import { DEFAULT_HOUSE_ECONOMIC_MANDATE, OPTRA_VOLATILITY_PROVIDER_ID } from "../../lib/economics/types";
import { executePaidVolatilityRequest } from "../../lib/economics/x402-client";
import { verifyX402ExactEvmPayment } from "../../lib/economics/x402-signer";
import { runTick } from "../../lib/engine/run-tick";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOW = new Date("2026-11-28T15:30:00.000Z");
const PAY_TO = "0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848" as const;

function makeMock402Fetcher(options?: { stale?: boolean; wrongSymbol?: boolean }) {
  const requirement = {
    x402Version: 2 as const,
    scheme: "exact" as const,
    network: ROBINHOOD_MAINNET_CAIP2,
    asset: USDG_ADDRESS_MAINNET,
    amount: parseUsdgToAtomic("0.02"),
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "Global Dollar", version: "1" },
  };
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const parsedUrl = new URL(url, "http://localhost");
    const headers = new Headers(init?.headers);
    const sig = headers.get("payment-signature");
    if (!sig) {
      const body = { x402Version: 2, error: "Payment Required", accepts: [requirement] };
      return Response.json(body, {
        status: 402,
        headers: { "payment-required": Buffer.from(JSON.stringify(body), "utf8").toString("base64url") },
      });
    }
    const verified = await verifyX402ExactEvmPayment(sig, PAY_TO, requirement.amount, USDG_ADDRESS_MAINNET, ROBINHOOD_MAINNET_CAIP2);
    if (!verified.valid) {
      return Response.json({ error: verified.reason }, { status: 402 });
    }
    const symbol = options?.wrongSymbol ? "AAPL" : (parsedUrl.searchParams.get("symbol") ?? "NVDA");
    const observedAt = options?.stale ? "2026-11-20T10:00:00.000Z" : "2026-11-28T15:00:00.000Z";
    const receipt = {
      success: true,
      settlementMode: "PAPER_REHEARSAL",
      paymentReference: "x402-eip3009-verified-test",
      settlementReference: null,
      txHash: null,
    };
    return Response.json(
      {
        data: {
          schema: "optra.volatility.v1",
          providerId: OPTRA_VOLATILITY_PROVIDER_ID,
          symbol,
          observedAt,
          spotUsd: 138.5,
          realizedVolatility30d: 0.41,
          impliedVolatility: 0.451,
          ivRank: 64,
          regime: "ELEVATED_VOL",
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

describe("Wave A x402 Economic Autonomy E2E (PGlite + real EIP-3009)", () => {
  let rootDir: string | undefined;
  const open: DatabaseConnection[] = [];

  afterEach(async () => {
    for (const conn of open.splice(0)) await conn.close().catch(() => undefined);
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  async function seedAgent(opts?: { balanceUsdg?: string; isHouse?: boolean }) {
    rootDir = mkdtempSync(join(tmpdir(), "optra-x402-"));
    const conn = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    open.push(conn);

    const [user] = await conn.db.insert(users).values({ address: "0x1111111111111111111111111111111111111111" }).returning();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "NVDA", protectedShares: "100", initialCapitalUsd: "100000", name: "NVDA Protective Put" });
    const recipeHash = canonicalRecipeHash(recipe);
    const [agent] = await conn.db
      .insert(agents)
      .values({
        ownerId: user!.id,
        name: recipe.name,
        templateId: "protective_put",
        status: "running",
        recipe,
        recipeHash,
        kind: opts?.isHouse ? "house" : "user",
        visibility: opts?.isHouse ? "public" : "private",
      })
      .returning();

    // Seed Trading Capital (completely separate from Service Budget).
    await conn.db.insert(paperAccounts).values({
      agentId: agent!.id,
      initialCapitalUsd: "100000",
      cashUsd: "100000",
      realizedPnlUsd: "0",
      peakEquityUsd: "100000",
      dailyStartEquityUsd: "100000",
      dailyStartDate: "2026-11-28",
    });

    const economicRepo = new DrizzleEconomicRepository(conn.db);
    await economicRepo.getOrCreateEconomicAccount(agent!.id, user!.id, {
      isHouseAgent: opts?.isHouse ?? false,
      initialMandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      initialBalanceAtomic: parseUsdgToAtomic(opts?.balanceUsdg ?? "1.00"),
      now: NOW,
    });

    return { conn, user: user!, agent: agent!, recipe, recipeHash, economicRepo };
  }

  it("completes full x402 payment, validates resource, feeds strategy decision, and records correlated Tape trail", async () => {
    const { agent, recipe, recipeHash, economicRepo } = await seedAgent({ balanceUsdg: "1.00", isHouse: true });
    const provider = await economicRepo.getServiceProvider(OPTRA_VOLATILITY_PROVIDER_ID);
    const decisionId = `${agent.id}:tick-100`;

    const res = await executePaidVolatilityRequest({
      agentId: agent.id,
      agentStatus: "running",
      request: {
        decisionId,
        agentId: agent.id,
        category: "VOLATILITY_DATA",
        providerId: OPTRA_VOLATILITY_PROVIDER_ID,
        purpose: "Acquire NVDA volatility regime",
        underlyingSymbol: "NVDA",
        maxPriceAtomic: parseUsdgToAtomic("0.10"),
        asset: "USDG",
        criticality: "OPTIONAL",
        requestNonce: "nonce-100",
        idempotencyKey: "x402-tick-100",
        createdAt: NOW.toISOString(),
      },
      provider,
      economicRepo,
      fetcher: makeMock402Fetcher(),
      now: NOW,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.symbol).toBe("NVDA");
    expect(res.data.impliedVolatility).toBe(0.451);
    expect(res.paymentRecord.decisionId).toBe(decisionId);
    expect(res.paymentRecord.status).toBe("RECONCILED");
    expect(res.paymentRecord.validationStatus).toBe("VALIDATED");

    // Verify isolated Service Budget debited 0.02 USDG (1.00 -> 0.98)
    const acct = await economicRepo.getOrCreateEconomicAccount(agent.id, agent.ownerId, { now: NOW });
    expect(acct.serviceBalanceAtomic).toBe(parseUsdgToAtomic("0.98"));
    expect(acct.spentTodayAtomic).toBe(parseUsdgToAtomic("0.02"));

    // Feed paid resource into strategy evaluation and verify decision shares decisionId
    const tickResult = runTick({
      agentId: agent.id,
      tickId: "tick-100",
      occurredAt: NOW.toISOString(),
      recipe,
      recipeHash,
      snapshot: null,
      paidVolatilityResource: res.data,
      state: { status: "running" },
    });
    expect(tickResult.decision.id).toBe(decisionId);
    expect(tickResult.decision.marketContext?.x402Resource).toBeDefined();

    // Verify Tape event trail
    const tape = await economicRepo.listEconomicTapeEvents(agent.id, 50);
    const types = tape.map((e) => e.eventType);
    expect(types).toContain("RESOURCE_REQUIRED");
    expect(types).toContain("SERVICE_QUOTED");
    expect(types).toContain("X402_PAYMENT_AUTHORIZED");
    expect(types).toContain("X402_PAYMENT_SETTLED");
    expect(types).toContain("RESOURCE_RECEIVED");
    expect(types).toContain("RESOURCE_VALIDATED");
  });

  it("denies over-budget payment and prevents trading capital from funding machine services", async () => {
    // Agent has $100,000 Trading Capital, but 0.00 USDG Service Budget!
    const { agent, economicRepo } = await seedAgent({ balanceUsdg: "0" });
    const provider = await economicRepo.getServiceProvider(OPTRA_VOLATILITY_PROVIDER_ID);

    const res = await executePaidVolatilityRequest({
      agentId: agent.id,
      agentStatus: "running",
      request: {
        decisionId: `${agent.id}:tick-empty`,
        agentId: agent.id,
        category: "VOLATILITY_DATA",
        providerId: OPTRA_VOLATILITY_PROVIDER_ID,
        purpose: "Acquire NVDA volatility regime",
        underlyingSymbol: "NVDA",
        maxPriceAtomic: parseUsdgToAtomic("0.10"),
        asset: "USDG",
        criticality: "OPTIONAL",
        requestNonce: "nonce-empty",
        idempotencyKey: "x402-tick-empty",
        createdAt: NOW.toISOString(),
      },
      provider,
      economicRepo,
      fetcher: makeMock402Fetcher(),
      now: NOW,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reasonCode).toBe("DAILY_BUDGET_EXCEEDED");

    const tape = await economicRepo.listEconomicTapeEvents(agent.id, 50);
    expect(tape.some((e) => e.eventType === "X402_PAYMENT_DENIED")).toBe(true);
  });

  it("denies unknown provider by default", async () => {
    const { agent, economicRepo } = await seedAgent({ balanceUsdg: "1.00" });

    const res = await executePaidVolatilityRequest({
      agentId: agent.id,
      agentStatus: "running",
      request: {
        decisionId: `${agent.id}:tick-unknown`,
        agentId: agent.id,
        category: "VOLATILITY_DATA",
        providerId: "unapproved-provider-xyz",
        purpose: "Attempt unapproved provider",
        underlyingSymbol: "NVDA",
        maxPriceAtomic: parseUsdgToAtomic("0.10"),
        asset: "USDG",
        criticality: "OPTIONAL",
        requestNonce: "nonce-unknown",
        idempotencyKey: "x402-tick-unknown",
        createdAt: NOW.toISOString(),
      },
      provider: null,
      economicRepo,
      fetcher: makeMock402Fetcher(),
      now: NOW,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reasonCode).toBe("PROVIDER_NOT_APPROVED");
  });

  it("prevents duplicate payment on idempotency replay", async () => {
    const { agent, economicRepo } = await seedAgent({ balanceUsdg: "1.00" });
    const provider = await economicRepo.getServiceProvider(OPTRA_VOLATILITY_PROVIDER_ID);
    const req = {
      decisionId: `${agent.id}:tick-replay`,
      agentId: agent.id,
      category: "VOLATILITY_DATA" as const,
      providerId: OPTRA_VOLATILITY_PROVIDER_ID,
      purpose: "Replay guard test",
      underlyingSymbol: "NVDA",
      maxPriceAtomic: parseUsdgToAtomic("0.10"),
      asset: "USDG" as const,
      criticality: "OPTIONAL" as const,
      requestNonce: "nonce-replay",
      idempotencyKey: "x402-tick-replay",
      createdAt: NOW.toISOString(),
    };

    const first = await executePaidVolatilityRequest({
      agentId: agent.id,
      agentStatus: "running",
      request: req,
      provider,
      economicRepo,
      fetcher: makeMock402Fetcher(),
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const second = await executePaidVolatilityRequest({
      agentId: agent.id,
      agentStatus: "running",
      request: req,
      provider,
      economicRepo,
      fetcher: makeMock402Fetcher(),
      now: NOW,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.duplicate).toBe(true);
    }

    // Balance must only be debited ONCE (1.00 - 0.02 = 0.98)
    const acct = await economicRepo.getOrCreateEconomicAccount(agent.id, agent.ownerId, { now: NOW });
    expect(acct.serviceBalanceAtomic).toBe(parseUsdgToAtomic("0.98"));
  });

  it("rejects stale paid resource and marks it unusable", async () => {
    const { agent, economicRepo } = await seedAgent({ balanceUsdg: "1.00" });
    const provider = await economicRepo.getServiceProvider(OPTRA_VOLATILITY_PROVIDER_ID);

    const res = await executePaidVolatilityRequest({
      agentId: agent.id,
      agentStatus: "running",
      request: {
        decisionId: `${agent.id}:tick-stale`,
        agentId: agent.id,
        category: "VOLATILITY_DATA",
        providerId: OPTRA_VOLATILITY_PROVIDER_ID,
        purpose: "Stale data guard test",
        underlyingSymbol: "NVDA",
        maxPriceAtomic: parseUsdgToAtomic("0.10"),
        asset: "USDG",
        criticality: "OPTIONAL",
        requestNonce: "nonce-stale",
        idempotencyKey: "x402-tick-stale",
        createdAt: NOW.toISOString(),
      },
      provider,
      economicRepo,
      fetcher: makeMock402Fetcher({ stale: true }),
      now: NOW,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reasonCode).toBe("STALE_DATA");
    expect(res.paymentRecord?.validationStatus).toBe("REJECTED");

    const tape = await economicRepo.listEconomicTapeEvents(agent.id, 50);
    expect(tape.some((e) => e.eventType === "RESOURCE_REJECTED")).toBe(true);
  });
});
