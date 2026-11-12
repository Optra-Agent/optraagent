import { authUnavailableResponse, getAuthHandlers } from "../../../lib/auth/runtime";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    return await (await getAuthHandlers()).me(request);
  } catch {
    return authUnavailableResponse();
  }
}
