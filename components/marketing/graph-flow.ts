import type { AgentDecision } from "../../lib/domain/contracts";

/* Pure decision-flow types and helpers. Safe to import from client components: no catalog, no zod. */

export type Verdict = "pass" | "block" | "select" | "size" | "noop" | "action";

export type FlowStep = "gate" | "strike" | "size" | "pulse" | "expiry" | "breaker" | "decision" | "tape";
export const FLOW_STEPS: FlowStep[] = ["gate", "strike", "size", "pulse", "expiry", "breaker", "decision", "tape"];

export type FlowScenario = {
  id: string;
  label: string;
  /** "illustrative" scenarios are built in; "recorded" ones come from a real public Tape record. */
  source: "illustrative" | "recorded";
  /** Verdict per hook id, as the engine would record it. */
  verdicts: Record<string, { status: Verdict; reason: string; /** Canonical HookResult.status, kept when the scenario comes from a recorded decision. */ raw?: string }>;
  action: AgentDecision["action"];
  reason: string;
};

/** Turns a recorded Tape decision into a scenario, so the graph can replay a real record when the public Tape has one. */
export function scenarioFromDecision(decision: AgentDecision): FlowScenario {
  const verdicts: FlowScenario["verdicts"] = {};
  for (const result of decision.hookResults) {
    const status: Verdict = result.status === "fail" || result.status === "error" ? "block" : result.status === "skip" ? "noop" : result.status;
    verdicts[result.hookId] = { status, reason: result.reason, raw: result.status };
  }
  return { id: `tape-${decision.id}`, label: "Public Tape record", source: "recorded", verdicts, action: decision.action, reason: decision.reason };
}

export const STEP_LABEL: Record<FlowStep, string> = {
  gate: "Gate: may the agent enter?",
  strike: "Strike: which put?",
  size: "Size: how many units?",
  pulse: "Pulse: manage an open position",
  expiry: "Expiry: close before expiry",
  breaker: "Breaker: risk check",
  decision: "Paper decision",
  tape: "Optra Tape",
};
