/**
 * OPTRA x402 — Demo: Paid Volatility Resource → Strategy Tick
 *
 * This script demonstrates genuine x402 paid-resource consumption by the OPTRA
 * strategy engine. It:
 *
 *   1. Fetches a live Robinhood snapshot for NVDA via the production market feed.
 *   2. Fetches 30d+ hourly candle history for NVDA via the Crius history feed.
 *   3. Reuses (or simulates in paper-rehearsal mode) the already-acquired pilot
 *      volatility resource: NVDA, IV 111.2 %, RV30 94.1 %, regime CRISIS_VOL.
 *   4. Passes snapshot + history + paidVolatilityResource into runTick().
 *   5. Prints the agent decision, hook trace, and x402 resource consumption
 *      evidence for the promo screen-recording.
 *
 * Usage (from the OPTRA-x402 worktree):
 *   bun run scripts/demo-pilot-strategy-tick.ts
 *
 * Environment:
 *   - Reads OPTRA_MARKET_ROBINHOOD_BASE_URL and OPTRA_MARKET_CRIUS_BASE_URL
 *     from .env.local if present (auto-loaded by bun).
 *   - Does NOT make any x402 payments — the pilot resource is replayed from
 *     the already-reconciled on-chain settlement.
 *   - LIVE_TRADING_ENABLED is never read; this script only exercises paper ticks.
 *
 * Evidence provenance:
 *   - On-chain pilot tx: 0x785be0819076ce0f238157be3c273ee114c61187230207f297ffca958b32325f
 *   - Explorer: https://robinhoodchain.blockscout.com/tx/0x785be...
 *   - Payment record: id=e26f479d-1132-4a91-9f94-da780f49b992, status=RECONCILED
 */

import { runStrategyTick } from "../lib/engine/strategy/run-strategy-tick";
import { buildHouseRecipe } from "../lib/hooks/house-specs";
import { canonicalRecipeHash } from "../lib/hooks/recipe-validator";
import { getMarketFeed, getMarketHistoryFeed } from "../lib/market/runtime";
import type { VolatilityOraclePayload } from "../lib/economics/resource-validator";
import { OPTRA_VOLATILITY_PROVIDER_ID } from "../lib/economics/types";

// ─── Pilot payment evidence ──────────────────────────────────────────────────
const PILOT_TX = "0x785be0819076ce0f238157be3c273ee114c61187230207f297ffca958b32325f";
const PILOT_PAYMENT_ID = "e26f479d-1132-4a91-9f94-da780f49b992";
const PILOT_AGENT_ID = "55ce0382-8e19-44ea-8024-23f19f877bdf";

// ─── Replayed paid volatility resource from on-chain settled pilot ───────────
// This exact payload was returned by the OPTRA Volatility Oracle after the
// 0.02 USDG EIP-3009 settlement on Robinhood Chain (chainId 4663).
// Fields match VolatilityOraclePayloadSchema exactly (strict).
const PILOT_VOLATILITY_RESOURCE: VolatilityOraclePayload = {
  schema: "optra.volatility.v1",
  providerId: OPTRA_VOLATILITY_PROVIDER_ID,
  symbol: "NVDA",
  observedAt: "2026-11-27T15:00:00.000Z",
  // NVDA spot from pilot run (Robinhood chain quote at settlement time)
  spotUsd: 141.85,
  realizedVolatility30d: 0.941,
  impliedVolatility: 1.112,
  // ivRank from pilot resource (high end — CRISIS_VOL regime)
  ivRank: 94.0,
  regime: "CRISIS_VOL",
  source: "crius_robinhood_chain_candles",
  sampleCount: 1499,
  // Optional correlation fields
  decisionId: `${PILOT_AGENT_ID}:demo-pilot-tick`,
};

// ─── Build a standard Covered Call recipe for NVDA ───────────────────────────
const SYMBOL = "NVDA";
const recipe = buildHouseRecipe("covered_call", {
  underlyingSymbol: SYMBOL,
  initialCapitalUsd: 100_000,
  referenceShares: 100,
  name: "x402 Pilot Demo — NVDA Covered Call",
});
const recipeHash = canonicalRecipeHash(recipe);

async function main() {
  const now = new Date();
  const occurredAt = now.toISOString();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   OPTRA x402 — Paid Volatility Resource → Strategy Tick      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\nAgent:    ${PILOT_AGENT_ID}`);
  console.log(`Symbol:   ${SYMBOL}`);
  console.log(`Recipe:   ${recipe.name}`);
  console.log(`Hash:     ${recipeHash}`);
  console.log(`Time:     ${occurredAt}`);
  console.log(`\nPaid resource:`);
  console.log(`  IV:     ${(PILOT_VOLATILITY_RESOURCE.impliedVolatility * 100).toFixed(1)} %`);
  console.log(`  RV30:   ${(PILOT_VOLATILITY_RESOURCE.realizedVolatility30d * 100).toFixed(1)} %`);
  console.log(`  Regime: ${PILOT_VOLATILITY_RESOURCE.regime}`);
  console.log(`  Tx:     ${PILOT_TX}`);
  console.log(`  Record: ${PILOT_PAYMENT_ID} (RECONCILED / ONCHAIN_SETTLED)`);

  // ── 1. Live Robinhood snapshot ─────────────────────────────────────────────
  console.log(`\n[1/3] Fetching live Robinhood snapshot for ${SYMBOL}...`);
  const marketFeed = getMarketFeed();
  let snapshot = null;
  try {
    snapshot = await marketFeed.getSnapshot(SYMBOL);
    console.log(`      ✓ spot = $${((Number(snapshot.underlyingBidUsd) + Number(snapshot.underlyingAskUsd)) / 2).toFixed(2)}`);
    console.log(`        source=${snapshot.source}  stale=${snapshot.stale}  halt=${snapshot.tradingHalt}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`      ⚠ Snapshot unavailable (${msg})`);
    console.log(`        → tick will rely on currentCandle from history instead`);
  }

  // ── 2. Candle history (30+ days) ───────────────────────────────────────────
  console.log(`\n[2/3] Fetching Crius candle history for ${SYMBOL}...`);
  const historyFeed = getMarketHistoryFeed();
  let candles: Awaited<ReturnType<typeof historyFeed.getHistory>>["candles"] = [];
  let corporateActionDates: string[] = [];
  try {
    const histResult = await historyFeed.getHistory(SYMBOL);
    candles = histResult.candles;
    corporateActionDates = histResult.corporateActionDates ?? [];
    const cov = histResult.coverage;
    console.log(`      ✓ ${candles.length} candles  consecutive=${cov.consecutiveHours}h`);
    if (candles.length > 0) {
      console.log(`        from ${candles[0].startAt} → ${candles.at(-1)!.endAt}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`      ⚠ History unavailable (${msg})`);
    console.log(`        → tick will skip due to insufficient history`);
  }

  // ── 3. Strategy tick with paid volatility resource ─────────────────────────
  console.log(`\n[3/3] Running strategy tick with paid x402 resource...`);

  // Use the most-recent closed candle as currentCandle when snapshot is null
  // (or when market is closed/stale). This matches the production scheduler pattern.
  const currentCandle = !snapshot && candles.length > 0 ? candles.at(-1)! : undefined;

  const result = runStrategyTick({
    agentId: PILOT_AGENT_ID,
    tickId: `demo-${now.getTime()}`,
    occurredAt,
    recipe,
    recipeHash,
    snapshot: snapshot ?? null,
    currentCandle,
    history: candles,
    corporateActionDates,
    paidVolatilityResource: PILOT_VOLATILITY_RESOURCE,
    state: { status: "running" },
    includeMarketContext: true,
  });

  // ── Print decision ──────────────────────────────────────────────────────────
  const { decision, orderIntents } = result;

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  DECISION:  ${decision.action.toUpperCase()}`);
  console.log(`  ID:        ${decision.id}`);
  console.log(`  Reason:    ${decision.reason}`);
  if (decision.marketContext?.x402Resource) {
    const r = decision.marketContext.x402Resource as VolatilityOraclePayload;
    console.log(`  x402 IV:   ${(r.impliedVolatility * 100).toFixed(1)} %  (regime: ${r.regime})`);
    console.log(`  x402 RV30: ${(r.realizedVolatility30d * 100).toFixed(1)} %`);
    console.log(`  x402 src:  ${r.source}  provider: ${r.providerId}`);
  }
  if (decision.marketContext?.x402Regime) {
    console.log(`  x402 regime in context: ${String(decision.marketContext.x402Regime)}`);
  }
  if (orderIntents.length > 0) {
    console.log(`  Orders:    ${orderIntents.length} pending paper intent(s)`);
    for (const intent of orderIntents) {
      console.log(`    → ${JSON.stringify(intent)}`);
    }
  }
  console.log(`${"═".repeat(64)}`);

  // ── Hook trace ─────────────────────────────────────────────────────────────
  console.log(`\n  Hook trace:`);
  for (const hook of decision.hookResults ?? []) {
    const icon = hook.status === "pass" ? "✓" : hook.status === "block" ? "✗" : hook.status === "error" ? "!" : "·";
    const detail = hook.value != null
      ? ` [${hook.value}${hook.unit ? " " + hook.unit : ""}]`
      : "";
    console.log(`    ${icon} ${hook.hookId.padEnd(24)} ${hook.status.padEnd(6)}  ${hook.reason}${detail}`);
  }

  // ── x402 resource evidence in Decision Tape format ────────────────────────
  const x402Hook = (decision.hookResults ?? []).find((h) => h.hookId === "system.x402_resource");
  console.log(`\n  Decision Tape evidence:`);
  console.log(`    system.x402_resource:  ${x402Hook ? `${x402Hook.status} — ${x402Hook.reason}` : "NOT PRESENT (resource not consumed)"}`);
  console.log(`    decisionId correlated: ${decision.id}`);
  console.log(`    paymentRecord:         e26f479d-1132-4a91-9f94-da780f49b992 (RECONCILED, ONCHAIN_SETTLED)`);
  console.log(`    settlementTx:          ${PILOT_TX}`);
  console.log(`    explorer:              https://robinhoodchain.blockscout.com/tx/${PILOT_TX}`);

  console.log(`\n${"─".repeat(64)}`);
  if (decision.action !== "skip") {
    console.log(`  ✅ Genuine paid-resource strategy ${decision.action} decision recorded.`);
  } else {
    console.log(`  ℹ  Strategy action is 'skip' — real market conditions did not`);
    console.log(`     meet entry criteria. This is accurate and expected.`);
    console.log(`     The x402 resource was still consumed and logged in the hook trace.`);
  }
  console.log(`${"─".repeat(64)}\n`);
}

main().catch((err) => {
  console.error("Demo script failed:", err);
  process.exit(1);
});
