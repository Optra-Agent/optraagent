/**
 * OPTRA x402 — Covered Call Historical Replay & Execution Proof
 *
 * Demonstrates the complete, point-in-time-valid x402 -> Strategy -> Order -> Fill -> Position -> Tape
 * lifecycle using verified Robinhood/Crius market data and Robinhood earnings data:
 *
 *   1. Fetches live Robinhood snapshot, Crius 30d+ hourly candles, and Robinhood earnings for NVDA.
 *   2. Scans verified historical candles for an eligible regular US equity session window.
 *   3. Computes point-in-time volatility strictly from candles <= replay timestamp (zero look-ahead bias).
 *   4. Executes x402 resource acquisition in PAPER_REHEARSAL mode against an isolated PGlite DB,
 *      persisting x402PaymentRecords and x402TapeEvents.
 *   5. Evaluates Covered Call strategy via runStrategyTick() and persists the resulting
 *      paper order, paper fill, open option position, and correlated Decision Tape via DrizzlePaperRepository.
 *
 * Distinct from the original Protective Put Mainnet Pilot:
 *   - Original Mainnet Pilot: Protective Put on local pilot DB (agent 55ce0382-8e19-44ea-8024-23f19f877bdf),
 *     0.02 USDG settled on Robinhood Chain (4663), tx 0x785be0819076ce0f238157be3c273ee114c61187230207f297ffca958b32325f.
 *   - This Script: Covered Call Historical Replay in PAPER_REHEARSAL mode (no on-chain payment repeated).
 *
 * Usage:
 *   bun run scripts/demo-pilot-strategy-tick.ts
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../db/schema";
import type { AppDatabase } from "../lib/db/client";
import { DrizzleEconomicRepository } from "../lib/economics/drizzle-repository";
import { parseUsdgToAtomic } from "../lib/economics/atomic";
import type { VolatilityOraclePayload } from "../lib/economics/resource-validator";
import { OPTRA_VOLATILITY_PROVIDER_ID } from "../lib/economics/types";
import { executePaidVolatilityRequest } from "../lib/economics/x402-client";
import { acquireVolatilityResourceForTick, recordStrategyEvaluatedEvent } from "../lib/economics/acquire-volatility-resource";
import { runStrategyTick } from "../lib/engine/strategy/run-strategy-tick";
import { isRegularEquitySession } from "../lib/engine/us-market-session";
import { buildHouseRecipe } from "../lib/hooks/house-specs";
import { canonicalRecipeHash } from "../lib/hooks/recipe-validator";
import { getEarningsFeed, getMarketFeed, getMarketHistoryFeed } from "../lib/market/runtime";
import { rv30ImpliedVolatility } from "../lib/options/black-scholes";
import { DrizzlePaperRepository } from "../lib/paper/drizzle-repository";

const PILOT_TX = "0x785be0819076ce0f238157be3c273ee114c61187230207f297ffca958b32325f";
const SYMBOL = "NVDA";

async function main() {
  process.env.X402_FACILITATOR_MODE = "paper";

  const recipe = buildHouseRecipe("covered_call", {
    underlyingSymbol: SYMBOL,
    initialCapitalUsd: 100_000,
    referenceShares: 100,
    name: "x402 Covered Call Historical Replay — NVDA",
  });
  const recipeHash = canonicalRecipeHash(recipe);

  console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║   OPTRA x402 — Covered Call Historical Replay (Full Persistence)     ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ── 1. Live market & earnings feeds ────────────────────────────────────────
  console.log(`\n[1/4] Fetching Robinhood snapshot, Crius history, and Robinhood earnings for ${SYMBOL}...`);
  const snapshot = await getMarketFeed().getSnapshot(SYMBOL).catch(() => null);
  const histResult = await getMarketHistoryFeed().getHistory(SYMBOL);
  const candles = histResult.candles;
  const corporateActionDates = histResult.corporateActionDates ?? [];
  const earnings = await getEarningsFeed().getEarnings(SYMBOL);

  console.log(`      ✓ Snapshot: ${snapshot ? `$${((Number(snapshot.underlyingBidUsd) + Number(snapshot.underlyingAskUsd)) / 2).toFixed(2)} (${snapshot.source})` : "unavailable"}`);
  console.log(`      ✓ History:  ${candles.length} candles (${histResult.coverage.consecutiveHours}h consecutive)`);
  console.log(`      ✓ Earnings: ${earnings.events.length} events (${earnings.source})`);

  // ── 2. Find eligible historical regular-session window ─────────────────────
  console.log(`\n[2/4] Scanning verified historical candles for an eligible regular-session window...`);
  let selectedIdx = -1;
  for (let idx = candles.length - 1; idx >= 170; idx--) {
    const c = candles[idx]!;
    if (c.filled || c.multiplierStatus !== "stable_verified") continue;
    if (!isRegularEquitySession(c.endAt)) continue;
    const slice = candles.slice(0, idx + 1);
    const vol = rv30ImpliedVolatility(slice, 1.1);
    if (!vol) continue;

    const pitPayload: VolatilityOraclePayload = {
      schema: "optra.volatility.v1",
      providerId: OPTRA_VOLATILITY_PROVIDER_ID,
      symbol: SYMBOL,
      observedAt: c.endAt,
      spotUsd: Number(c.shareCloseUsd),
      realizedVolatility30d: vol.rv30,
      impliedVolatility: vol.iv,
      ivRank: 90,
      regime: vol.iv >= 0.6 ? "CRISIS_VOL" : vol.iv >= 0.35 ? "ELEVATED_VOL" : "NORMAL_VOL",
      source: "crius_robinhood_chain_candles",
      sampleCount: slice.length,
    };

    const probe = runStrategyTick({
      agentId: "probe",
      tickId: `probe-${c.endAt}`,
      occurredAt: c.endAt,
      recipe,
      recipeHash,
      snapshot: null,
      currentCandle: c,
      history: slice,
      corporateActionDates,
      earnings,
      paidVolatilityResource: pitPayload,
      state: { status: "running" },
      includeMarketContext: true,
    });
    if (probe.decision.action === "open") {
      selectedIdx = idx;
      break;
    }
  }

  if (selectedIdx < 0) {
    throw new Error("No eligible historical regular-session window found.");
  }

  const replayCandle = candles[selectedIdx]!;
  const replayHistory = candles.slice(0, selectedIdx + 1);
  const replayTime = new Date(replayCandle.endAt);
  const pitVol = rv30ImpliedVolatility(replayHistory, 1.1)!;
  const pitRegime: VolatilityOraclePayload["regime"] = pitVol.iv >= 0.6 ? "CRISIS_VOL" : pitVol.iv >= 0.35 ? "ELEVATED_VOL" : "NORMAL_VOL";

  console.log(`      ✓ Selected window: ${replayCandle.endAt} (spot=$${replayCandle.shareCloseUsd}, point-in-time IV=${(pitVol.iv * 100).toFixed(1)}%, RV30=${(pitVol.rv30 * 100).toFixed(1)}%)`);

  // ── 3. Persist full lifecycle in isolated PGlite DB ────────────────────────
  console.log(`\n[3/4] Running x402 PAPER_REHEARSAL acquisition & persisting order/fill/position/Tape...`);
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as AppDatabase;
  await migrate(db as never, { migrationsFolder: "./drizzle" });

  const ownerId = crypto.randomUUID();
  await db.insert(schema.users).values({
    id: ownerId,
    address: "0x0000000000000000000000000000000000000001",
    createdAt: replayTime,
  });

  const paperRepo = new DrizzlePaperRepository(db);
  const economicRepo = new DrizzleEconomicRepository(db);

  const agent = await paperRepo.createAgent({
    ownerId,
    name: recipe.name,
    templateId: recipe.templateId,
    status: "running",
    recipe,
    recipeHash,
    createdAt: replayTime,
  });

  const acct = await economicRepo.getOrCreateEconomicAccount(agent.id, ownerId, { now: replayTime });
  await economicRepo.fundServiceBudget(ownerId, agent.id, parseUsdgToAtomic("1.00"), "Replay budget", replayTime);
  await economicRepo.updateEconomicMandate(ownerId, agent.id, {
    ...acct.mandate,
    enabled: true,
    perRequestLimitAtomic: parseUsdgToAtomic("0.05"),
    dailyServiceBudgetAtomic: parseUsdgToAtomic("1.00"),
    approvedProviders: [OPTRA_VOLATILITY_PROVIDER_ID],
  }, "Replay mandate");

  const tickId = `replay-${replayCandle.endAt}`;
  const decisionId = `${agent.id}:${tickId}`;

  // Point-in-time mock 402 oracle fetcher using only candles <= replayCandle.endAt
  const pitFetcher = async (_url: string, init?: RequestInit): Promise<Response> => {
    const paymentHeader = new Headers(init?.headers).get("X-PAYMENT") ?? new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    if (!paymentHeader) {
      return new Response(JSON.stringify({
        x402Version: 1,
        accepts: [{
          scheme: "exact",
          network: "eip155:4663",
          amount: parseUsdgToAtomic("0.02"),
          maxAmountRequired: parseUsdgToAtomic("0.02"),
          resource: `/api/x402/providers/volatility?symbol=${SYMBOL}`,
          description: "OPTRA Volatility Oracle (Point-in-Time Historical Replay)",
          payTo: "0x23439a41eDC01D58d3aAA0C75E9dFEE0C0196848",
          asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
          maxTimeoutSeconds: 300,
          extra: { name: "Global Dollar", version: "1" },
        }],
      }), { status: 402, headers: { "content-type": "application/json" } });
    }
    const payload: VolatilityOraclePayload = {
      schema: "optra.volatility.v1",
      providerId: OPTRA_VOLATILITY_PROVIDER_ID,
      symbol: SYMBOL,
      observedAt: replayCandle.endAt,
      spotUsd: Number(replayCandle.shareCloseUsd),
      realizedVolatility30d: pitVol.rv30,
      impliedVolatility: pitVol.iv,
      ivRank: 90,
      regime: pitRegime,
      source: "crius_robinhood_chain_candles",
      sampleCount: replayHistory.length,
      decisionId,
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };

  const x402Res = await acquireVolatilityResourceForTick({
    db,
    agentId: agent.id,
    ownerId,
    agentStatus: "running",
    underlyingSymbol: SYMBOL,
    tickId,
    occurredAt: replayCandle.endAt,
    fetcher: pitFetcher,
    now: replayTime,
  });

  if (x402Res.status !== "acquired" || !x402Res.volatilityData) {
    throw new Error(`x402 acquisition failed: ${x402Res.reason}`);
  }

  const tickResult = runStrategyTick({
    agentId: agent.id,
    tickId,
    occurredAt: replayCandle.endAt,
    recipe,
    recipeHash,
    snapshot: null,
    currentCandle: replayCandle,
    history: replayHistory,
    corporateActionDates,
    earnings,
    paidVolatilityResource: x402Res.volatilityData,
    state: { status: "running" },
    includeMarketContext: true,
  });

  await paperRepo.persistStrategyTick({
    ownerId,
    agentId: agent.id,
    tickId,
    occurredAt: replayCandle.endAt,
    snapshot: null,
    evaluate: () => tickResult,
  });

  await recordStrategyEvaluatedEvent({
    db,
    agentId: agent.id,
    decisionId,
    action: tickResult.decision.action,
    reason: tickResult.decision.reason,
    now: replayTime,
  });

  // ── 4. Read back persisted records ─────────────────────────────────────────
  const orders = await paperRepo.listOrders(ownerId, agent.id, 10);
  const state = await paperRepo.getStrategyState(ownerId, agent.id);
  const tape = await paperRepo.listTape(ownerId, agent.id, 10);
  const econTape = await economicRepo.listEconomicTapeEvents(agent.id, 20);

  console.log(`\n[4/4] Persisted Execution Proof (Covered Call Historical Replay — PAPER_REHEARSAL):`);
  console.log(`      Agent:         ${agent.id} (${recipe.name})`);
  console.log(`      Decision:      ${tickResult.decision.action.toUpperCase()} — ${tickResult.decision.reason}`);
  console.log(`      Order:         id=${orders[0]?.id}  status=${orders[0]?.status}  side=${orders[0]?.side}  qty=${orders[0]?.quantity}  strike=$${orders[0]?.strikeUsd}  price=$${orders[0]?.priceUsd}`);
  console.log(`      Open Position: id=${state.positions[0]?.id}  symbol=${state.positions[0]?.symbol}  qty=${state.positions[0]?.quantity}  strike=$${state.positions[0]?.strikeUsd}  expiry=${state.positions[0]?.expiryAt}`);
  console.log(`      Paper Tape:    ${tape.length} decision(s) recorded (decisionId=${tape[0]?.id})`);
  console.log(`      x402 Tape:     ${econTape.map((e) => e.eventType).join(" → ")}`);
  console.log(`      x402 Payment:  id=${x402Res.paymentRecord?.id}  mode=${x402Res.paymentRecord?.settlementMode}  status=${x402Res.paymentRecord?.status}`);
  console.log(`\n      Provenance Note:`);
  console.log(`      - This Covered Call replay ran in PAPER_REHEARSAL mode with point-in-time data at ${replayCandle.endAt}.`);
  console.log(`      - Separate from the original Protective Put Mainnet Pilot (0.02 USDG on-chain tx ${PILOT_TX}).\n`);

  await pg.close();
}

main().catch((err) => {
  console.error("Replay failed:", err);
  process.exit(1);
});
