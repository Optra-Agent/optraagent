import { getDatabase } from "../db/client";
import { DrizzlePublicRepository } from "../paper/public-repository";
import { createPublicHandlers } from "./handlers";

export async function getPublicHandlers() {
  return createPublicHandlers({ repository: new DrizzlePublicRepository(await getDatabase()) });
}

export function publicUnavailableResponse(): Response {
  return Response.json({
    error: { code: "UPSTREAM_UNAVAILABLE", message: "The public House Agent data is temporarily unavailable.", retryable: true },
  }, { status: 503, headers: { "cache-control": "no-store" } });
}
