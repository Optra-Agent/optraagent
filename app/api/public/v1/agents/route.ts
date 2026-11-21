import { getPublicHandlers, publicUnavailableResponse } from "../../../../../lib/public/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return await (await getPublicHandlers()).agents();
  } catch {
    return publicUnavailableResponse();
  }
}
