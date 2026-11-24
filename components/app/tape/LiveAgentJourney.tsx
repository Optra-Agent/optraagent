import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import type { GateReport } from "@/lib/live/gates";

export type JourneyInput = {
  liveTradingEnabled: boolean;
  /** The authenticated report for the same scheduled-execution context used by the worker. */
  gateReport?: GateReport | null;
  submissionRoute: string;
  control: { stopped: boolean; reason?: string | null };
  /** The owner's Account status from the statically configured factory getters, or null when unavailable. */
  account?: { address: string; created: boolean; registered: boolean } | null;
  /** True only when the configured canOpen result and current venue enforcement are independently verified. */
  accountUsable: boolean | null;
  grants: Array<{ agentId: string; status: "proposed" | "active" | "revoked"; missingEvidence: string[] }>;
  requests: Array<{ state: string }>;
};

type StepState = "done" | "next" | "blocked" | "waiting";
type Step = { title: string; state: StepState; detail: string };

const STATE_LABEL: Record<StepState, string> = { done: "Done", next: "Next", blocked: "Blocked", waiting: "Waiting" };

/** The owner's path through the Live Agent, computed only from facts the server already returned. It arms nothing. */
export function liveAgentJourney(input: JourneyInput): Step[] {
  const grants = input.grants.filter((grant) => grant.status !== "revoked");
  const active = grants.filter((grant) => grant.status === "active");
  const pending = grants.find((grant) => grant.status === "proposed");
  const hasGrant = grants.length > 0;
  const custodyGate = input.gateReport?.gates.find((gate) => gate.id === "G2") ?? null;
  const armed = active.length > 0 && input.liveTradingEnabled && !input.control.stopped
    && input.gateReport?.allPass === true && input.submissionRoute !== "not-configured";

  const account = input.account ?? null;
  const accountSentence = account === null
    ? "Your CallPut Account could not be read right now."
    : !account.created
      ? `The configured factory reports Account ${account.address} is not created. Confirm CallPut's current create/fund/register workflow before any wallet action.`
      : !account.registered
        ? `The configured factory reports Account ${account.address} is not registered. Confirm CallPut's current registration workflow before any wallet action.`
        : `The configured factory reports Account ${account.address} is created and registered.`;

  const authorize: Step = active.length > 0
    ? custodyGate?.pass === true
      ? { title: "Authorize scoped session", state: "done", detail: "The current G2 report verifies the active scoped grant and its Account evidence." }
      : { title: "Authorize scoped session", state: "blocked", detail: custodyGate
        ? `${custodyGate.detail}${custodyGate.remediation ? ` ${custodyGate.remediation}` : ""}`
        : "The authenticated G1–G7 execution report is unavailable; an active database grant alone is not verified authorization." }
    : input.accountUsable === false
      ? { title: "Authorize scoped session", state: "blocked", detail: "The configured Account getter does not establish OPTRA authorization: resolver match, contract source and per-open enforcement are not verified. Confirm the current state and required action with CallPut before signing." }
      : pending
        ? { title: "Authorize scoped session", state: "next", detail: `${pending.missingEvidence.length} evidence items are still missing. ${accountSentence} The session is signed by you in CallPut's Account flow; OPTRA never holds your wallet key.` }
        : { title: "Authorize scoped session", state: "waiting", detail: `Propose a grant first. ${accountSentence} Then you sign the scoped session yourself in CallPut's Account flow.` };

  const activate: Step = armed
    ? { title: "Activate when eligible", state: "done", detail: "The current G1–G7 report passes, a scoped grant is active, the operator switch is on and a submission route is configured. This does not prove an order executed or filled." }
    : { title: "Activate when eligible", state: "waiting", detail: input.liveTradingEnabled && active.length > 0 && !input.control.stopped
      ? "An active grant and operator switch are not enough. A current all-pass G1–G7 report and configured submission route are still required."
      : input.liveTradingEnabled
        ? "The operator switch is on. The agent still needs an active grant, all seven live gates and a configured submission route."
        : "The operator switch is off, and the agent also needs an active grant, all seven live gates and a configured submission route. Your agents keep running on paper." };

  return [
    hasGrant ? { title: "Choose agent", state: "done", detail: `Grant covers ${grants[0]!.agentId}.` } : { title: "Choose agent", state: "next", detail: "Pick the Paper agent in the form below." },
    hasGrant ? { title: "Configure risk", state: "done", detail: "Collateral, order and expiry limits are recorded on the grant." } : { title: "Configure risk", state: "waiting", detail: "Set per-order, open and daily collateral. The engine's hard caps always apply." },
    hasGrant ? { title: "Review permissions", state: "done", detail: "Opens only, one underlying and one structure. Closing and settling stay with your wallet." } : { title: "Review permissions", state: "waiting", detail: "You review the exact scope before proposing: opens only, one underlying, one structure, revocable at any time." },
    authorize,
    activate,
    { title: "Monitor", state: input.requests.length > 0 ? "done" : "waiting", detail: input.requests.length > 0 ? `${input.requests.length} agent request${input.requests.length === 1 ? "" : "s"} recorded below.` : "No agent order has been requested. Requests and their on-chain state appear here." },
    { title: "Emergency stop", state: "done", detail: input.control.stopped ? `The agent is stopped and cannot place orders${input.control.reason ? `: ${input.control.reason}` : "."}` : "Available at any time. It stops new orders immediately." },
  ];
}

/** The first step the owner cannot yet complete, so the screen can say exactly what is missing. */
export function nextLiveAgentRequirement(steps: Step[]): Step | null {
  return steps.find((step) => step.state === "blocked" || step.state === "next") ?? steps.find((step) => step.state === "waiting") ?? null;
}

export function LiveAgentJourney(props: JourneyInput) {
  const steps = liveAgentJourney(props);
  const next = nextLiveAgentRequirement(steps);
  return (
    <div>
      {next ? <p className="panel-note" role="status"><strong>Next: {next.title}.</strong> {next.detail} <a href="#enable-live">See all seven live gates</a></p> : null}
      <ol className="gate-list" aria-label="Live Agent journey">
        {steps.map((step, index) => (
          <li key={step.title} className="gate-row" data-pass={step.state === "done"}>
            <span className="gate-id" aria-hidden="true">{index + 1}</span>
            <div className="gate-body">
              <div className="gate-head">
                <h3>{step.title}</h3>
                <span className="gate-chip" data-pass={step.state === "done"}>
                  {step.state === "done" ? <CheckCircle2 aria-hidden="true" /> : step.state === "waiting" ? <CircleDashed aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                  {STATE_LABEL[step.state]}
                </span>
              </div>
              <p className="gate-detail">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
