/**
 * One HTTP client for every Crius candle request (charts, backtest history, the scheduler). It sends the optional API key,
 * honors the provider's retry guidance for a short per-second limit, retries a fast server error once, and says WHY a
 * request failed so callers can tell a rate limit from an outage. It never invents or repairs data.
 *
 * Without a key Crius allows 2 requests per second per IP and 300 requests per day per app; with a free key 5 per second and a
 * monthly credit quota. The key is read from CRIUS_API_KEY and is only ever sent to a crius.sh host.
 */
export type CriusFailureKind = "rate_limited" | "daily_limit" | "quota" | "auth" | "busy" | "server" | "timeout" | "network" | "invalid";

export class CriusRequestError extends Error {
  constructor(readonly kind: CriusFailureKind, readonly status: number | null, readonly retryAfterMs: number | null) {
    super(`crius ${kind}${status ? ` (${status})` : ""}`);
    this.name = "CriusRequestError";
  }
}

export type CriusClientOptions = {
  fetcher?: typeof fetch;
  apiKey?: string | undefined;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** A per-second limit is waited out only when the provider asks for at most this long. */
  maxWaitMs?: number;
  /** Total attempts for a rate limit; a fast server error or dropped connection gets one retry. */
  maxAttempts?: number;
  /** How long a daily or monthly limit pauses new requests, so a limited app does not hammer the provider. */
  blockMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function retryAfterMs(response: Response, body: unknown): number | null {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header >= 0 && response.headers.get("retry-after") !== null) return Math.round(header * 1000);
  const fromBody = (body as { error?: { retry_after_ms?: unknown } } | null)?.error?.retry_after_ms;
  return typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0 ? Math.round(fromBody) : null;
}

export function createCriusClient(options: CriusClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxWaitMs = options.maxWaitMs ?? 3_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const blockMs = options.blockMs ?? 5 * 60_000;
  const apiKey = options.apiKey?.trim() || undefined;
  let blocked: { until: number; error: CriusRequestError } | null = null;

  return {
    hasKey: Boolean(apiKey),
    async getJson(url: string): Promise<unknown> {
      if (blocked && blocked.until > now().getTime()) throw blocked.error;
      const headers: Record<string, string> = { accept: "application/json" };
      if (apiKey && /(^|\.)crius\.sh$/.test(new URL(url).hostname)) headers["x-api-key"] = apiKey;
      let serverRetried = false;
      for (let attempt = 1; ; attempt += 1) {
        let failure: CriusRequestError;
        try {
          const response = await fetcher(url, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
          if (response.ok) {
            try { return await response.json(); } catch { throw new CriusRequestError("invalid", response.status, null); }
          }
          const body = await response.json().catch(() => null) as unknown;
          const wait = retryAfterMs(response, body);
          const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
          if (response.status === 429) {
            const kind: CriusFailureKind = code === "daily_limit_reached" ? "daily_limit" : code === "quota_exceeded" ? "quota" : "rate_limited";
            failure = new CriusRequestError(kind, 429, wait);
          } else if (response.status === 401 || response.status === 403) failure = new CriusRequestError("auth", response.status, null);
          else if (response.status === 503) failure = new CriusRequestError("busy", 503, wait);
          else if (response.status >= 500) failure = new CriusRequestError("server", response.status, wait);
          else failure = new CriusRequestError("invalid", response.status, null);
        } catch (error) {
          if (error instanceof CriusRequestError) throw error;
          // A timeout is not retried: a second wait would double the delay. A dropped connection gets one retry.
          failure = new CriusRequestError(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network", null, null);
        }

        if (failure.kind === "daily_limit" || failure.kind === "quota") {
          blocked = { until: now().getTime() + Math.min(blockMs, failure.retryAfterMs ?? blockMs), error: failure };
          throw failure;
        }
        if (failure.kind === "rate_limited") {
          const wait = failure.retryAfterMs ?? 500 * attempt;
          if (attempt >= maxAttempts || wait > maxWaitMs) throw failure;
          await sleep(wait);
          continue;
        }
        if ((failure.kind === "busy" || failure.kind === "server" || failure.kind === "network") && !serverRetried) {
          serverRetried = true;
          await sleep(Math.min(failure.retryAfterMs ?? 400, maxWaitMs));
          continue;
        }
        throw failure;
      }
    },
  };
}

export type CriusClient = ReturnType<typeof createCriusClient>;

/** A short, honest sentence for a failure; it states the cause without exposing provider internals. */
export function criusFailureMessage(error: unknown): string {
  const kind = error instanceof CriusRequestError ? error.kind : "network";
  if (kind === "rate_limited") return "The candle provider is rate limiting requests. Try again shortly.";
  if (kind === "daily_limit" || kind === "quota") return "The candle provider's request allowance is used up for now. Verified candles resume when it resets.";
  if (kind === "auth") return "The candle provider rejected this app's credentials.";
  if (kind === "invalid") return "The candle provider returned data this app cannot verify.";
  if (kind === "timeout") return "The candle provider did not answer in time.";
  return "The candle provider is temporarily unavailable.";
}
