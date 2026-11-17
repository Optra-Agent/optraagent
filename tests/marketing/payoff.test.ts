import { describe, expect, it } from "vitest";
import { COLUMNS, DEFAULT_PARAMS, clampParams, floorColumns, floorReadout, netAtExpiry } from "../../components/marketing/payoff";

describe("Protective Floor payoff model", () => {
  it("never lets the net value fall below strike minus premium", () => {
    const params = { strike: 93, premium: 2 };
    const floor = params.strike - params.premium;
    for (const column of floorColumns(params)) expect(column.net).toBeGreaterThanOrEqual(floor - 1e-9);
    expect(netAtExpiry(40, params)).toBe(floor);
  });

  it("splits every net value into a part the holding keeps and a part the put supplies", () => {
    for (const column of floorColumns(DEFAULT_PARAMS)) {
      expect(column.kept + column.put).toBeCloseTo(column.net, 9);
      expect(column.kept).toBeGreaterThanOrEqual(0);
      expect(column.put).toBeGreaterThanOrEqual(0);
      expect(column.cost).toBeGreaterThanOrEqual(0);
    }
  });

  it("charges the whole premium above the strike and nothing is supplied by the put there", () => {
    const params = { strike: 93, premium: 2 };
    const above = floorColumns(params).filter((column) => column.price > params.strike);
    expect(above.length).toBeGreaterThan(0);
    for (const column of above) {
      expect(column.put).toBe(0);
      expect(column.cost).toBeCloseTo(params.premium, 9);
    }
  });

  it("supplies value from the put only when the price ends below the floor", () => {
    const params = { strike: 93, premium: 2 };
    for (const column of floorColumns(params)) {
      if (column.price >= params.strike - params.premium) expect(column.put).toBe(0);
      else expect(column.put).toBeCloseTo(params.strike - params.premium - column.price, 9);
    }
  });

  it("covers the full price range with the requested number of columns", () => {
    const columns = floorColumns(DEFAULT_PARAMS);
    expect(columns).toHaveLength(COLUMNS);
    expect(columns[0].price).toBe(60);
    expect(columns[columns.length - 1].price).toBe(140);
  });

  it("reads out floor, worst loss and break-even from the two assumptions", () => {
    expect(floorReadout({ strike: 93, premium: 2 })).toEqual({ floor: 91, worstLoss: 9, breakeven: 102, otm: 7 });
    expect(floorReadout({ strike: 100, premium: 0.5 }).worstLoss).toBe(0.5);
  });

  it("clamps out-of-range assumptions", () => {
    expect(clampParams({ strike: 10, premium: 99 })).toEqual({ strike: 80, premium: 6 });
    expect(clampParams({ strike: 120, premium: -1 })).toEqual({ strike: 100, premium: 0.5 });
  });
});
