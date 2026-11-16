import { backtestUnavailableResponse, getBacktestHandlers } from "../../../../lib/backtest/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await (await getBacktestHandlers()).coverage(request);
  } catch {
    return backtestUnavailableResponse();
  }
}
