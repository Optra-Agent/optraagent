import { SessionSchema } from "../domain/contracts";
import { authUnavailableResponse, getAuthHandlers } from "./runtime";
import type { Session } from "../domain/contracts";

export async function lookupWalletSession(request: Request): Promise<Session | Response> {
  try {
    const response = await (await getAuthHandlers()).me(request);
    if (!response.ok) return response;
    const parsed = SessionSchema.safeParse(await response.json());
    if (!parsed.success) {
      return Response.json({
        error: { code: "INTERNAL_ERROR", message: "Unable to validate the current wallet session.", retryable: true },
      }, { status: 500, headers: { "cache-control": "no-store" } });
    }
    return parsed.data;
  } catch {
    return authUnavailableResponse();
  }
}
