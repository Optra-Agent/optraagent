import { assertAtomicString, cmpAtomic, subAtomic } from "./atomic";
import type {
  EconomicAuthorizationDecision,
  EconomicGlobalControls,
  EconomicMandate,
  MachineServiceRequest,
  ServiceProvider,
  SpendState,
} from "./types";

export type PolicyEvaluationInput = {
  mandate: EconomicMandate;
  request: MachineServiceRequest;
  spendState: SpendState;
  agentStatus: "draft" | "running" | "paused" | "stopped";
  provider: ServiceProvider | null;
  globalControls: EconomicGlobalControls;
  now?: Date;
};

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcHourBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}

/**
 * Deterministic Economic Policy Engine (T2).
 * Identical state + identical request + identical mandate + identical global controls
 * ALWAYS yields the exact same authorization decision without any LLM involvement.
 */
export function evaluateEconomicPolicy(input: PolicyEvaluationInput): EconomicAuthorizationDecision {
  const now = input.now ?? new Date(input.request.createdAt);
  const currentDay = utcDay(now);
  const currentHour = utcHourBucket(now);

  const effectiveSpentToday = input.spendState.spendDayUtc === currentDay ? input.spendState.spentTodayAtomic : "0";
  const effectiveRequestsThisHour =
    input.spendState.hourWindowStart.slice(0, 13) === currentHour ? input.spendState.requestsThisHour : 0;

  const remainingDailyBudgetAtomic =
    cmpAtomic(input.mandate.dailyServiceBudgetAtomic, effectiveSpentToday) >= 0
      ? subAtomic(input.mandate.dailyServiceBudgetAtomic, effectiveSpentToday)
      : "0";
  const remainingServiceBalanceAtomic = input.spendState.serviceBalanceAtomic;

  const deny = (
    reasonCode: EconomicAuthorizationDecision["reasonCode"],
    reason: string,
  ): EconomicAuthorizationDecision => ({
    allowed: false,
    reasonCode,
    reason,
    remainingDailyBudgetAtomic,
    remainingServiceBalanceAtomic,
  });

  // 1. Global Risk Desk kill switches override all agent mandates.
  if (
    input.globalControls.emergencyDenyAllMachinePayments ||
    input.globalControls.pauseAllAutonomousAgents ||
    input.globalControls.pauseMachineServiceSpending ||
    input.globalControls.disableX402Globally
  ) {
    return deny("GLOBAL_KILL_SWITCH", "Global Risk Desk has disabled autonomous machine-service payments.");
  }
  if (input.request.providerId && input.globalControls.disabledProviders.includes(input.request.providerId)) {
    return deny("GLOBAL_KILL_SWITCH", `Provider ${input.request.providerId} is globally disabled by Risk Desk.`);
  }
  if (input.globalControls.disabledCategories.includes(input.request.category)) {
    return deny("GLOBAL_KILL_SWITCH", `Service category ${input.request.category} is globally disabled by Risk Desk.`);
  }

  // 2. Agent lifecycle & machine spending pause checks.
  if (input.agentStatus !== "running" || input.spendState.machineSpendingStatus === "PAUSED") {
    return deny("AGENT_PAUSED", "Agent or its machine-spending status is paused.");
  }

  // 3. Mandate enabled check.
  if (!input.mandate.enabled) {
    return deny("MACHINE_SPENDING_DISABLED", "Machine spending is disabled in this agent's Economic Mandate.");
  }

  // 4. Request validity & trading-capital isolation invariant.
  if (input.mandate.allowTradingCapitalForServices !== false) {
    return deny("INVALID_REQUEST", "Trading capital cannot be authorized for machine services.");
  }
  const effectiveAmount = input.request.quotedPriceAtomic ?? input.request.maxPriceAtomic;
  let parsedAmount: bigint;
  try {
    parsedAmount = assertAtomicString(effectiveAmount, "effectiveAmount");
  } catch {
    return deny("INVALID_REQUEST", "Payment amount must be a valid non-negative integer in atomic units.");
  }
  if (parsedAmount <= 0n || !input.request.decisionId.trim() || !input.request.idempotencyKey.trim()) {
    return deny("INVALID_REQUEST", "Machine service request is missing required amount, decisionId, or idempotencyKey.");
  }

  // 5. Asset support check.
  if (input.request.asset !== input.mandate.settlementAsset) {
    return deny("ASSET_NOT_SUPPORTED", `Asset ${input.request.asset} is not supported; mandate requires ${input.mandate.settlementAsset}.`);
  }

  // 6. Provider allowlist & status check.
  if (!input.provider) {
    return deny("PROVIDER_NOT_APPROVED", "Requested service provider is unknown and denied by default.");
  }
  if (input.provider.status === "DISABLED") {
    return deny("PROVIDER_NOT_APPROVED", `Provider ${input.provider.id} is currently disabled.`);
  }
  if (!input.provider.acceptedAssets.includes(input.mandate.settlementAsset)) {
    return deny("ASSET_NOT_SUPPORTED", `Provider ${input.provider.id} does not accept ${input.mandate.settlementAsset}.`);
  }
  if (input.mandate.requireKnownProvider && !input.mandate.approvedProviders.includes(input.provider.id)) {
    return deny("PROVIDER_NOT_APPROVED", `Provider ${input.provider.id} is not in the agent's approved provider list.`);
  }

  // 7. Category allowlist check.
  if (!input.mandate.approvedServiceCategories.includes(input.request.category)) {
    return deny("CATEGORY_NOT_APPROVED", `Service category ${input.request.category} is not approved in the Economic Mandate.`);
  }

  // 8. Per-request hard cap.
  if (cmpAtomic(effectiveAmount, input.mandate.perRequestLimitAtomic) > 0) {
    return deny(
      "PER_REQUEST_LIMIT_EXCEEDED",
      `Requested amount (${effectiveAmount} atomic) exceeds per-request limit (${input.mandate.perRequestLimitAtomic} atomic).`,
    );
  }

  // 9. Daily hard cap and isolated Service Budget balance check.
  if (cmpAtomic(effectiveAmount, remainingDailyBudgetAtomic) > 0) {
    return deny(
      "DAILY_BUDGET_EXCEEDED",
      `Requested amount (${effectiveAmount} atomic) exceeds remaining daily service budget (${remainingDailyBudgetAtomic} atomic).`,
    );
  }
  if (cmpAtomic(effectiveAmount, remainingServiceBalanceAtomic) > 0) {
    return deny(
      "DAILY_BUDGET_EXCEEDED",
      `Insufficient isolated service budget balance (${remainingServiceBalanceAtomic} atomic); trading capital cannot be used.`,
    );
  }

  // 10. Hourly request rate limit check.
  if (effectiveRequestsThisHour >= input.mandate.maxRequestsPerHour) {
    return deny(
      "RATE_LIMIT_EXCEEDED",
      `Hourly machine-request rate limit (${input.mandate.maxRequestsPerHour}/hr) exceeded.`,
    );
  }

  return {
    allowed: true,
    reasonCode: "ALLOWED",
    reason: "Authorized under deterministic Economic Mandate.",
    remainingDailyBudgetAtomic,
    remainingServiceBalanceAtomic,
  };
}
