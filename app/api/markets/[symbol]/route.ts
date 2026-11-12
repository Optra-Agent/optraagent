import { getMarketHandlers } from "../../../../lib/market/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const { symbol } = await context.params;
  return getMarketHandlers().detail(symbol);
}
