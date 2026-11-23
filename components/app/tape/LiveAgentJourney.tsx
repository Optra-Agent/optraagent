import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";

export type JourneyInput = {
  liveTradingEnabled: boolean;
  control: { stopped: boolean };
  /** `accountUsable` false means CallPut's factory would refuse an open for this owner's Account today. */
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
  const armed = active.length > 0 && input.liveTradingEnabled && !input.control.stopped;

  const authorize: Step = active.length > 0
    ? { title: "Authorize scoped session", state: "done", detail: "A scoped grant is active with all evidence recorded." }
    : input.accountUsable === false
      ? { title: "Authorize scoped session", state: "blocked", detail: "CallPut's account factory would refuse an open for your Account today, so a session cannot be used yet." }
      : pending
        ? { title: "Authorize scoped session", state: "next", detail: `${pending.missingEvidence.length} evidence items are still missing. The on-chain session is signed by you with CallPut's Account flow; OPTRA never holds your wallet key.` }
        : { title: "Authorize scoped session", state: "waiting", detail: "Propose a grant first. Then you sign the scoped session yourself with CallPut's Account flow." };

  const activate: Step = armed
    ? { title: "Activate when eligible", state: "done", detail: "The operator switch is on, a grant is active and the agent is running." }
    : { title: "Activate when eligible", state: "waiting", detail: input.liveTradingEnabled ? "The operator switch is on. The agent still needs an active grant and all seven live gates." : "The operator switch is off, and the agent also needs an active grant and all seven live gates. Your agents keep running on paper." };

  return [
    hasGrant ? { title: "Choose agent", state: "done", detail: `Grant covers ${grants[0]!.agentId}.` } : { title: "Choose agent", state: "next", detail: "Pick the Paper agent in the form below." },
    hasGrant ? { title: "Configure risk", state: "done", detail: "Collateral, order and expiry limits are recorded on the grant." } : { title: "Configure risk", state: "waiting", detail: "Set per-order, open and daily collateral. The engine's hard caps always apply." },
    hasGrant ? { title: "Review permissions", state: "done", detail: "Opens only, one underlying and one structure. Closing and settling stay with your wallet." } : { title: "Review permissions", state: "waiting", detail: "You review the exact scope before proposing: opens only, one underlying, one structure, revocable at any time." },
    authorize,
    activate,
    { title: "Monitor", state: input.requests.length > 0 ? "done" : "waiting", detail: input.requests.length > 0 ? `${input.requests.length} agent request${input.requests.length === 1 ? "" : "s"} recorded below.` : "No agent order has been requested. Requests and their on-chain state appear here." },
    { title: "Emergency stop", state: "done", detail: input.control.stopped ? "The agent is stopped and cannot place orders." : "Available at any time. It stops new orders immediately." },
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
