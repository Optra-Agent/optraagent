import { getPublicHandlers, publicUnavailableResponse } from "../../../../../../lib/public/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  try {
    const { agentId } = await context.params;
    return await (await getPublicHandlers()).agent(agentId);
  } catch {
    return publicUnavailableResponse();
  }
}
