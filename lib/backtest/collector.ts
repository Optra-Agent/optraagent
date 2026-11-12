import { timingSafeEqual } from "node:crypto";
import { ApiErrorSchema, MarketHistoryCollectionSchema, MarketSnapshotSchema } from "../domain/contracts";
import type { MarketSnapshot } from "../domain/contracts";

export type MarketHistoryCollectorOptions = {
  secret?: string;
  symbols: string[];
  getSnapshot: (symbol: string) => Promise<MarketSnapshot>;
  storeSnapshot: (snapshot: MarketSnapshot) => Promise<boolean>;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function error(code: "UNAUTHORIZED" | "UPSTREAM_UNAVAILABLE" | "INTERNAL_ERROR", message: string, status: number): Response {
  return json(ApiErrorSchema.parse({ error: { code, message, retryable: status >= 500 } }), status);
}

function matchesBearerToken(header: string | null, secret: string): boolean {
  if (!header) return false;
  const separator = header.indexOf(" ");
  if (separator < 1 || header.slice(0, separator).toLowerCase() !== "bearer") return false;
  const candidate = Buffer.from(header.slice(separator + 1));
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createMarketHistoryCollector(options: MarketHistoryCollectorOptions) {
  const symbols = [...new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9.]{1,16}$/.test(symbol)))];

  return {
    async collect(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      if (!options.secret) return error("UPSTREAM_UNAVAILABLE", "CRON_SECRET is required for scheduled market history collection.", 503);
      if (!matchesBearerToken(request.headers.get("authorization"), options.secret)) {
        return error("UNAUTHORIZED", "A valid scheduler credential is required.", 401);
      }
      if (symbols.length === 0) return error("UPSTREAM_UNAVAILABLE", "No supported market-history symbols are configured.", 503);

      let stored = 0;
      let alreadyRecorded = 0;
      const unavailableSymbols: string[] = [];
      for (const symbol of symbols) {
        try {
          const snapshot = MarketSnapshotSchema.parse(await options.getSnapshot(symbol));
          if (snapshot.symbol !== symbol) {
            unavailableSymbols.push(symbol);
            continue;
          }
          if (await options.storeSnapshot(snapshot)) stored += 1;
          else alreadyRecorded += 1;
        } catch {
          unavailableSymbols.push(symbol);
        }
      }

      const result = MarketHistoryCollectionSchema.parse({ requested: symbols.length, stored, alreadyRecorded, unavailableSymbols });
      return json(result, stored === 0 && alreadyRecorded === 0 ? 503 : 200);
    },
  };
}
