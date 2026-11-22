import { describe, expect, it } from "vitest";
import { LIVE_ORDER_SIZE, mapDecisionToStructure } from "../../lib/venue/callput-live-agent-signal";

describe("Paper decision to CallPut structure mapping (proposed, needs owner approval to activate)", () => {
  it("maps only a Protective Put open decision, to a defined-risk long put spread at the verified candidate size", () => {
    expect(mapDecisionToStructure("protective_put", "nvda", "open")).toEqual({ ok: true, strategy: "BuyPutSpread", underlying: "NVDA", size: LIVE_ORDER_SIZE, rationale: expect.stringContaining("put spread") });
    expect(LIVE_ORDER_SIZE).toBe("0.1");
  });

  it("sends nothing for close, hold or skip: closing is the owner's wallet action", () => {
    for (const action of ["close", "hold", "skip"]) {
      const result = mapDecisionToStructure("protective_put", "NVDA", action);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain("sends nothing");
    }
  });

  it("refuses the three agents whose structure CallPut spreads cannot express, with the reason", () => {
    for (const [template, text] of [["covered_call", "Covered Call"], ["cash_secured_put", "Cash-Secured Put"], ["earnings_straddle", "Earnings Straddle"]] as const) {
      const result = mapDecisionToStructure(template, "NVDA", "open");
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain(text);
    }
  });

  it("refuses an unknown template and an underlying CallPut does not list", () => {
    expect(mapDecisionToStructure("mystery", "NVDA", "open").ok).toBe(false);
    expect(mapDecisionToStructure("protective_put", "ZZZZ", "open").ok).toBe(false);
  });
});
