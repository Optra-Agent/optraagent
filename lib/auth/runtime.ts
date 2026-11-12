import { DrizzleAuthRepository } from "./drizzle-repository";
import { createAuthHandlers } from "./handlers";
import { createWalletAuthService } from "./service";
import { getDatabase } from "../db/client";

export async function getAuthHandlers() {
  const appOrigin = process.env.APP_BASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!appOrigin) throw new Error("APP_BASE_URL is required in production.");

  const database = await getDatabase();
  const repository = new DrizzleAuthRepository(database);
  const service = createWalletAuthService(repository, { appOrigin });
  return createAuthHandlers(service, { secureCookie: process.env.NODE_ENV === "production" });
}

export function authUnavailableResponse(): Response {
  return Response.json({
    error: {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Wallet authentication is temporarily unavailable.",
      retryable: true,
    },
  }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
