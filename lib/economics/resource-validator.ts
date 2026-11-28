import { z } from "zod";
import type { MachineServiceRequest, ServiceProvider } from "./types";

export const VolatilityOraclePayloadSchema = z.object({
  schema: z.literal("optra.volatility.v1"),
  providerId: z.string().min(1),
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  observedAt: z.iso.datetime({ offset: true }),
  spotUsd: z.number().positive(),
  realizedVolatility30d: z.number().nonnegative().max(5),
  impliedVolatility: z.number().positive().max(5),
  ivRank: z.number().min(0).max(100),
  regime: z.enum(["LOW_VOL", "NORMAL_VOL", "ELEVATED_VOL", "CRISIS_VOL"]),
  source: z.string().min(1),
  sampleCount: z.number().int().nonnegative(),
  requestNonce: z.string().min(1).optional(),
  decisionId: z.string().min(1).optional(),
}).strict();

export type VolatilityOraclePayload = z.infer<typeof VolatilityOraclePayloadSchema>;

export type ResourceValidationResult<T> =
  | { valid: true; data: T; reason: string }
  | { valid: false; code: "INVALID_SCHEMA" | "WRONG_UNDERLYING" | "STALE_DATA" | "OUT_OF_RANGE" | "PROVIDER_MISMATCH" | "CORRELATION_MISMATCH"; reason: string };

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours max freshness for hourly candle-backed data

/**
 * Resource Validation Layer (T6).
 * Paid data is never trusted simply because it was paid for.
 */
export function validatePaidVolatilityResource(
  rawResponse: unknown,
  provider: ServiceProvider,
  request: MachineServiceRequest,
  options?: { now?: Date; maxAgeMs?: number },
): ResourceValidationResult<VolatilityOraclePayload> {
  const parsed = VolatilityOraclePayloadSchema.safeParse(rawResponse);
  if (!parsed.success) {
    return {
      valid: false,
      code: "INVALID_SCHEMA",
      reason: `Paid resource failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid payload"}.`,
    };
  }

  const data = parsed.data;
  if (data.providerId !== provider.id) {
    return {
      valid: false,
      code: "PROVIDER_MISMATCH",
      reason: `Provider mismatch: expected ${provider.id}, received ${data.providerId}.`,
    };
  }

  if (data.symbol !== request.underlyingSymbol) {
    return {
      valid: false,
      code: "WRONG_UNDERLYING",
      reason: `Underlying mismatch: requested ${request.underlyingSymbol}, received ${data.symbol}.`,
    };
  }

  if (data.requestNonce && data.requestNonce !== request.requestNonce) {
    return {
      valid: false,
      code: "CORRELATION_MISMATCH",
      reason: `Request nonce mismatch: expected ${request.requestNonce}, received ${data.requestNonce}.`,
    };
  }

  if (data.decisionId && data.decisionId !== request.decisionId) {
    return {
      valid: false,
      code: "CORRELATION_MISMATCH",
      reason: `Decision ID mismatch: expected ${request.decisionId}, received ${data.decisionId}.`,
    };
  }

  const nowMs = (options?.now ?? new Date()).getTime();
  const observedMs = Date.parse(data.observedAt);
  const maxAgeMs = options?.maxAgeMs ?? MAX_AGE_MS;
  if (!Number.isFinite(observedMs) || nowMs - observedMs > maxAgeMs || observedMs > nowMs + 60_000) {
    return {
      valid: false,
      code: "STALE_DATA",
      reason: `Paid resource timestamp ${data.observedAt} is stale or invalid relative to evaluation time.`,
    };
  }

  if (data.impliedVolatility <= 0 || data.impliedVolatility > 5 || data.spotUsd <= 0) {
    return {
      valid: false,
      code: "OUT_OF_RANGE",
      reason: "Paid volatility or spot values are outside safe numeric bounds.",
    };
  }

  return {
    valid: true,
    data,
    reason: `Validated ${data.schema} for ${data.symbol} (IV ${(data.impliedVolatility * 100).toFixed(1)}%, regime ${data.regime}).`,
  };
}
