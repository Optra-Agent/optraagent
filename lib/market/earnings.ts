import { z } from "zod";

/**
 * Earnings calendar read from Robinhood's public market-data endpoint (the same first-party host that already serves
 * the stock-token registry and quotes). Each event carries Robinhood's own `verified` flag: `true` means the company
 * confirmed (or already reported) the date, `false` means an estimate. The engine treats an estimate as a date that
 * may block entries but never as one that can open an earnings-only position.
 */

const DEFAULT_BASE_URL = "https://api.robinhood.com";

const EarningsRowSchema = z.object({
  symbol: z.string(),
  year: z.number().int(),
  quarter: z.number().int(),
  report: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timing: z.string().nullable().optional(),
    time: z.string().nullable().optional(),
    verified: z.boolean(),
  }).passthrough().nullable(),
}).passthrough();
const EarningsResponseSchema = z.object({ results: z.array(EarningsRowSchema) }).passthrough();

export type EarningsEvent = {
  /** Calendar date of the report (US/Eastern), `YYYY-MM-DD`. */
  reportDate: string;
  /** Report timestamp when known, else null. A null time on a `pm` event is treated as the end of that day's session. */
  reportAt: string | null;
  timing: "am" | "pm" | "unknown";
  verified: boolean;
  fiscalYear: number;
  fiscalQuarter: number;
};

export type EarningsSnapshot = {
  symbol: string;
  source: "robinhood_marketdata_earnings";
  fetchedAt: string;
  events: EarningsEvent[];
};

export class EarningsFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EarningsFeedError";
  }
}

export type EarningsFeedOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
  baseUrl?: string;
  requestTimeoutMs?: number;
};

export function parseEarningsResponse(symbol: string, payload: unknown, fetchedAt: string): EarningsSnapshot | null {
  const parsed = EarningsResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  const events: EarningsEvent[] = [];
  for (const row of parsed.data.results) {
    if (row.symbol.toUpperCase() !== symbol || !row.report) continue;
    const timing = row.report.timing === "am" || row.report.timing === "pm" ? row.report.timing : "unknown";
    const reportAtMs = row.report.time ? Date.parse(row.report.time) : Number.NaN;
    events.push({
      reportDate: row.report.date,
      reportAt: Number.isFinite(reportAtMs) ? new Date(reportAtMs).toISOString() : null,
      timing,
      verified: row.report.verified,
      fiscalYear: row.year,
      fiscalQuarter: row.quarter,
    });
  }
  events.sort((left, right) => left.reportDate.localeCompare(right.reportDate));
  return { symbol, source: "robinhood_marketdata_earnings", fetchedAt, events };
}

export function createEarningsFeed(options: EarningsFeedOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.requestTimeoutMs ?? 8000;
  return {
    /** A valid empty calendar is evidence; provider failures are thrown so callers cannot mistake them for no events. */
    async getEarnings(symbolInput: string): Promise<EarningsSnapshot> {
      const symbol = symbolInput.trim().toUpperCase();
      if (!/^[A-Z0-9.]{1,16}$/.test(symbol)) throw new EarningsFeedError("A supported market symbol is required.");
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/marketdata/earnings/?symbol=${encodeURIComponent(symbol)}`, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new EarningsFeedError("Robinhood earnings history is temporarily unavailable.");
      }
      if (!response.ok) throw new EarningsFeedError(`Robinhood earnings endpoint returned HTTP ${response.status}.`);
      let payload: unknown;
      try {
        payload = await response.json() as unknown;
      } catch {
        throw new EarningsFeedError("Robinhood earnings response is invalid.");
      }
      const snapshot = parseEarningsResponse(symbol, payload, now().toISOString());
      if (!snapshot) throw new EarningsFeedError("Robinhood earnings response is invalid.");
      return snapshot;
    },
  };
}
