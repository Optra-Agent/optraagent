import { describe, expect, it } from "vitest";
import { blackScholesEuropeanOption, blackScholesEuropeanPut } from "../../lib/options/black-scholes";

const base = { spotUsd: 100, strikeUsd: 100, expiryAt: "2027-01-01T00:00:00.000Z", valuationAt: "2026-01-01T00:00:00.000Z", volatility: 0.2 };

describe("modeled European option values", () => {
  it("matches the standard at-the-money call and put reference values", () => {
    expect(blackScholesEuropeanOption("call", base).premiumUsd).toBeCloseTo(7.9656, 3);
    expect(blackScholesEuropeanOption("put", base).premiumUsd).toBeCloseTo(7.9656, 3);
  });

  it("keeps the put path identical to the Protective Put source of truth", () => {
    const put = blackScholesEuropeanOption("put", { ...base, strikeUsd: 93 });
    expect(put.premiumUsd).toBeCloseTo(blackScholesEuropeanPut({ ...base, strikeUsd: 93 }).premiumUsd, 10);
    expect(put.model).toBe("black_scholes_european_put");
  });

  it("satisfies put-call parity at zero rates and yields", () => {
    for (const strike of [80, 100, 125]) {
      const call = blackScholesEuropeanOption("call", { ...base, strikeUsd: strike }).premiumUsd;
      const put = blackScholesEuropeanOption("put", { ...base, strikeUsd: strike }).premiumUsd;
      expect(call - put).toBeCloseTo(base.spotUsd - strike, 4);
    }
  });

  it("returns deltas inside their natural bounds and ordered by moneyness", () => {
    const itmCall = blackScholesEuropeanOption("call", { ...base, strikeUsd: 80 }).delta;
    const otmCall = blackScholesEuropeanOption("call", { ...base, strikeUsd: 125 }).delta;
    expect(itmCall).toBeGreaterThan(0.5);
    expect(otmCall).toBeLessThan(0.2);
    const itmPut = blackScholesEuropeanOption("put", { ...base, strikeUsd: 125 }).delta;
    const otmPut = blackScholesEuropeanOption("put", { ...base, strikeUsd: 80 }).delta;
    expect(itmPut).toBeLessThan(-0.5);
    expect(otmPut).toBeGreaterThan(-0.2);
    expect(otmPut).toBeLessThan(0);
  });

  it("never returns a negative premium for a deep out-of-the-money option and rejects invalid inputs", () => {
    const deep = blackScholesEuropeanOption("call", { ...base, strikeUsd: 1000, expiryAt: "2026-01-02T00:00:00.000Z" });
    expect(deep.premiumUsd).toBe(0);
    expect(() => blackScholesEuropeanOption("call", { ...base, volatility: 0 })).toThrow(RangeError);
    expect(() => blackScholesEuropeanOption("put", { ...base, expiryAt: "2026-01-01T00:00:00.000Z" })).toThrow(RangeError);
  });
});
