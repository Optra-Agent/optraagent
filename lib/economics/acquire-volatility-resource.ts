import { createHash } from "node:crypto";
import type { AppDatabase } from "../db/client";
import { GET as volatilityOracleGet } from "../../app/api/x402/providers/volatility/route";
import { DrizzleEconomicRepository } from "./drizzle-repository";
import type { VolatilityOraclePayload } from "./resource-validator";
import { OPTRA_VOLATILITY_PROVIDER_ID } from "./types";
import type { MachineServiceRequest, X402PaymentRecordView } from "./types";
import { executePaidVolatilityRequest } from "./x402-client";

export type AcquireVolatilityResult = {
  status: "acquired" | "denied" | "disabled" | "invalid";
  decisionId: string;
  volatilityData: VolatilityOraclePayload | null;
  paymentRecord?: X402PaymentRecordView;
  reason: string;
};

/**
 * In-process Next.js route fetcher so server-side ticks (scheduler & API handlers)
 * exercise the exact HTTP 402 -> EIP-3009 sign -> verify -> settle -> validate flow
 * without requiring an external loopback TCP round-trip.
 */
async function inProcessVolatilityFetcher(url: string, init?: RequestInit): Promise<Response> {
  const fullUrl = url.startsWith("http") ? url : `http://localhost${url}`;
  const req = new Request(fullUrl, init);
  return volatilityOracleGet(req);
}

/**
 * Autonomous Resource Acquisition (T5) for House Agents and Custom Agents.
 * Called during strategy tick execution when an agent's Economic Mandate is enabled.
 */
export async function acquireVolatilityResourceForTick(input: {
  db: AppDatabase;
  agentId: string;
  ownerId: string;
  agentStatus: "draft" | "running" | "paused" | "stopped";
  isHouseAgent?: boolean;
  underlyingSymbol: string;
  tickId: string;
  occurredAt: string;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: Date;
}): Promise<AcquireVolatilityResult> {
  const now = input.now ?? new Date(input.occurredAt);
  const decisionId = `${input.agentId}:${input.tickId}`;
  const economicRepo = new DrizzleEconomicRepository(input.db);

  const account = await economicRepo.getOrCreateEconomicAccount(input.agentId, input.ownerId, {
    isHouseAgent: input.isHouseAgent,
    now,
  });

  if (!account.mandate.enabled) {
    return {
      status: "disabled",
      decisionId,
      volatilityData: null,
      reason: "Economic Mandate machine spending is disabled for this agent.",
    };
  }

  const providerId = account.mandate.approvedProviders[0] ?? OPTRA_VOLATILITY_PROVIDER_ID;
  const provider = await economicRepo.getServiceProvider(providerId);
  const requestNonce = createHash("sha256")
    .update(`${input.agentId}:${decisionId}:${input.tickId}`)
    .digest("hex")
    .slice(0, 32);

  const request: MachineServiceRequest = {
    decisionId,
    agentId: input.agentId,
    category: "VOLATILITY_DATA",
    providerId,
    purpose: `Acquire verified 30d realized & implied volatility regime for ${input.underlyingSymbol} strategy evaluation.`,
    underlyingSymbol: input.underlyingSymbol,
    maxPriceAtomic: account.mandate.perRequestLimitAtomic,
    asset: "USDG",
    expectedSchema: "optra.volatility.v1",
    criticality: "OPTIONAL",
    requestNonce,
    idempotencyKey: `x402-${input.tickId}`,
    createdAt: now.toISOString(),
  };

  const result = await executePaidVolatilityRequest({
    agentId: input.agentId,
    agentStatus: input.agentStatus,
    request,
    provider,
    economicRepo,
    fetcher: input.fetcher ?? inProcessVolatilityFetcher,
    now,
  });

  if (!result.ok) {
    return {
      status: result.reasonCode === "INVALID_SCHEMA" || result.reasonCode === "STALE_DATA" || result.reasonCode === "WRONG_UNDERLYING" ? "invalid" : "denied",
      decisionId,
      volatilityData: null,
      paymentRecord: result.paymentRecord,
      reason: `${result.reasonCode}: ${result.reason}`,
    };
  }

  return {
    status: "acquired",
    decisionId,
    volatilityData: result.data,
    paymentRecord: result.paymentRecord,
    reason: `Acquired & validated ${result.data.schema} for ${input.underlyingSymbol} (IV ${(result.data.impliedVolatility * 100).toFixed(1)}%).`,
  };
}

export async function recordStrategyEvaluatedEvent(input: {
  db: AppDatabase;
  agentId: string;
  decisionId: string;
  action: string;
  reason: string;
  now?: Date;
}): Promise<void> {
  const economicRepo = new DrizzleEconomicRepository(input.db);
  const account = await economicRepo.getOrCreateEconomicAccount(
    input.agentId,
    (await economicRepo.getAgentOwnerId(input.agentId))?.ownerId ?? input.agentId,
    { now: input.now },
  );
  await economicRepo.recordTapeEvent({
    decisionId: input.decisionId,
    agentId: input.agentId,
    eventType: "STRATEGY_EVALUATED",
    economicMandateHash: account.mandateHash,
    reason: `Strategy evaluated (${input.action}): ${input.reason}`,
    now: input.now,
  });
}
