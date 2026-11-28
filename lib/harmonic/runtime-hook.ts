import { hashCanonical } from "./crypto";
import { HarmonicService } from "./service";

export async function runHarmonicPreActionHook(input: {
  agentId: string;
  decisionId: string;
  underlying: string;
  strategy: string;
  action: string;
  recipeHash: string;
  runtimeVersion?: string;
}) {
  const service = new HarmonicService();
  const direction = input.action.includes("PUT") || input.action.includes("CLOSE") ? "down" : "up";
  return service.filePreActionExpectation({
    agentId: input.agentId,
    decisionId: input.decisionId,
    underlying: input.underlying,
    strategy: input.strategy,
    action: input.action,
    direction,
    horizon: "1d",
    expectedCondition: `${input.strategy} ${input.action} on ${input.underlying}`,
    recipeHash: input.recipeHash,
    strategyMandateHash: hashCanonical({ strategy: input.strategy, underlying: input.underlying }),
    riskMandateHash: hashCanonical({ allowNakedShortOptions: false }),
    economicMandateHash: hashCanonical({ allowTradingCapitalForServices: false }),
    runtimeVersion: input.runtimeVersion ?? "optra.runtime.v3",
  });
}

export async function runHarmonicPostActionGradeHook(input: {
  agentId: string;
  decisionId: string;
  ruleCompliance: "PASS" | "FAIL" | "UNKNOWN";
  pnl?: string | null;
  evidenceRefs?: string[];
}) {
  const service = new HarmonicService();
  return service.recordOutcomeAndGrade({
    agentId: input.agentId,
    decisionId: input.decisionId,
    ruleCompliance: input.ruleCompliance,
    expectationOutcome: "PENDING",
    pnl: input.pnl ?? null,
    evidenceRefs: input.evidenceRefs ?? [],
  });
}

