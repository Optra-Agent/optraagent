import type { Hex } from "viem";
import { z } from "zod";
import { EvmAddressSchema, SessionSchema } from "../domain/contracts";
import { AuthServiceError } from "./types";
import type { createWalletAuthService } from "./service";

const COOKIE_NAME = "optra_session";
const ChallengeInputSchema = z.object({ address: EvmAddressSchema }).strict();
const VerifyInputSchema = z.object({
  address: EvmAddressSchema,
  nonce: z.string().min(16).max(64),
  signature: z.string().regex(/^0x(?:[\da-fA-F]{2})+$/).length(132),
}).strict();

type WalletAuthService = ReturnType<typeof createWalletAuthService>;

export type AuthHandlerOptions = {
  secureCookie: boolean;
  now?: () => Date;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function error(code: "UNAUTHORIZED" | "VALIDATION_ERROR" | "INTERNAL_ERROR", message: string, status: number): Response {
  return json({ error: { code, message, retryable: status >= 500 } }, status);
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const value = item.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

function sessionCookie(token: string, expiresAt: string, options: AuthHandlerOptions): string {
  const now = options.now?.() ?? new Date();
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
  const secure = options.secureCookie ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

function clearSessionCookie(options: AuthHandlerOptions): string {
  const secure = options.secureCookie ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

function validationError(exception: unknown): Response {
  if (exception instanceof AuthServiceError) {
    return error("VALIDATION_ERROR", exception.message, 400);
  }
  return error("INTERNAL_ERROR", "Wallet authentication is temporarily unavailable.", 500);
}

export function createAuthHandlers(service: WalletAuthService, options: AuthHandlerOptions) {
  return {
    async challenge(request: Request): Promise<Response> {
      const input = ChallengeInputSchema.safeParse(await readJson(request));
      if (!input.success) return error("VALIDATION_ERROR", "A valid EVM wallet address is required.", 400);
      const origin = request.headers.get("origin");
      if (!origin) return error("VALIDATION_ERROR", "A browser origin is required.", 400);

      try {
        return json(await service.createChallenge(input.data.address, origin));
      } catch (exception) {
        return validationError(exception);
      }
    },

    async verify(request: Request): Promise<Response> {
      const input = VerifyInputSchema.safeParse(await readJson(request));
      if (!input.success) return error("VALIDATION_ERROR", "A valid address, nonce, and signature are required.", 400);
      const origin = request.headers.get("origin");
      if (!origin) return error("VALIDATION_ERROR", "A browser origin is required.", 400);

      try {
        const result = await service.verifyChallenge({
          ...input.data,
          signature: input.data.signature as Hex,
          origin,
        });
        const session = SessionSchema.parse({ user: result.user, expiresAt: result.expiresAt });
        const response = json(session);
        response.headers.append("set-cookie", sessionCookie(result.sessionToken, result.expiresAt, options));
        return response;
      } catch (exception) {
        return validationError(exception);
      }
    },

    async me(request: Request): Promise<Response> {
      try {
        const session = await service.readSession(readCookie(request));
        if (!session) return error("UNAUTHORIZED", "Sign in with an EVM wallet to continue.", 401);
        return json(SessionSchema.parse(session));
      } catch {
        return error("INTERNAL_ERROR", "Unable to load the current session.", 500);
      }
    },

    async logout(request: Request): Promise<Response> {
      try {
        await service.revokeSession(readCookie(request));
        const response = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        response.headers.append("set-cookie", clearSessionCookie(options));
        return response;
      } catch {
        return error("INTERNAL_ERROR", "Unable to close the current session.", 500);
      }
    },
  };
}
