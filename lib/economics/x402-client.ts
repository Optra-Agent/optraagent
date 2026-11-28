import { createHash } from "node:crypto";
import { cmpAtomic } from "./atomic";
import type { DrizzleEconomicRepository } from "./drizzle-repository";
import { validatePaidVolatilityResource } from "./resource-validator";
import type { VolatilityOraclePayload } from "./resource-validator";
import type {
  EconomicAuthorizationDecision,
  MachineServiceRequest,
  PaymentMode,
  ServiceProvider,
  SettlementMode,
  X402PaymentRecordView,
} from "./types";
import { signX402ExactEvmPayment } from "./x402-signer";
import type { X402PaymentRequirement } from "./x402-signer";

export type X402FetchResult<T> =
  | {
      ok: true;
      data: T;
      paymentRecord: X402PaymentRecordView;
      authorization: EconomicAuthorizationDecision;
      duplicate: boolean;
    }
  | {
      ok: false;
      reasonCode: string;
      reason: string;
      paymentRecord?: X402PaymentRecordView;
      authorization?: EconomicAuthorizationDecision;
    };

export type PaidServiceFetchInput = {
  agentId: string;
  agentStatus: "draft" | "running" | "paused" | "stopped";
  request: MachineServiceRequest;
  provider: ServiceProvider | null;
  economicRepo: DrizzleEconomicRepository;
  /** Optional custom fetch implementation (used for in-process Next.js route calls or unit tests). */
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  paymentMode?: PaymentMode;
  now?: Date;
};

function sha256Hex(value: unknown): string {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
}

function parsePaymentRequiredHeader(response: Response, body: unknown): X402PaymentRequirement | null {
  const header = response.headers.get("payment-required") ?? response.headers.get("x-payment-required");
  if (header) {
    try {
      const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { accepts?: X402PaymentRequirement[] } & Partial<X402PaymentRequirement>;
      if (Array.isArray(parsed.accepts) && parsed.accepts[0]) return parsed.accepts[0];
      if (parsed.scheme === "exact" && parsed.amount && parsed.payTo) return parsed as X402PaymentRequirement;
    } catch {
      // fall through to JSON body parsing
    }
  }
  if (body && typeof body === "object") {
    const obj = body as { accepts?: X402PaymentRequirement[] };
    if (Array.isArray(obj.accepts) && obj.accepts[0]) return obj.accepts[0];
  }
  return null;
}

function parseSettlementReceipt(response: Response, body: unknown): {
  paymentReference: string | null;
  settlementReference: string | null;
  txHash: string | null;
  settlementMode: SettlementMode;
} {
  const header = response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
  if (header) {
    try {
      const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>;
      return {
        paymentReference: typeof decoded.paymentReference === "string" ? decoded.paymentReference : null,
        settlementReference: typeof decoded.settlementReference === "string" ? decoded.settlementReference : null,
        txHash: typeof decoded.transaction === "string" ? decoded.transaction : typeof decoded.txHash === "string" ? decoded.txHash : null,
        settlementMode: decoded.settlementMode === "ONCHAIN_SETTLED" ? "ONCHAIN_SETTLED" : "PAPER_REHEARSAL",
      };
    } catch {
      // ignore malformed header
    }
  }
  const receipt = body && typeof body === "object" ? (body as Record<string, unknown>).x402Receipt as Record<string, unknown> | undefined : undefined;
  return {
    paymentReference: typeof receipt?.paymentReference === "string" ? receipt.paymentReference : null,
    settlementReference: typeof receipt?.settlementReference === "string" ? receipt.settlementReference : null,
    txHash: typeof receipt?.txHash === "string" ? receipt.txHash : null,
    settlementMode: receipt?.settlementMode === "ONCHAIN_SETTLED" ? "ONCHAIN_SETTLED" : "PAPER_REHEARSAL",
  };
}

/**
 * Reusable x402 Client Runtime (T3).
 * Encapsulates HTTP 402 discovery, quote normalization, deterministic policy authorization,
 * EIP-3009 signing, retry with PAYMENT-SIGNATURE, reconciliation, and resource validation.
 */
export async function executePaidVolatilityRequest(
  input: PaidServiceFetchInput,
): Promise<X402FetchResult<VolatilityOraclePayload>> {
  const now = input.now ?? new Date(input.request.createdAt);
  const fetcher = input.fetcher ?? fetch;
  const account = await input.economicRepo.getOrCreateEconomicAccount(input.agentId, (await input.economicRepo.getAgentOwnerId(input.agentId))?.ownerId ?? input.agentId, { now });
  const requestHash = sha256Hex(input.request);

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "RESOURCE_REQUIRED",
    providerId: input.provider?.id ?? input.request.providerId ?? null,
    serviceCategory: input.request.category,
    requestHash,
    economicMandateHash: account.mandateHash,
    reason: input.request.purpose,
    now,
  });

  if (!input.provider) {
    const denied = await input.economicRepo.authorizePaymentRequest({
      agentId: input.agentId,
      agentStatus: input.agentStatus,
      request: input.request,
      requestHash,
      provider: null,
      paymentMode: input.paymentMode ?? "EXACT",
      now,
    });
    await input.economicRepo.recordTapeEvent({
      decisionId: input.request.decisionId,
      agentId: input.agentId,
      eventType: "X402_PAYMENT_DENIED",
      providerId: input.request.providerId ?? "unknown",
      serviceCategory: input.request.category,
      amountAtomic: input.request.maxPriceAtomic,
      asset: input.request.asset,
      requestHash,
      economicMandateHash: denied.mandateHash,
      reason: `${denied.decision.reasonCode}: ${denied.decision.reason}`,
      now,
    });
    return {
      ok: false,
      reasonCode: denied.decision.reasonCode,
      reason: denied.decision.reason,
      paymentRecord: denied.paymentRecord,
      authorization: denied.decision,
    };
  }

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "SERVICE_DISCOVERED",
    providerId: input.provider.id,
    serviceCategory: input.provider.serviceCategory,
    requestHash,
    economicMandateHash: account.mandateHash,
    reason: `Selected approved provider ${input.provider.name} (${input.provider.ownership}).`,
    now,
  });

  const targetUrl = new URL(input.provider.endpoint, "http://localhost");
  targetUrl.searchParams.set("symbol", input.request.underlyingSymbol);
  targetUrl.searchParams.set("decisionId", input.request.decisionId);
  targetUrl.searchParams.set("requestNonce", input.request.requestNonce);

  // Step 1: Initial HTTP request to receive x402 Payment Requirement (HTTP 402).
  const initialResponse = await fetcher(targetUrl.pathname + targetUrl.search, { method: "GET" });
  let requirement: X402PaymentRequirement | null = null;
  let initialBody: unknown = null;
  try {
    initialBody = await initialResponse.clone().json();
  } catch {
    initialBody = null;
  }

  if (initialResponse.status === 402) {
    requirement = parsePaymentRequiredHeader(initialResponse, initialBody);
  } else if (!initialResponse.ok) {
    return {
      ok: false,
      reasonCode: "PROVIDER_UNAVAILABLE",
      reason: `Provider ${input.provider.id} returned HTTP ${initialResponse.status} during quote discovery.`,
    };
  }

  if (!requirement) {
    return {
      ok: false,
      reasonCode: "INVALID_X402_CHALLENGE",
      reason: `Provider ${input.provider.id} did not return a valid x402 v2 payment requirement.`,
    };
  }

  const quotedRequest: MachineServiceRequest = {
    ...input.request,
    quotedPriceAtomic: requirement.amount,
  };

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "SERVICE_QUOTED",
    providerId: input.provider.id,
    serviceCategory: input.request.category,
    amountAtomic: requirement.amount,
    asset: input.request.asset,
    requestHash,
    economicMandateHash: account.mandateHash,
    reason: `Provider quoted ${requirement.amount} atomic ${input.request.asset} on ${requirement.network}.`,
    now,
  });

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "X402_PAYMENT_REQUESTED",
    providerId: input.provider.id,
    serviceCategory: input.request.category,
    amountAtomic: requirement.amount,
    asset: input.request.asset,
    requestHash,
    economicMandateHash: account.mandateHash,
    reason: `Requesting deterministic Economic Policy authorization for ${input.request.purpose}.`,
    now,
  });

  // Step 2: Deterministic Economic Policy Engine authorization + replay protection.
  const auth = await input.economicRepo.authorizePaymentRequest({
    agentId: input.agentId,
    agentStatus: input.agentStatus,
    request: quotedRequest,
    requestHash,
    provider: input.provider,
    paymentChallenge: requirement as unknown as Record<string, unknown>,
    paymentMode: input.paymentMode ?? "EXACT",
    now,
  });

  if (!auth.decision.allowed) {
    await input.economicRepo.recordTapeEvent({
      decisionId: input.request.decisionId,
      agentId: input.agentId,
      eventType: "X402_PAYMENT_DENIED",
      providerId: input.provider.id,
      serviceCategory: input.request.category,
      amountAtomic: requirement.amount,
      asset: input.request.asset,
      requestHash,
      economicMandateHash: auth.mandateHash,
      reason: `${auth.decision.reasonCode}: ${auth.decision.reason}`,
      now,
    });
    return {
      ok: false,
      reasonCode: auth.decision.reasonCode,
      reason: auth.decision.reason,
      paymentRecord: auth.paymentRecord,
      authorization: auth.decision,
    };
  }

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "X402_PAYMENT_AUTHORIZED",
    providerId: input.provider.id,
    serviceCategory: input.request.category,
    amountAtomic: requirement.amount,
    asset: input.request.asset,
    requestHash,
    economicMandateHash: auth.mandateHash,
    reason: auth.duplicate
      ? "Idempotent replay authorized without double-charging."
      : `Authorized under Economic Mandate (${auth.decision.remainingDailyBudgetAtomic} atomic daily remaining).`,
    now,
  });

  // Step 3: Sign EIP-3009 TransferWithAuthorization using isolated signer and retry request.
  const signed = await signX402ExactEvmPayment(requirement, now);
  const paidResponse = await fetcher(targetUrl.pathname + targetUrl.search, {
    method: "GET",
    headers: {
      "payment-signature": signed.headerValue,
      "x-payment": signed.headerValue,
    },
  });

  let paidBody: unknown = null;
  try {
    paidBody = await paidResponse.json();
  } catch {
    paidBody = null;
  }

  if (!paidResponse.ok) {
    await input.economicRepo.reconcilePaymentSettlement({
      paymentRecordId: auth.paymentRecord.id,
      agentId: input.agentId,
      settled: false,
      paymentReference: null,
      settlementReference: null,
      txHash: null,
      settlementMode: "PAPER_REHEARSAL",
      responseHash: null,
      validationStatus: "REJECTED",
      validationReason: `Provider returned HTTP ${paidResponse.status} after payment authorization.`,
      now,
    });
    return {
      ok: false,
      reasonCode: "PROVIDER_FULFILLMENT_FAILED",
      reason: `Provider returned HTTP ${paidResponse.status} after payment submission.`,
      paymentRecord: auth.paymentRecord,
      authorization: auth.decision,
    };
  }

  const receipt = parseSettlementReceipt(paidResponse, paidBody);
  const resourcePayload =
    paidBody && typeof paidBody === "object" && "data" in (paidBody as Record<string, unknown>)
      ? (paidBody as Record<string, unknown>).data
      : paidBody;
  const responseHash = sha256Hex(resourcePayload);

  // Step 4: Validate paid resource before allowing it into strategy evaluation.
  const validation = validatePaidVolatilityResource(resourcePayload, input.provider, quotedRequest, { now });

  const reconciled = await input.economicRepo.reconcilePaymentSettlement({
    paymentRecordId: auth.paymentRecord.id,
    agentId: input.agentId,
    settled: true,
    paymentReference: receipt.paymentReference ?? `x402-${auth.paymentRecord.id.slice(0, 8)}`,
    settlementReference: receipt.settlementReference,
    txHash: receipt.txHash,
    settlementMode: receipt.settlementMode,
    responseHash,
    validationStatus: validation.valid ? "VALIDATED" : "REJECTED",
    validationReason: validation.reason,
    now,
  });

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "X402_PAYMENT_SETTLED",
    providerId: input.provider.id,
    serviceCategory: input.request.category,
    amountAtomic: requirement.amount,
    asset: input.request.asset,
    requestHash,
    responseHash,
    paymentReference: reconciled.paymentRecord.paymentReference,
    txHash: reconciled.paymentRecord.txHash,
    economicMandateHash: auth.mandateHash,
    reason: reconciled.paymentRecord.txHash
      ? `Settled on-chain (${reconciled.paymentRecord.txHash}).`
      : `Settled in ${reconciled.paymentRecord.settlementMode} (${reconciled.paymentRecord.paymentReference}).`,
    now,
  });

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: "RESOURCE_RECEIVED",
    providerId: input.provider.id,
    serviceCategory: input.request.category,
    requestHash,
    responseHash,
    paymentReference: reconciled.paymentRecord.paymentReference,
    txHash: reconciled.paymentRecord.txHash,
    economicMandateHash: auth.mandateHash,
    reason: `Received payload from ${input.provider.name}.`,
    now,
  });

  await input.economicRepo.recordTapeEvent({
    decisionId: input.request.decisionId,
    agentId: input.agentId,
    eventType: validation.valid ? "RESOURCE_VALIDATED" : "RESOURCE_REJECTED",
    providerId: input.provider.id,
    serviceCategory: input.request.category,
    requestHash,
    responseHash,
    paymentReference: reconciled.paymentRecord.paymentReference,
    txHash: reconciled.paymentRecord.txHash,
    economicMandateHash: auth.mandateHash,
    reason: validation.reason,
    now,
  });

  // Budget threshold telemetry
  if (reconciled.account.machineSpendingStatus === "EXHAUSTED" || BigInt(reconciled.account.remainingTodayAtomic) === 0n) {
    await input.economicRepo.recordTapeEvent({
      decisionId: input.request.decisionId,
      agentId: input.agentId,
      eventType: "SERVICE_BUDGET_EXHAUSTED",
      economicMandateHash: auth.mandateHash,
      reason: "Daily or total isolated Service Budget has been exhausted.",
      now,
    });
  } else if (cmpAtomic(reconciled.account.remainingTodayAtomic, requirement.amount) < 0) {
    await input.economicRepo.recordTapeEvent({
      decisionId: input.request.decisionId,
      agentId: input.agentId,
      eventType: "SERVICE_BUDGET_LOW",
      economicMandateHash: auth.mandateHash,
      reason: `Remaining daily Service Budget (${reconciled.account.remainingTodayAtomic} atomic) is below next request cost.`,
      now,
    });
  }

  if (!validation.valid) {
    return {
      ok: false,
      reasonCode: validation.code,
      reason: validation.reason,
      paymentRecord: reconciled.paymentRecord,
      authorization: auth.decision,
    };
  }

  return {
    ok: true,
    data: validation.data,
    paymentRecord: reconciled.paymentRecord,
    authorization: auth.decision,
    duplicate: auth.duplicate,
  };
}
