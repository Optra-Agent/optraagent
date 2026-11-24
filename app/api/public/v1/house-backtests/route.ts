import campaign from "../../../../../lib/public/house-backtest-campaign.json";
import { PublicHouseBacktestCampaignResponseSchema } from "../../../../../lib/domain/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const body = PublicHouseBacktestCampaignResponseSchema.parse(campaign);
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
