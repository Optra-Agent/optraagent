import { createHash } from "node:crypto";
import { z } from "zod";
import { parseUsdgToAtomic } from "./atomic";

export const AtomicStringSchema = z.string().regex(/^\d+$/, "Must be a non-negative integer atomic unit string");
export const Sha256HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const ServiceCategorySchema = z.enum([
  "MARKET_DATA",
  "VOLATILITY_DATA",
  "PRICING",
  "COMPUTE",
  "VERIFICATION",
  "RESEARCH",
  "EXECUTION_SUPPORT",
  "TRANSACTION_REHEARSAL",
  "OTHER_APPROVED",
]);
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

export const OnBudgetExhaustedSchema = z.enum([
  "CONTINUE_CACHED_ONLY",
  "PAUSE_NONCRITICAL_OPERATIONS",
  "PAUSE_AGENT",
]);
export type OnBudgetExhausted = z.infer<typeof OnBudgetExhaustedSchema>;

export const OnUnknownProviderSchema = z.enum(["DENY", "REQUEST_USER_APPROVAL"]);
export type OnUnknownProvider = z.infer<typeof OnUnknownProviderSchema>;

export const EconomicMandateSchema = z.object({
  enabled: z.boolean(),
  settlementAsset: z.literal("USDG"),
  dailyServiceBudgetAtomic: AtomicStringSchema,
  perRequestLimitAtomic: AtomicStringSchema,
  approvedProviders: z.array(z.string().min(1)).max(64),
  approvedServiceCategories: z.array(ServiceCategorySchema).max(16),
  requireKnownProvider: z.boolean(),
  maxRequestsPerHour: z.number().int().positive().max(10_000).default(60),
  onBudgetExhausted: OnBudgetExhaustedSchema,
  onUnknownProvider: OnUnknownProviderSchema.default("DENY"),
  budgetReset: z.literal("UTC_DAILY"),
  /** Non-negotiable v1 invariant: Trading Capital can NEVER fund machine-service payments. */
  allowTradingCapitalForServices: z.literal(false),
}).strict().superRefine((mandate, ctx) => {
  if (BigInt(mandate.perRequestLimitAtomic) > BigInt(mandate.dailyServiceBudgetAtomic) && BigInt(mandate.dailyServiceBudgetAtomic) > 0n) {
    ctx.addIssue({
      code: "custom",
      message: "Per-request limit cannot exceed daily service budget.",
      path: ["perRequestLimitAtomic"],
    });
  }
});

export type EconomicMandate = z.infer<typeof EconomicMandateSchema>;

export const OPTRA_VOLATILITY_PROVIDER_ID = "optra-volatility-oracle";

export const DEFAULT_ECONOMIC_MANDATE: EconomicMandate = {
  enabled: false,
  settlementAsset: "USDG",
  dailyServiceBudgetAtomic: parseUsdgToAtomic("1.00"),
  perRequestLimitAtomic: parseUsdgToAtomic("0.10"),
  approvedProviders: [OPTRA_VOLATILITY_PROVIDER_ID],
  approvedServiceCategories: ["VOLATILITY_DATA", "MARKET_DATA"],
  requireKnownProvider: true,
  maxRequestsPerHour: 30,
  onBudgetExhausted: "CONTINUE_CACHED_ONLY",
  onUnknownProvider: "DENY",
  budgetReset: "UTC_DAILY",
  allowTradingCapitalForServices: false,
};

export const DEFAULT_HOUSE_ECONOMIC_MANDATE: EconomicMandate = {
  enabled: true,
  settlementAsset: "USDG",
  dailyServiceBudgetAtomic: parseUsdgToAtomic("1.00"),
  perRequestLimitAtomic: parseUsdgToAtomic("0.10"),
  approvedProviders: [OPTRA_VOLATILITY_PROVIDER_ID],
  approvedServiceCategories: ["VOLATILITY_DATA", "MARKET_DATA"],
  requireKnownProvider: true,
  maxRequestsPerHour: 30,
  onBudgetExhausted: "CONTINUE_CACHED_ONLY",
  onUnknownProvider: "DENY",
  budgetReset: "UTC_DAILY",
  allowTradingCapitalForServices: false,
};

export function canonicalEconomicMandateHash(mandate: EconomicMandate): string {
  const normalized = {
    enabled: mandate.enabled,
    settlementAsset: mandate.settlementAsset,
    dailyServiceBudgetAtomic: mandate.dailyServiceBudgetAtomic,
    perRequestLimitAtomic: mandate.perRequestLimitAtomic,
    approvedProviders: [...mandate.approvedProviders].sort(),
    approvedServiceCategories: [...mandate.approvedServiceCategories].sort(),
    requireKnownProvider: mandate.requireKnownProvider,
    maxRequestsPerHour: mandate.maxRequestsPerHour,
    onBudgetExhausted: mandate.onBudgetExhausted,
    onUnknownProvider: mandate.onUnknownProvider,
    budgetReset: mandate.budgetReset,
    allowTradingCapitalForServices: mandate.allowTradingCapitalForServices,
  };
  const digest = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return `sha256:${digest}`;
}

export const ServiceProviderStatusSchema = z.enum(["ACTIVE", "DEGRADED", "DISABLED"]);
export type ServiceProviderStatus = z.infer<typeof ServiceProviderStatusSchema>;

export const ServiceProviderTrustTierSchema = z.enum(["OPTRA_VERIFIED", "USER_APPROVED", "EXPERIMENTAL"]);
export type ServiceProviderTrustTier = z.infer<typeof ServiceProviderTrustTierSchema>;

export const ServiceProviderOwnershipSchema = z.enum(["OPTRA_OWNED", "EXTERNAL"]);
export type ServiceProviderOwnership = z.infer<typeof ServiceProviderOwnershipSchema>;

export const ServiceProviderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  endpoint: z.string().min(1),
  serviceCategory: ServiceCategorySchema,
  paymentProtocol: z.literal("X402"),
  acceptedAssets: z.array(z.string().min(1)).min(1),
  network: z.string().min(1),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  status: ServiceProviderStatusSchema,
  trustTier: ServiceProviderTrustTierSchema,
  ownership: ServiceProviderOwnershipSchema,
  expectedResponseSchema: z.string().optional(),
  maxKnownPriceAtomic: AtomicStringSchema.optional(),
  healthCheckUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type ServiceProvider = z.infer<typeof ServiceProviderSchema>;

export const PaymentModeSchema = z.enum(["EXACT", "BOUNDED", "BATCH"]);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

export const SettlementModeSchema = z.enum(["PAPER_REHEARSAL", "ONCHAIN_SETTLED"]);
export type SettlementMode = z.infer<typeof SettlementModeSchema>;

export const MachineServiceRequestSchema = z.object({
  decisionId: z.string().min(1).max(256),
  agentId: z.string().min(1),
  category: ServiceCategorySchema,
  providerId: z.string().min(1).optional(),
  purpose: z.string().min(1).max(240),
  underlyingSymbol: z.string().min(1).max(16),
  maxPriceAtomic: AtomicStringSchema,
  quotedPriceAtomic: AtomicStringSchema.optional(),
  asset: z.literal("USDG").default("USDG"),
  expectedSchema: z.string().optional(),
  criticality: z.enum(["CRITICAL", "OPTIONAL"]),
  requestNonce: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(128),
  createdAt: IsoDateTimeSchema,
}).strict();
export type MachineServiceRequest = z.infer<typeof MachineServiceRequestSchema>;

export const EconomicAuthorizationReasonCodeSchema = z.enum([
  "ALLOWED",
  "AGENT_PAUSED",
  "MACHINE_SPENDING_DISABLED",
  "PROVIDER_NOT_APPROVED",
  "CATEGORY_NOT_APPROVED",
  "PER_REQUEST_LIMIT_EXCEEDED",
  "DAILY_BUDGET_EXCEEDED",
  "RATE_LIMIT_EXCEEDED",
  "ASSET_NOT_SUPPORTED",
  "GLOBAL_KILL_SWITCH",
  "INVALID_REQUEST",
]);
export type EconomicAuthorizationReasonCode = z.infer<typeof EconomicAuthorizationReasonCodeSchema>;

export type EconomicAuthorizationDecision = {
  allowed: boolean;
  reasonCode: EconomicAuthorizationReasonCode;
  reason: string;
  remainingDailyBudgetAtomic: string;
  remainingServiceBalanceAtomic: string;
};

export type SpendState = {
  serviceBalanceAtomic: string;
  spentTodayAtomic: string;
  spendDayUtc: string;
  requestsThisHour: number;
  hourWindowStart: string;
  machineSpendingStatus: "ACTIVE" | "PAUSED" | "EXHAUSTED";
};

export type EconomicGlobalControls = {
  pauseAllAutonomousAgents: boolean;
  pauseNewEntries: boolean;
  pauseMachineServiceSpending: boolean;
  disableX402Globally: boolean;
  emergencyDenyAllMachinePayments: boolean;
  disabledProviders: string[];
  disabledCategories: ServiceCategory[];
};

export const DEFAULT_GLOBAL_CONTROLS: EconomicGlobalControls = {
  pauseAllAutonomousAgents: false,
  pauseNewEntries: false,
  pauseMachineServiceSpending: false,
  disableX402Globally: false,
  emergencyDenyAllMachinePayments: false,
  disabledProviders: [],
  disabledCategories: [],
};

export const X402TapeEventTypeSchema = z.enum([
  "RESOURCE_REQUIRED",
  "SERVICE_DISCOVERED",
  "SERVICE_QUOTED",
  "X402_PAYMENT_REQUESTED",
  "X402_PAYMENT_AUTHORIZED",
  "X402_PAYMENT_DENIED",
  "X402_PAYMENT_SETTLED",
  "RESOURCE_RECEIVED",
  "RESOURCE_VALIDATED",
  "RESOURCE_REJECTED",
  "SERVICE_BUDGET_LOW",
  "SERVICE_BUDGET_EXHAUSTED",
  "STRATEGY_EVALUATED",
]);
export type X402TapeEventType = z.infer<typeof X402TapeEventTypeSchema>;

export type X402TapeEventRecord = {
  id: string;
  decisionId: string;
  agentId: string;
  eventType: X402TapeEventType;
  providerId: string | null;
  serviceCategory: string | null;
  amountAtomic: string | null;
  asset: string | null;
  requestHash: string | null;
  responseHash: string | null;
  paymentReference: string | null;
  txHash: string | null;
  economicMandateHash: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type X402PaymentRecordView = {
  id: string;
  decisionId: string;
  agentId: string;
  providerId: string;
  serviceCategory: string;
  requestNonce: string;
  requestHash: string;
  idempotencyKey: string;
  amountAtomic: string;
  asset: string;
  network: string;
  paymentMode: PaymentMode;
  settlementMode: SettlementMode;
  status: "REQUESTED" | "AUTHORIZED" | "DENIED" | "SETTLED" | "FAILED" | "RECONCILED";
  reasonCode: string;
  paymentReference: string | null;
  settlementReference: string | null;
  txHash: string | null;
  responseHash: string | null;
  validationStatus: "PENDING" | "VALIDATED" | "REJECTED";
  validationReason: string | null;
  economicMandateHash: string;
  createdAt: string;
};
