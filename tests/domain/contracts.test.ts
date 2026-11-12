import { describe, expect, it } from "vitest";
import {
  AgentDecisionSchema,
  ApiErrorSchema,
  BacktestRunSchema,
  HookDefinitionSchema,
  MarketSnapshotSchema,
  PaperOrderSchema,
} from "../../lib/domain/contracts";

describe("shared API contracts", () => {
  it("market_snapshot_preserves_source_timestamp_and_unit_labels", () => {
    const parsed = MarketSnapshotSchema.parse({
      symbol: "AAPL",
      source: "robinhood_stock_token_api",
      observedAt: "2026-11-12T03:11:54.803Z",
      receivedAt: "2026-11-12T03:12:00.000Z",
      underlyingBidUsd: "355.40",
      underlyingAskUsd: "355.60",
      currentMultiplier: "1.000000000000000000",
      tokenBidUsd: "355.787605269499129764",
      tokenAskUsd: "355.987823392892207496",
      currency: "USD",
      stale: false,
      tradingHalt: false,
      pricingMethod: "recorded",
    });

    expect(parsed.symbol).toBe("AAPL");
    expect(parsed.underlyingBidUsd).toBe("355.40");
    expect(parsed.currentMultiplier).toBe("1.000000000000000000");
  });

  it("paper_order_requires_explicit_paper_mode", () => {
    const order = {
      id: "order-1",
      agentId: "agent-1",
      decisionId: "decision-1",
      tickId: "tick-1",
      symbol: "AAPL",
      instrumentType: "modeled_option",
      optionType: "put",
      strikeUsd: "330.00",
      expiryAt: "2026-12-12T03:12:00.000Z",
      impliedVolatility: "0.25",
      modelPremiumUsd: "3.10",
      modelName: "black_scholes_european_put",
      premiumSource: "modeled",
      modelInputs: { spotUsd: "355.00", tenorYears: "0.0822" },
      side: "buy",
      quantity: "1.00000000",
      priceUsd: "3.1155",
      feeUsd: "0.00",
      slippageBps: 50,
      status: "filled",
      createdAt: "2026-11-12T03:12:00.000Z",
      executionMode: "PAPER",
    };

    expect(PaperOrderSchema.parse(order).executionMode).toBe("PAPER");
    expect(PaperOrderSchema.safeParse({ ...order, executionMode: undefined }).success).toBe(false);
  });

  it("tape_decision_requires_stable_tick_and_hook_trace", () => {
    const decision = AgentDecisionSchema.parse({
      id: "decision-1",
      agentId: "agent-1",
      tickId: "2026-11-12T03:00:00.000Z",
      action: "skip",
      reason: "No executable PM recipe is configured.",
      hookResults: [],
      snapshotSource: "robinhood_stock_token_api",
      recipeHash: `sha256:${"0".repeat(64)}`,
      createdAt: "2026-11-12T03:12:00.000Z",
    });

    expect(decision.tickId).toBe("2026-11-12T03:00:00.000Z");
    expect(decision.action).toBe("skip");
  });

  it("backtest_contract_requires_coverage_and_recipe_hash", () => {
    const run = {
      id: "backtest-1",
      recipeHash: `sha256:${"0".repeat(64)}`,
      dataSource: "recorded_market_snapshots",
      startAt: "2026-10-13T00:00:00.000Z",
      endAt: "2026-11-12T00:00:00.000Z",
      sampleCount: 720,
      hourlyCoverageComplete: true,
      premiumSource: "recorded",
      pricingMethod: "recorded",
      status: "complete",
      metrics: { totalReturnPct: "0.00", maxDrawdownPct: "0.00", endingCashUsd: "1000.00" },
      reason: "Contract fixture.",
      createdAt: "2026-11-12T03:12:00.000Z",
    };

    expect(BacktestRunSchema.parse(run).sampleCount).toBe(720);
    expect(BacktestRunSchema.safeParse({ ...run, recipeHash: "" }).success).toBe(false);
  });

  it("catalog_only_hook_reports_a_reason_without_claiming_execution", () => {
    const hook = HookDefinitionSchema.parse({
      id: "source-pending",
      name: "Source pending",
      stage: "gate",
      availability: "catalog_only",
      summary: "Awaiting original PM hook source.",
      unavailableReason: "Awaiting original PM hook source in this workspace.",
    });

    expect(hook.availability).toBe("catalog_only");
    expect(hook.unavailableReason).toContain("original PM hook source");
  });

  it("api_error_codes_are_discriminated_and_known", () => {
    expect(ApiErrorSchema.parse({ error: { code: "UNAUTHORIZED", message: "Sign in required.", retryable: false } })).toEqual({
      error: { code: "UNAUTHORIZED", message: "Sign in required.", retryable: false },
    });
    expect(ApiErrorSchema.safeParse({ error: { code: "GUESS", message: "x", retryable: false } }).success).toBe(false);
  });
});
