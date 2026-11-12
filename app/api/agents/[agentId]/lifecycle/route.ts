import { getAgentHandlers, paperUnavailableResponse } from "../../../../../lib/paper/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  try {
    const { agentId } = await context.params;
    return await (await getAgentHandlers()).lifecycle(request, agentId);
  } catch {
    return paperUnavailableResponse();
  }
}
