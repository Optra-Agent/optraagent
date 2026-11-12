import { getPaperHandlers, paperUnavailableResponse } from "../../../../../lib/paper/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  try {
    const { agentId } = await context.params;
    return await (await getPaperHandlers()).tape(request, agentId);
  } catch {
    return paperUnavailableResponse();
  }
}
