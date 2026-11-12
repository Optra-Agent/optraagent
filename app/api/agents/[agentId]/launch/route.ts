import { backtestUnavailableResponse, getBacktestHandlers } from "../../../../../lib/backtest/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  try {
    const { agentId } = await context.params;
    return await (await getBacktestHandlers()).launch(request, agentId);
  } catch {
    return backtestUnavailableResponse();
  }
}
