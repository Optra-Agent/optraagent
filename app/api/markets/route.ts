import { getMarketHandlers } from "../../../lib/market/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return getMarketHandlers().list();
}
