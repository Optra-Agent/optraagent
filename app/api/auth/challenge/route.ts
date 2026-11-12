import { authUnavailableResponse, getAuthHandlers } from "../../../../lib/auth/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await (await getAuthHandlers()).challenge(request);
  } catch {
    return authUnavailableResponse();
  }
}
