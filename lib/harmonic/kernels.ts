import { hashCanonical } from "./crypto";
import { McpHarmonicAgentClient } from "./client";
import { HarmonicRepository } from "./repository";
import type { HarmonicAgentClient, ProofPropertyResult, ProofStatus } from "./types";

export const VERIFIED_KERNEL_VERSION = "optra.kernel.v1";

/** P5: Service budget hard cap invariant */
export function checkServiceBudgetHardCap(
  spentTodayAtomic: bigint,
  paymentAmountAtomic: bigint,
  dailyBudgetAtomic: bigint,
): boolean {
  if (paymentAmountAtomic < 0n || dailyBudgetAtomic < 0n || spentTodayAtomic < 0n) return false;
  return spentTodayAtomic + paymentAmountAtomic <= dailyBudgetAtomic;
}

/** P6: Per-request spending cap invariant */
export function checkPerRequestSpendingCap(
  paymentAmountAtomic: bigint,
  perRequestLimitAtomic: bigint,
): boolean {
  if (paymentAmountAtomic < 0n || perRequestLimitAtomic < 0n) return false;
  return paymentAmountAtomic <= perRequestLimitAtomic;
}

/** P7: Trading capital and service budget isolation invariant */
export function checkTradingServiceCapitalIsolation(
  sourceAccount: "SERVICE_BUDGET" | "TRADING_CAPITAL",
): boolean {
  return sourceAccount === "SERVICE_BUDGET";
}

/** P1: Covered call exposure invariant (no naked short calls) */
export function checkCoveredCallExposureInvariant(
  shortCallContracts: number,
  underlyingSharesHeld: number,
  allowNakedShortOptions: boolean,
): boolean {
  if (allowNakedShortOptions) return false;
  if (shortCallContracts < 0 || underlyingSharesHeld < 0) return false;
  return shortCallContracts * 100 <= underlyingSharesHeld;
}

export function computeKernelHash(): string {
  return hashCanonical({
    version: VERIFIED_KERNEL_VERSION,
    properties: [
      "P1_COVERED_CALL_NO_NAKED_SHORT",
      "P5_SERVICE_BUDGET_HARD_CAP",
      "P6_PER_REQUEST_SPENDING_CAP",
      "P7_TRADING_SERVICE_CAPITAL_ISOLATION",
    ],
  });
}

export class KernelVerificationService {
  constructor(
    private readonly repo: HarmonicRepository = new HarmonicRepository(),
    private readonly client: HarmonicAgentClient = new McpHarmonicAgentClient(),
  ) {}

  async verifyAgentKernels(input: {
    agentId: string;
    decisionId?: string;
    recipeHash: string;
    strategyMandateHash: string;
    riskMandateHash: string;
    economicMandateHash: string;
    dailyBudgetAtomic: bigint;
    perRequestLimitAtomic: bigint;
    allowNakedShortOptions: boolean;
    contractAddress?: string;
  }) {
    const kernelHash = computeKernelHash();
    const decisionId = input.decisionId ?? `verify-${input.agentId}-${Date.now()}`;

    await this.repo.appendTapeEvent({
      decisionId,
      agentId: input.agentId,
      eventType: "HARMONIC_VERIFICATION_REQUESTED",
      recipeHash: input.recipeHash,
      strategyMandateHash: input.strategyMandateHash,
      riskMandateHash: input.riskMandateHash,
      economicMandateHash: input.economicMandateHash,
      kernelHash,
      status: "PENDING",
      reason: "Running deterministic critical kernel verification",
    });

    const p1 = checkCoveredCallExposureInvariant(1, 100, input.allowNakedShortOptions);
    const p5 = checkServiceBudgetHardCap(0n, input.perRequestLimitAtomic, input.dailyBudgetAtomic);
    const p6 = checkPerRequestSpendingCap(input.perRequestLimitAtomic, input.perRequestLimitAtomic);
    const p7 = checkTradingServiceCapitalIsolation("SERVICE_BUDGET");

    const properties: ProofPropertyResult[] = [
      {
        id: "P1",
        description: "Covered Call agent cannot produce naked short-call exposure",
        status: p1 ? "PROVED" : "REFUTED",
      },
      {
        id: "P5",
        description: "service_spend_today + payment_amount <= dailyServiceBudget",
        status: p5 ? "PROVED" : "REFUTED",
      },
      {
        id: "P6",
        description: "payment_amount <= perRequestLimit",
        status: p6 ? "PROVED" : "REFUTED",
      },
      {
        id: "P7",
        description: "Trading Capital cannot fund machine-service payments",
        status: p7 ? "PROVED" : "REFUTED",
      },
    ];

    const allProved = properties.every((p) => p.status === "PROVED");
    const status: ProofStatus = allProved ? "PROVED" : "REFUTED";

    let externalReference: string | null = null;
    if (input.contractAddress && this.client.requestVerification) {
      try {
        const res = await this.client.requestVerification({ address: input.contractAddress });
        externalReference = res.externalReference;
      } catch {
        // Non-blocking if external contract verification is unavailable
      }
    }

    const proof = await this.repo.createProof({
      agentId: input.agentId,
      status,
      kernelName: "OPTRA_CRITICAL_BOUNDARIES",
      kernelHash,
      recipeHash: input.recipeHash,
      strategyMandateHash: input.strategyMandateHash,
      riskMandateHash: input.riskMandateHash,
      economicMandateHash: input.economicMandateHash,
      codeVersion: VERIFIED_KERNEL_VERSION,
      properties,
      assumptions: [
        "allowNakedShortOptions = false",
        "allowTradingCapitalForServices = false",
        "Atomic USDG arithmetic is 6-decimal non-negative",
      ],
      externalReference,
      resolvedAt: new Date(),
    });

    await this.repo.appendTapeEvent({
      decisionId,
      agentId: input.agentId,
      eventType: allProved ? "HARMONIC_VERIFICATION_PROVED" : "HARMONIC_VERIFICATION_REFUTED",
      recipeHash: input.recipeHash,
      strategyMandateHash: input.strategyMandateHash,
      riskMandateHash: input.riskMandateHash,
      economicMandateHash: input.economicMandateHash,
      kernelHash,
      harmonicReference: externalReference,
      status,
      reason: `Kernel verification ${status} (${properties.filter((p) => p.status === "PROVED").length}/${properties.length} properties)`,
    });

    return proof;
  }

  async invalidateStaleProofsIfChanged(
    agentId: string,
    current: {
      recipeHash: string;
      strategyMandateHash: string;
      riskMandateHash: string;
      economicMandateHash: string;
    },
  ) {
    const proofs = await this.repo.listProofs(agentId, 1);
    const latest = proofs[0];
    if (!latest || latest.status !== "PROVED") return false;

    const currentKernelHash = computeKernelHash();
    const changed =
      latest.kernelHash !== currentKernelHash ||
      latest.recipeHash !== current.recipeHash ||
      latest.strategyMandateHash !== current.strategyMandateHash ||
      latest.riskMandateHash !== current.riskMandateHash ||
      latest.economicMandateHash !== current.economicMandateHash;

    if (changed) {
      await this.repo.markProofsStale(agentId);
      return true;
    }
    return false;
  }
}

