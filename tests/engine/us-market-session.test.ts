import { describe, expect, it } from "vitest";
import { isRegularEquitySession } from "../../lib/engine/us-market-session";

describe("US regular equity session", () => {
  it("handles eastern time and daylight saving transitions", () => {
    expect(isRegularEquitySession("2026-11-12T15:00:00.000Z")).toBe(true); // 10:00 EST
    expect(isRegularEquitySession("2026-07-13T14:00:00.000Z")).toBe(true); // 10:00 EDT
    expect(isRegularEquitySession("2026-11-12T14:00:00.000Z")).toBe(false); // 09:00 EST
  });

  it("blocks weekends, full market holidays, and hours after the close", () => {
    expect(isRegularEquitySession("2026-11-14T15:00:00.000Z")).toBe(false);
    expect(isRegularEquitySession("2026-11-26T15:00:00.000Z")).toBe(false);
    expect(isRegularEquitySession("2026-11-12T21:00:00.000Z")).toBe(false);
  });
});
