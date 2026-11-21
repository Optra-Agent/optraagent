import { getPublicHandlers, publicUnavailableResponse } from "../../../../../lib/public/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await (await getPublicHandlers()).tape(request);
  } catch {
    return publicUnavailableResponse();
  }
}
