import Link from "next/link";
import type { ReactNode } from "react";
import type { AgentDecision, HookResult, HookStage } from "../../lib/domain/contracts";

export type Tone = "neutral" | "azure" | "ember" | "gain" | "loss";

/** A status label. The dot is part of the status vocabulary, never decoration; text always carries the meaning. */
export function Chip({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`chip chip-${tone} ${className}`.trim()}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-heading-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => <span key={index} style={{ width: `${92 - index * 17}%` }} />)}
    </div>
  );
}

type StateKind = "loading" | "error" | "empty" | "info" | "blocked";

/** One shape for every non-happy path: loading, error, empty, blocked and informational states. */
export function StateBlock({ kind, title, children, action, className = "" }: { kind: StateKind; title?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const role = kind === "error" ? "alert" : kind === "loading" ? "status" : undefined;
  return (
    <section className={`state-panel state-${kind} ${className}`.trim()} role={role}>
      {kind === "loading" ? <Skeleton lines={2} /> : null}
      {title ? <h2>{title}</h2> : null}
      {children ? <div className="state-body">{children}</div> : null}
      {action ? <div className="state-action">{action}</div> : null}
    </section>
  );
}

const journey = [
  { label: "Connect wallet", href: null },
  { label: "Choose and configure", href: "/agents#configure" },
  { label: "Backtest", href: "/lab" },
  { label: "Launch paper", href: "/lab" },
  { label: "Run paper tick", href: "/agents" },
  { label: "Inspect Tape", href: "/tape" },
] as const;

/** The supported Protective Put path. `step` is 1-based: earlier steps read as done, later steps as upcoming. */
export function JourneyRail({ step }: { step: 1 | 2 | 3 | 4 | 5 | 6 }) {
  return (
    <nav className="journey" aria-label="Paper trading journey">
      <ol>
        {journey.map((item, index) => {
          const number = index + 1;
          const state = number < step ? "done" : number === step ? "current" : "next";
          const content = (
            <>
              <span className="journey-index">{number}</span>
              <span className="journey-label">{item.label}</span>
            </>
          );
          return (
            <li key={item.label} className={`journey-step journey-${state}`} aria-current={state === "current" ? "step" : undefined}>
              {item.href && state !== "current" ? <Link href={item.href}>{content}</Link> : <span className="journey-static">{content}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const stageOrder: HookStage[] = ["gate", "strike", "size", "pulse", "expiry", "breaker"];

function resultMeta(result: HookResult): string {
  const parts: string[] = [];
  if (result.observedValue) parts.push(`observed ${result.observedValue}`);
  else if (result.value !== undefined) parts.push(`value ${result.value}${result.unit ? ` ${result.unit}` : ""}`);
  if (result.threshold !== undefined) parts.push(`limit ${result.threshold}${result.unit && result.value === undefined ? ` ${result.unit}` : ""}`);
  return parts.join(" · ");
}

/** The Optra Tape trace: every hook result in stage order, with the data it used. */
export function DecisionTrace({ decision }: { decision: AgentDecision }) {
  const results = decision.hookResults;
  if (results.length === 0) return null;
  const ranked = [...results].sort((a, b) => {
    const left = a.stage ? stageOrder.indexOf(a.stage) : stageOrder.length;
    const right = b.stage ? stageOrder.indexOf(b.stage) : stageOrder.length;
    return left - right;
  });
  return (
    <details className="trace">
      <summary>Decision trace ({results.length})</summary>
      <ol className="trace-list">
        {ranked.map((result, index) => {
          const meta = resultMeta(result);
          return (
            <li key={`${result.hookId}:${index}`} className={`trace-row trace-${result.status}`}>
              <span className="trace-stage">{result.stage ?? "system"}</span>
              <span className="trace-hook">{result.hookId}</span>
              <span className="trace-status">{result.status}</span>
              {result.reason}
              {meta ? <span className="trace-meta">{meta}</span> : null}
              {result.dataRefs?.length ? <span className="trace-meta">refs {result.dataRefs.join(", ")}</span> : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export function actionTone(action: AgentDecision["action"]): Tone {
  if (action === "open") return "azure";
  if (action === "close") return "ember";
  return "neutral";
}
