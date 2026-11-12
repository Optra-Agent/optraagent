import { getAgentHandlers, paperUnavailableResponse } from "../../../lib/paper/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await (await getAgentHandlers()).create(request);
  } catch {
    return paperUnavailableResponse();
  }
}
