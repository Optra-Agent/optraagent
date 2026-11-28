import { describe, expect, it } from "vitest";
import { parseUsdgToAtomic } from "../../lib/economics/atomic";
import { evaluateEconomicPolicy } from "../../lib/economics/policy-engine";
import { resolveDefaultProvider } from "../../lib/economics/provider-registry";
import {
  DEFAULT_GLOBAL_CONTROLS,
  DEFAULT_HOUSE_ECONOMIC_MANDATE,
  OPTRA_VOLATILITY_PROVIDER_ID,
} from "../../lib/economics/types";
import type { MachineServiceRequest, SpendState } from "../../lib/economics/types";

function makeRequest(overrides?: Partial<MachineServiceRequest>): MachineServiceRequest {
  return {
    decisionId: "agent-1:tick-1",
    agentId: "agent-1",
    category: "VOLATILITY_DATA",
    providerId: OPTRA_VOLATILITY_PROVIDER_ID,
    purpose: "Fetch NVDA volatility regime",
    underlyingSymbol: "NVDA",
    maxPriceAtomic: parseUsdgToAtomic("0.05"),
    quotedPriceAtomic: parseUsdgToAtomic("0.02"),
    asset: "USDG",
    criticality: "OPTIONAL",
    requestNonce: "nonce-1",
    idempotencyKey: "idemp-1",
    createdAt: "2026-11-28T10:00:00.000Z",
    ...overrides,
  };
}

function makeSpendState(overrides?: Partial<SpendState>): SpendState {
  return {
    serviceBalanceAtomic: parseUsdgToAtomic("2.00"),
    spentTodayAtomic: "0",
    spendDayUtc: "2026-11-28",
    requestsThisHour: 0,
    hourWindowStart: "2026-11-28T10:00:00.000Z",
    machineSpendingStatus: "ACTIVE",
    ...overrides,
  };
}

describe("EconomicPolicyEngine", () => {
  const provider = resolveDefaultProvider(OPTRA_VOLATILITY_PROVIDER_ID)!;

  it("authorizes valid approved request deterministically", () => {
    const input = {
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest(),
      spendState: makeSpendState(),
      agentStatus: "running" as const,
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
      now: new Date("2026-11-28T10:05:00.000Z"),
    };
    const first = evaluateEconomicPolicy(input);
    const second = evaluateEconomicPolicy(input);
    expect(first).toEqual(second);
    expect(first.allowed).toBe(true);
    expect(first.reasonCode).toBe("ALLOWED");
  });

  it("denies GLOBAL_KILL_SWITCH when Risk Desk disables x402", () => {
    const res = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest(),
      spendState: makeSpendState(),
      agentStatus: "running",
      provider,
      globalControls: { ...DEFAULT_GLOBAL_CONTROLS, disableX402Globally: true },
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("GLOBAL_KILL_SWITCH");
  });

  it("denies AGENT_PAUSED when agent or machine spending is paused", () => {
    const res = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest(),
      spendState: makeSpendState(),
      agentStatus: "paused",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("AGENT_PAUSED");
  });

  it("denies MACHINE_SPENDING_DISABLED when mandate is disabled", () => {
    const res = evaluateEconomicPolicy({
      mandate: { ...DEFAULT_HOUSE_ECONOMIC_MANDATE, enabled: false },
      request: makeRequest(),
      spendState: makeSpendState(),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("MACHINE_SPENDING_DISABLED");
  });

  it("denies PROVIDER_NOT_APPROVED for unknown provider", () => {
    const res = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest({ providerId: "unknown-external-api" }),
      spendState: makeSpendState(),
      agentStatus: "running",
      provider: null,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("PROVIDER_NOT_APPROVED");
  });

  it("denies CATEGORY_NOT_APPROVED for unapproved category", () => {
    const res = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest({ category: "COMPUTE" }),
      spendState: makeSpendState(),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("CATEGORY_NOT_APPROVED");
  });

  it("denies PER_REQUEST_LIMIT_EXCEEDED when quote exceeds per-request cap", () => {
    const res = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest({ quotedPriceAtomic: parseUsdgToAtomic("0.25") }),
      spendState: makeSpendState(),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("PER_REQUEST_LIMIT_EXCEEDED");
  });

  it("denies DAILY_BUDGET_EXCEEDED when daily budget or isolated service balance is insufficient", () => {
    const overDaily = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest({ quotedPriceAtomic: parseUsdgToAtomic("0.05") }),
      spendState: makeSpendState({ spentTodayAtomic: parseUsdgToAtomic("0.98") }),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(overDaily.allowed).toBe(false);
    expect(overDaily.reasonCode).toBe("DAILY_BUDGET_EXCEEDED");

    const emptyServiceBalance = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest({ quotedPriceAtomic: parseUsdgToAtomic("0.02") }),
      spendState: makeSpendState({ serviceBalanceAtomic: "0" }),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(emptyServiceBalance.allowed).toBe(false);
    expect(emptyServiceBalance.reasonCode).toBe("DAILY_BUDGET_EXCEEDED");
  });

  it("denies RATE_LIMIT_EXCEEDED when hourly limit is reached", () => {
    const res = evaluateEconomicPolicy({
      mandate: { ...DEFAULT_HOUSE_ECONOMIC_MANDATE, maxRequestsPerHour: 5 },
      request: makeRequest(),
      spendState: makeSpendState({ requestsThisHour: 5 }),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("resets daily spend on new UTC day", () => {
    const res = evaluateEconomicPolicy({
      mandate: DEFAULT_HOUSE_ECONOMIC_MANDATE,
      request: makeRequest({ createdAt: "2026-11-29T00:05:00.000Z" }),
      spendState: makeSpendState({ spentTodayAtomic: parseUsdgToAtomic("1.00"), spendDayUtc: "2026-11-28" }),
      agentStatus: "running",
      provider,
      globalControls: DEFAULT_GLOBAL_CONTROLS,
      now: new Date("2026-11-29T00:05:00.000Z"),
    });
    expect(res.allowed).toBe(true);
    expect(res.remainingDailyBudgetAtomic).toBe(parseUsdgToAtomic("1.00"));
  });
});
