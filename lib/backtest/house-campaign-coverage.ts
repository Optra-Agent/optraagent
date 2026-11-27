import type { BacktestRun, MarketHistoryCoverage } from "../domain/contracts";

export type HouseCampaignMarketStatus =
  | "qualified"
  | "insufficient_data"
  | "corporate_action"
  | "unverified"
  | "provider_error";

export type HouseCampaignStrategyStatus =
  | "complete"
  | "no_entry"
  | "insufficient_data"
  | "incompatible"
  | "error";

type CampaignRunOutcome = Pick<BacktestRun, "status" | "hourlyCoverageComplete" | "entryOrderCount" | "reason"> & { sampleCount?: number };

export function classifyHouseCampaignMarket(input: {
  ready: boolean;
  multiplierStatus?: MarketHistoryCoverage["multiplierStatus"];
  providerError?: string | null;
}): HouseCampaignMarketStatus {
  if (input.providerError) return "provider_error";
  if (input.ready) return "qualified";
  if (input.multiplierStatus === "action_in_window") return "corporate_action";
  if (input.multiplierStatus === "unverified") return "unverified";
  return "insufficient_data";
}

export function classifyHouseCampaignStrategy(input: {
  recipeCompatible: boolean;
  marketStatus: HouseCampaignMarketStatus;
  run: CampaignRunOutcome | null;
}): HouseCampaignStrategyStatus {
  if (!input.recipeCompatible) return "incompatible";
  if (input.marketStatus === "provider_error") return "error";
  if (input.marketStatus !== "qualified") return "insufficient_data";
  if (!input.run) return "error";
  if (input.run.status === "complete") return "complete";
  if (input.run.status === "insufficient_data") return "insufficient_data";
  if (
    (input.run.hourlyCoverageComplete || (input.run.sampleCount ?? 0) >= 168)
    && input.run.entryOrderCount === 0
    && input.run.reason.toLowerCase().includes("no modeled entry fills")
  ) return "no_entry";
  return "error";
}
