import { backtestUnavailableResponse, getBacktestHandlers } from "../../../lib/backtest/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await (await getBacktestHandlers()).create(request);
  } catch {
    return backtestUnavailableResponse();
  }
}
