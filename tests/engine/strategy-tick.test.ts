import { describe, expect, it } from "vitest";
import { account, earningsSnapshot, harness, hook, makeCandles, SESSION_AT, shortPosition } from "./strategy-fixtures";
import type { StrategyPosition } from "../../lib/engine/strategy/types";

const flat = () => 200;
const volatile = 0.01;

describe("Covered Call engine", () => {
  const open = (extra: Parameters<typeof harness>[1] = {}) => harness("covered_call", { recipe: { overrides: { volra: { threshold: 0 } }, referenceShares: 10, initialCapitalUsd: 1000, ...extra.recipe }, wiggle: volatile, price: flat, ...extra });

  it("sells a call sized to uncommitted virtual shares, collects a modeled premium, and never opens naked", () => {
    const result = open().run();
    expect(result.decision.action).toBe("open");
    expect(result.orderIntents).toHaveLength(1);
    expect(result.orderIntents[0]).toMatchObject({ action: "open", side: "sell", optionType: "call", quantity: "10", slippageBps: 50, feeUsd: "0", premiumSource: "modeled", modelName: "black_scholes_european_call" });
    const position = result.portfolio.changes.find((change) => change.action === "open")!.position;
    expect(position).toMatchObject({ side: "short", optionType: "call", quantity: "10", collateralUsd: "0" });
    expect(Number(position.strikeUsd)).toBeGreaterThan(200 * 1.04);
    expect(Number(result.portfolio.account.cashUsd)).toBeGreaterThan(1000);
    expect(result.portfolio.account.meta.premiumCollectedUsd).not.toBe("0");
    expect(hook(result, "coverix")).toMatchObject({ status: "size" });
    expect(hook(result, "percy")).toMatchObject({ status: "select" });
    expect(hook(result, "tenora")?.reason).toContain("16:00 ET");
  });

  it("covers only the configured percentage of the reference shares", () => {
    const result = open({ recipe: { overrides: { volra: { threshold: 0 }, coverix: { coveragePct: 50, lockTokens: false }, capra: { maxPctPerPosition: 100, maxOpenPositions: 1 } }, referenceShares: 10 } }).run();
    expect(result.orderIntents[0]?.quantity).toBe("5");
  });

  it("refuses to write a call when no whole share is covered (INSUFFICIENT_COVER)", () => {
    const result = open({ recipe: { overrides: { volra: { threshold: 0 }, coverix: { coveragePct: 10, lockTokens: false } }, referenceShares: 1 } }).run();
    expect(result.decision.action).toBe("skip");
    expect(result.orderIntents).toEqual([]);
    expect(hook(result, "coverix")).toMatchObject({ status: "block" });
    expect(hook(result, "coverix")?.reason).toContain("INSUFFICIENT_COVER");
  });

  it("never commits shares twice: a second call cannot open while one is already written", () => {
    const h = open();
    const existing = shortPosition({ quantity: "10", strikeUsd: "230", expiryAt: "2026-11-20T21:00:00.000Z" });
    const result = h.run({ positions: [existing], account: account(h.recipe) });
    expect(result.orderIntents.filter((order) => order.action === "open")).toEqual([]);
    expect(result.decision.action).toBe("hold");
  });

  it("blocks on a known earnings date inside the window and on a missing calendar", () => {
    const near = open({ earnings: earningsSnapshot([{ reportDate: "2026-11-11" }]) }).run();
    expect(near.decision.action).toBe("skip");
    expect(hook(near, "earnex")).toMatchObject({ status: "block" });
    expect(near.orderIntents).toEqual([]);

    const unconfirmed = open({ earnings: earningsSnapshot([{ reportDate: "2026-11-11", verified: false }]) }).run();
    expect(hook(unconfirmed, "earnex")).toMatchObject({ status: "block" });

    const missing = open({ earnings: null }).run();
    expect(missing.decision.action).toBe("skip");
    expect(hook(missing, "earnex")?.reason).toContain("DATA_MISSING");
    expect(missing.orderIntents).toEqual([]);
  });

  it("blocks when the modeled IV rank is below the Volra threshold", () => {
    const result = open({ recipe: { overrides: { volra: { threshold: 100 } }, referenceShares: 10 } }).run();
    expect(hook(result, "volra")).toMatchObject({ status: "block" });
    expect(result.decision.action).toBe("skip");
    expect(hook(result, "volra")?.reason).toContain("not an option-chain IV");
  });

  it("takes profit once the premium has decayed by the capture percentage", () => {
    const h = open();
    const far = shortPosition({ strikeUsd: "320", averageEntryUsd: "3", markPriceUsd: "3", expiryAt: "2026-11-13T21:00:00.000Z" });
    const result = h.run({ positions: [far], account: account(h.recipe, { cashUsd: "1030" }) });
    expect(result.decision.action).toBe("close");
    expect(result.orderIntents[0]).toMatchObject({ action: "close", purpose: "take_profit", side: "buy", quantity: "10" });
    expect(result.portfolio.changes.find((change) => change.action === "close")?.position.status).toBe("closed");
    expect(Number(result.portfolio.account.realizedPnlUsd)).toBeGreaterThan(0);
    expect(result.portfolio.account.meta.winningCloses).toBe(1);
  });

  it("settles an out-of-the-money short call at expiry for zero and counts it", () => {
    const h = open();
    const expired = shortPosition({ strikeUsd: "230", expiryAt: "2026-11-06T21:00:00.000Z" });
    const result = h.run({ positions: [expired], account: account(h.recipe, { cashUsd: "1030" }) });
    expect(result.orderIntents[0]).toMatchObject({ action: "settle", purpose: "expiry_settlement", side: "buy", priceUsd: "0", slippageBps: 0 });
    expect(result.portfolio.account.meta.settledOtm).toBe(1);
    expect(result.portfolio.account.meta.settledItm).toBe(0);
    expect(result.portfolio.account.cashUsd).toBe("1030");
    expect(Number(result.portfolio.account.realizedPnlUsd)).toBeCloseTo(30, 5);
  });

  it("settles an in-the-money short call at the modeled intrinsic value from the first close after expiry", () => {
    const h = open({ price: (index, count) => (index < count - 100 ? 200 : 230), wiggle: 0.0005 });
    const expired = shortPosition({ strikeUsd: "210", expiryAt: "2026-11-06T21:00:00.000Z" });
    const result = h.run({ positions: [expired], account: account(h.recipe, { cashUsd: "1030" }) });
    const order = result.orderIntents[0]!;
    expect(order).toMatchObject({ action: "settle", purpose: "expiry_settlement", side: "buy" });
    expect(Number(order.priceUsd)).toBeGreaterThan(19);
    expect(order.modelInputs).toMatchObject({ settlementPriceSource: expect.stringContaining("candle_close_") });
    expect(result.portfolio.account.meta.settledItm).toBe(1);
    expect(Number(result.portfolio.account.cashUsd)).toBeLessThan(1030 - 190);
    expect(Number(result.portfolio.account.realizedPnlUsd)).toBeLessThan(0);
  });

  it("holds a safely out-of-the-money option inside the Settla window and records why", () => {
    const h = open();
    const near = shortPosition({ strikeUsd: "205", expiryAt: "2026-11-10T20:00:00.000Z", averageEntryUsd: "0.1", markPriceUsd: "0.1" });
    const result = h.run({ positions: [near], account: account(h.recipe) });
    expect(result.decision.action).toBe("hold");
    expect(hook(result, "settla")).toMatchObject({ status: "action" });
    expect(hook(result, "settla")?.reason).toContain("holding to expiry");
  });

  it("rolls a pressured short call out and away only for a net credit, otherwise closes it", () => {
    const h = open({ wiggle: volatile, recipe: { overrides: { volra: { threshold: 0 }, rescu: { itmPct: 1, action: "rollOutAndAway", maxRescues: 1, requireNetCredit: true }, percy: { type: "call", side: "sell", otmPct: 1, rounding: "nearest", strikeIncrementUsd: 0.01 } }, referenceShares: 10 } });
    const pressured = shortPosition({ strikeUsd: "196", expiryAt: "2026-11-11T21:00:00.000Z", averageEntryUsd: "6", markPriceUsd: "6" });
    const result = h.run({ positions: [pressured], account: account(h.recipe, { cashUsd: "1060" }) });
    const purposes = result.orderIntents.map((order) => order.purpose);
    expect(["rescue_roll_close", "rescue_close"]).toContain(purposes[0]);
    if (purposes[0] === "rescue_roll_close") {
      expect(purposes).toEqual(["rescue_roll_close", "rescue_roll_open"]);
      const reopened = result.portfolio.changes.find((change) => change.action === "open")!.position;
      expect(reopened.modelInputs.rescues).toBe(1);
      expect(Number(reopened.strikeUsd)).toBeGreaterThanOrEqual(196);
      expect(Date.parse(reopened.expiryAt)).toBeGreaterThan(Date.parse("2026-11-11T21:00:00.000Z"));
      expect(result.portfolio.account.meta.rolls).toBe(1);
    } else {
      expect(purposes).toEqual(["rescue_close"]);
      expect(hook(result, "rescu")?.reason).toContain("no net-credit roll");
    }
  });

  it("stops after the configured number of rescues", () => {
    const h = open({ recipe: { overrides: { volra: { threshold: 0 }, rescu: { itmPct: 1, action: "rollOutAndAway", maxRescues: 0, requireNetCredit: true } }, referenceShares: 10 } });
    const pressured = shortPosition({ strikeUsd: "196", expiryAt: "2026-11-13T21:00:00.000Z" });
    const result = h.run({ positions: [pressured], account: account(h.recipe) });
    expect(result.orderIntents.filter((order) => order.action !== "open")).toEqual([]);
    expect(result.decision.action).toBe("hold");
  });

  it("never fills outside the regular session: entries skip and exits wait", () => {
    const h = open({ endAt: "2026-11-10T02:00:00.000Z" });
    const skipped = h.run();
    expect(skipped.decision.action).toBe("skip");
    expect(skipped.orderIntents).toEqual([]);
    const far = shortPosition({ strikeUsd: "320", expiryAt: "2026-11-13T21:00:00.000Z" });
    const waiting = h.run({ positions: [far], account: account(h.recipe) });
    expect(waiting.orderIntents).toEqual([]);
    expect(waiting.decision.hookResults.some((item) => item.hookId === "paper.execution" && item.status === "block")).toBe(true);
  });

  it("is deterministic and idempotent for identical input", () => {
    const h = open();
    expect(h.run()).toEqual(h.run());
  });
});

describe("Cash-Secured Put engine", () => {
  const rising = (index: number, count: number) => 160 + (index / count) * 40;
  const open = (extra: Parameters<typeof harness>[1] = {}) => harness("cash_secured_put", {
    price: rising, wiggle: 0.004,
    recipe: { overrides: { volra: { threshold: 0 }, trendix: { timeframe: "1d", fast: 5, slow: 10, direction: "bullish" }, premo: { minPremiumPct: 0.1 }, ...(extra.recipe?.overrides ?? {}) }, initialCapitalUsd: 10_000, ...(extra.recipe ? { name: extra.recipe.name } : {}) },
    ...(extra.earnings !== undefined ? { earnings: extra.earnings } : {}),
    ...(extra.count ? { count: extra.count } : {}),
  });

  it("reserves strike × quantity of virtual USDG, sized to 50% of equity, at a 0.25-delta strike", () => {
    const result = open().run();
    expect(result.decision.action).toBe("open");
    const position = result.portfolio.changes.find((change) => change.action === "open")!.position;
    expect(position).toMatchObject({ side: "short", optionType: "put" });
    expect(Number(position.collateralUsd)).toBeCloseTo(Number(position.strikeUsd) * Number(position.quantity), 2);
    expect(Number(position.collateralUsd)).toBeLessThanOrEqual(5000.01);
    expect(Number(position.strikeUsd)).toBeLessThan(200);
    expect(hook(result, "deltra")?.reason).toMatch(/Δ0\.2\d/);
    expect(hook(result, "trendix")).toMatchObject({ status: "pass" });
    expect(hook(result, "capra")?.reason).toContain("virtual USDG locked");
  });

  it("allows at most two positions and never secures more than the free cash", () => {
    const h = open();
    const first = h.run();
    const firstPosition = { ...first.portfolio.changes.find((change) => change.action === "open")!.position, id: "p1" };
    const second = h.run({ positions: [firstPosition], account: first.portfolio.account, tickId: "tick-b" });
    const secondOpen = second.portfolio.changes.find((change) => change.action === "open");
    if (secondOpen) {
      const locked = Number(firstPosition.collateralUsd) + Number(secondOpen.position.collateralUsd);
      expect(locked).toBeLessThanOrEqual(Number(second.portfolio.account.cashUsd) + 0.01);
      const secondPosition = { ...secondOpen.position, id: "p2" };
      const third = h.run({ positions: [firstPosition, secondPosition], account: second.portfolio.account, tickId: "tick-c" });
      expect(third.portfolio.changes.filter((change) => change.action === "open")).toEqual([]);
      expect(third.decision.action).toBe("hold");
    }
    expect(second.portfolio.changes.filter((change) => change.action === "open").length).toBeLessThanOrEqual(1);
  });

  it("refuses an entry when free cash cannot secure one full strike", () => {
    const h = open();
    const result = h.run({ account: account(h.recipe, { cashUsd: "100", peakEquityUsd: "100", dailyStartEquityUsd: "100", dailyStartDate: "2026-11-10" }) });
    expect(result.decision.action).toBe("skip");
    expect(result.orderIntents).toEqual([]);
    expect(hook(result, "capra")?.reason).toContain("CAP_EXCEEDED");
  });

  it("needs the Trendix slow average: too few daily closes is DATA_MISSING, a downtrend blocks", () => {
    const short = harness("cash_secured_put", { price: rising, wiggle: 0.004, count: 800, recipe: { overrides: { volra: { threshold: 0 }, trendix: { timeframe: "1d", fast: 20, slow: 50, direction: "bullish" }, premo: { minPremiumPct: 0.1 } } } });
    const missing = short.run();
    expect(missing.decision.action).toBe("skip");
    expect(hook(missing, "trendix")?.reason).toContain("DATA_MISSING");
    const falling = harness("cash_secured_put", { price: (index, count) => 240 - (index / count) * 80, wiggle: 0.004, recipe: { overrides: { volra: { threshold: 0 }, trendix: { timeframe: "1d", fast: 5, slow: 10, direction: "bullish" }, premo: { minPremiumPct: 0.1 } } } });
    const down = falling.run();
    expect(hook(down, "trendix")).toMatchObject({ status: "block" });
    expect(down.orderIntents).toEqual([]);
  });

  it("blocks when the modeled premium is below the Premo minimum", () => {
    const h = harness("cash_secured_put", { price: rising, wiggle: 0.0005, recipe: { overrides: { volra: { threshold: 0 }, trendix: { timeframe: "1d", fast: 5, slow: 10, direction: "bullish" }, premo: { minPremiumPct: 5 } } } });
    const result = h.run();
    expect(hook(result, "premo")).toMatchObject({ status: "block" });
    expect(hook(result, "premo")?.reason).toContain("PREMIUM_TOO_LOW");
    expect(result.orderIntents).toEqual([]);
  });

  it("stops out a short put whose premium has multiplied, and settles an in-the-money put at intrinsic value", () => {
    const h = open();
    const entry = shortPosition({ optionType: "put", modelName: "black_scholes_european_put", strikeUsd: "199", averageEntryUsd: "1", markPriceUsd: "1", quantity: "10", collateralUsd: "1990", expiryAt: "2026-11-13T21:00:00.000Z" });
    const stopped = h.run({ positions: [entry], account: account(h.recipe, { cashUsd: "10010" }) });
    expect(stopped.orderIntents[0]).toMatchObject({ purpose: "stop_loss", side: "buy", optionType: "put" });
    expect(Number(stopped.portfolio.account.realizedPnlUsd)).toBeLessThan(0);

    const crash = harness("cash_secured_put", { price: (index, count) => (index < count - 100 ? 200 : 170), wiggle: 0.0005, recipe: { overrides: { volra: { threshold: 0 } } } });
    const expired = shortPosition({ optionType: "put", modelName: "black_scholes_european_put", strikeUsd: "190", averageEntryUsd: "2", quantity: "10", collateralUsd: "1900", expiryAt: "2026-11-06T21:00:00.000Z" });
    const settled = crash.run({ positions: [expired], account: account(crash.recipe, { cashUsd: "10020" }) });
    expect(settled.orderIntents[0]).toMatchObject({ action: "settle", side: "buy", optionType: "put" });
    expect(Number(settled.orderIntents[0]!.priceUsd)).toBeGreaterThan(19);
    expect(settled.portfolio.account.meta.settledItm).toBe(1);
    expect(Number(settled.portfolio.account.cashUsd)).toBeLessThan(10020 - 190);
  });
});

describe("Earnings Straddle engine", () => {
  const confirmed = (reportDate: string, extra: Record<string, unknown> = {}) => earningsSnapshot([{ reportDate, ...extra }]);
  const open = (earnings: ReturnType<typeof earningsSnapshot> | null, extra: Parameters<typeof harness>[1] = {}) => harness("earnings_straddle", { earnings, wiggle: 0.01, price: flat, recipe: { initialCapitalUsd: 10_000, ...(extra.recipe ?? {}) }, ...(extra.count ? { count: extra.count } : {}) });

  it("buys an at-the-money call and put before a confirmed report, as one structure, with break-evens", () => {
    const result = open(confirmed("2026-11-11")).run();
    expect(result.decision.action).toBe("open");
    const legs = result.portfolio.changes.filter((change) => change.action === "open").map((change) => change.position);
    expect(legs.map((leg) => [leg.optionType, leg.side])).toEqual([["call", "long"], ["put", "long"]]);
    expect(legs[0]!.structureId).toBe(legs[1]!.structureId);
    expect(legs[0]!.strikeUsd).toBe(legs[1]!.strikeUsd);
    expect(Date.parse(legs[0]!.expiryAt)).toBeGreaterThan(Date.parse("2026-11-11T21:00:00.000Z"));
    expect(Number(legs[0]!.modelInputs.breakEvenUpUsd)).toBeGreaterThan(Number(legs[0]!.strikeUsd));
    expect(Number(legs[0]!.modelInputs.breakEvenDownUsd)).toBeLessThan(Number(legs[0]!.strikeUsd));
    expect(Number(legs[0]!.modelInputs.impliedMovePct)).toBeGreaterThan(0);
    const cost = legs.reduce((total, leg) => total + Number(leg.averageEntryUsd) * Number(leg.quantity), 0);
    expect(cost).toBeLessThanOrEqual(500.01);
    expect(result.portfolio.account.meta.tradedEarnings).toEqual(["2026-11-11"]);
    expect(hook(result, "kelvo")).toMatchObject({ status: "size" });
    expect(result.orderIntents.every((order) => order.side === "buy" && order.action === "open")).toBe(true);
  });

  it("never enters on an estimate, a distant report, a missing calendar, or a report already traded", () => {
    const estimate = open(confirmed("2026-11-11", { verified: false })).run();
    expect(estimate.orderIntents).toEqual([]);
    expect(hook(estimate, "earnex")?.reason).toContain("estimate");
    const far = open(confirmed("2026-11-30")).run();
    expect(far.orderIntents).toEqual([]);
    expect(hook(far, "earnex")?.reason).toContain("days away");
    const missing = open(null).run();
    expect(missing.orderIntents).toEqual([]);
    expect(hook(missing, "earnex")?.reason).toContain("DATA_MISSING");
    const h = open(confirmed("2026-11-11"));
    const again = h.run({ account: account(h.recipe, {}, { tradedEarnings: ["2026-11-11"] }) });
    expect(again.orderIntents).toEqual([]);
    expect(hook(again, "earnex")?.reason).toContain("already traded");
  });

  it("does not enter once the report time has passed", () => {
    const past = open(confirmed("2026-11-10", { reportAt: "2026-11-10T13:00:00.000Z", timing: "am" })).run();
    expect(past.orderIntents).toEqual([]);
    expect(hook(past, "earnex")?.status).toBe("block");
  });

  it("takes profit, stops out, closes before expiry, and settles both legs together", () => {
    const h = open(confirmed("2026-11-12"));
    const leg = (optionType: "call" | "put", mark: string, overrides: Partial<StrategyPosition> = {}): StrategyPosition => ({
      ...shortPosition({ optionType, side: "long", modelName: optionType === "call" ? "black_scholes_european_call" : "black_scholes_european_put", strikeUsd: "200", averageEntryUsd: "10", markPriceUsd: mark, peakMarkPriceUsd: mark, quantity: "5", structureId: "agent-1:old", legRole: optionType, expiryAt: "2026-11-20T21:00:00.000Z", ...overrides }),
      id: `leg-${optionType}`,
    });
    const losing = h.run({ positions: [leg("call", "10"), leg("put", "10")], account: account(h.recipe, { cashUsd: "9900" }) });
    // Marks recompute from the model, so near-ATM legs with ~10 days left sit between the profit and stop bands.
    expect(["hold", "close"]).toContain(losing.decision.action);

    const closing = h.run({ positions: [leg("call", "4", { expiryAt: "2026-11-11T14:00:00.000Z" }), leg("put", "4", { expiryAt: "2026-11-11T14:00:00.000Z" })], account: account(h.recipe, { cashUsd: "9900" }) });
    expect(closing.orderIntents).toHaveLength(2);
    expect(closing.orderIntents.every((order) => order.action === "settle" || order.purpose === "pre_expiry_close" || order.purpose === "stop_loss" || order.purpose === "take_profit")).toBe(true);
    expect(closing.orderIntents.map((order) => order.purpose)).toEqual([closing.orderIntents[0]!.purpose, closing.orderIntents[0]!.purpose]);

    const expiredLegs = h.run({ positions: [leg("call", "4", { expiryAt: "2026-11-06T21:00:00.000Z" }), leg("put", "4", { expiryAt: "2026-11-06T21:00:00.000Z" })], account: account(h.recipe, { cashUsd: "9900" }) });
    expect(expiredLegs.orderIntents.map((order) => [order.action, order.purpose])).toEqual([["settle", "expiry_settlement"], ["settle", "expiry_settlement"]]);
    expect(expiredLegs.portfolio.changes.filter((change) => change.action === "close")).toHaveLength(2);
  });

  it("takes profit on a combined gain and stops out on a combined loss", () => {
    const h = open(confirmed("2026-11-12"), { price: flat });
    const make = (entry: string, id: string, optionType: "call" | "put"): StrategyPosition => ({
      ...shortPosition({ optionType, side: "long", modelName: optionType === "call" ? "black_scholes_european_call" : "black_scholes_european_put", strikeUsd: "200", averageEntryUsd: entry, markPriceUsd: entry, peakMarkPriceUsd: entry, quantity: "5", structureId: "agent-1:old", legRole: optionType, expiryAt: "2026-11-20T21:00:00.000Z" }),
      id,
    });
    // Entry cost per unit is far below the modeled value → combined gain well past +40%.
    const profit = h.run({ positions: [make("1", "c", "call"), make("1", "p", "put")], account: account(h.recipe, { cashUsd: "9900" }) });
    expect(profit.orderIntents.map((order) => order.purpose)).toEqual(["take_profit", "take_profit"]);
    expect(profit.orderIntents.every((order) => order.side === "sell")).toBe(true);
    // Entry cost far above the modeled value → combined loss past −50%.
    const loss = h.run({ positions: [make("40", "c", "call"), make("40", "p", "put")], account: account(h.recipe, { cashUsd: "9900" }) });
    expect(loss.orderIntents.map((order) => order.purpose)).toEqual(["stop_loss", "stop_loss"]);
  });
});

describe("shared engine guarantees", () => {
  it("fails closed on missing, stale or invalid data and never opens", () => {
    const h = harness("covered_call", { recipe: { overrides: { volra: { threshold: 0 } } }, wiggle: volatile, price: flat });
    const short = h.run({ history: h.candles.slice(0, 100), index: h.candles.length - 1 });
    expect(short.decision.action).toBe("skip");
    expect(short.orderIntents).toEqual([]);
    const paused = h.run({ state: { status: "paused" } });
    expect(paused.decision.action).toBe("skip");
    expect(paused.decision.reason).toContain("paused");
    const badHash = h.run({ recipeHash: "sha256:" + "0".repeat(64) });
    expect(badHash.decision.reason).toContain("hash");
  });

  it("trips the daily-loss breaker and blocks new entries while still allowing exits", () => {
    const h = harness("covered_call", { recipe: { overrides: { volra: { threshold: 0 } } }, wiggle: volatile, price: flat });
    const hurt = h.run({ account: account(h.recipe, { dailyStartEquityUsd: "5000", dailyStartDate: "2026-11-10", peakEquityUsd: "5000" }) });
    expect(hook(hurt, "daylo")).toMatchObject({ status: "block" });
    expect(hurt.orderIntents).toEqual([]);
    const far = shortPosition({ strikeUsd: "320" });
    const exit = h.run({ positions: [far], account: account(h.recipe, { dailyStartEquityUsd: "5000", dailyStartDate: "2026-11-10", peakEquityUsd: "5000" }) });
    expect(exit.orderIntents[0]).toMatchObject({ purpose: "take_profit" });
  });

  it("blocks entries around a corporate action (Corpax) but exits proceed", () => {
    const h = harness("covered_call", { recipe: { overrides: { volra: { threshold: 0 } } }, wiggle: volatile, price: flat });
    const result = h.run({ corporateActionDates: ["2026-11-10T20:00:00.000Z"] });
    expect(hook(result, "corpax")).toMatchObject({ status: "block" });
    expect(result.orderIntents).toEqual([]);
  });

  it("records every recipe hook in the decision, in stage order", () => {
    const h = harness("cash_secured_put", { wiggle: volatile, price: flat });
    const result = h.run();
    const ids = result.decision.hookResults.filter((item) => item.stage).map((item) => item.hookId);
    expect(new Set(ids)).toEqual(new Set(h.recipe.hookIds));
    const stages = result.decision.hookResults.filter((item) => item.stage).map((item) => item.stage);
    const order = ["gate", "strike", "size", "pulse", "expiry", "breaker"];
    expect(stages.map((stage) => order.indexOf(stage!))).toEqual([...stages.map((stage) => order.indexOf(stage!))].sort((a, b) => a - b));
  });

  it("builds a candle series that satisfies the shared market-data contract", () => {
    const candles = makeCandles({ endAt: SESSION_AT, count: 5, price: flat });
    expect(candles.at(-1)!.endAt).toBe(SESSION_AT);
  });
});
