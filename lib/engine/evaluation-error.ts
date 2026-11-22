import { AgentDecisionSchema } from "../domain/contracts";
import type { AgentDecision } from "../domain/contracts";
import { recordHook } from "./common";

/**
 * The Tape entry for a scheduled evaluation that could not run because its input data failed an integrity check.
 *
 * It is a real outcome, not a decision to trade: the action is `skip`, no order is created and no position or account
 * changes. The `system.market_data` hook has status `error`, which the Tape shows as an ERROR outcome. It is recorded
 * only for a candle that is inside the regular session and fresh enough to evaluate, never for a stale candle.
 */
export function evaluationErrorDecision(input: {
  agentId: string;
  tickId: string;
  occurredAt: string;
  recipeHash: string;
  problem: string;
  source: string;
  dataRefs: string[];
}): AgentDecision {
  const reason = `Evaluation could not run: ${input.problem} No order was created and no paper position or account changed.`;
  return AgentDecisionSchema.parse({
    id: `${input.agentId}:${input.tickId}`,
    agentId: input.agentId,
    tickId: input.tickId,
    action: "skip",
    reason,
    hookResults: [recordHook("system.market_data", undefined, "error", input.problem, { dataRefs: input.dataRefs })],
    snapshotSource: input.source,
    recipeHash: input.recipeHash,
    createdAt: input.occurredAt,
  });
}
