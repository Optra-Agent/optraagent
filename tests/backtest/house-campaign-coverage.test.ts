import { describe, expect, it } from "vitest";
import { classifyHouseCampaignMarket, classifyHouseCampaignStrategy } from "../../lib/backtest/house-campaign-coverage";

const validNoEntry = {
  status: "failed" as const,
  hourlyCoverageComplete: true,
  entryOrderCount: 0,
  reason: "The complete historical window produced no modeled entry fills.",
};

describe("house campaign coverage classification", () => {
  it("distinguishes qualified, insufficient, corporate-action, unverified, and provider-error history", () => {
    expect(classifyHouseCampaignMarket({ ready: true, multiplierStatus: "stable_verified" })).toBe("qualified");
    expect(classifyHouseCampaignMarket({ ready: false, multiplierStatus: "stable_verified" })).toBe("insufficient_data");
    expect(classifyHouseCampaignMarket({ ready: false, multiplierStatus: "action_in_window" })).toBe("corporate_action");
    expect(classifyHouseCampaignMarket({ ready: false, multiplierStatus: "unverified" })).toBe("unverified");
    expect(classifyHouseCampaignMarket({ ready: false, multiplierStatus: "unverified", providerError: "rate limited" })).toBe("provider_error");
  });

  it("distinguishes completed runs from valid no-entry, incompatible, insufficient, and failed outcomes", () => {
    expect(classifyHouseCampaignStrategy({ recipeCompatible: true, marketStatus: "qualified", run: { ...validNoEntry, status: "complete" } })).toBe("complete");
    expect(classifyHouseCampaignStrategy({ recipeCompatible: true, marketStatus: "qualified", run: validNoEntry })).toBe("no_entry");
    expect(classifyHouseCampaignStrategy({ recipeCompatible: false, marketStatus: "qualified", run: null })).toBe("incompatible");
    expect(classifyHouseCampaignStrategy({ recipeCompatible: true, marketStatus: "insufficient_data", run: null })).toBe("insufficient_data");
    expect(classifyHouseCampaignStrategy({ recipeCompatible: true, marketStatus: "provider_error", run: null })).toBe("error");
    expect(classifyHouseCampaignStrategy({ recipeCompatible: true, marketStatus: "qualified", run: { ...validNoEntry, entryOrderCount: 1, reason: "invalid benchmark" } })).toBe("error");
  });
});
