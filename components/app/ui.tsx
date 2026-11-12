import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton as SkeletonBar } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AgentDecision, HookResult, HookStage } from "../../lib/domain/contracts";

export type Tone = "neutral" | "azure" | "ember" | "gain" | "loss";

const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-transparent text-muted-foreground",
  azure: "border-[var(--azure-line)] bg-[var(--azure-wash)] text-[var(--azure-hover)]",
  ember: "border-[var(--ember-line)] bg-[var(--ember-wash)] text-[var(--ember-text)]",
  gain: "border-[rgb(43_212_125/0.4)] text-[var(--gain)]",
  loss: "border-[rgb(255_93_115/0.4)] text-[var(--loss)]",
};

/** A status label (shadcn Badge). Text always carries the meaning; color only reinforces it. */
export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <Badge variant="outline" className={cn("rounded-sm px-2 py-px text-xs font-medium", toneClass[tone], className)}>{children}</Badge>;
}

/** The one surface for grouped content (shadcn Card). */
export function Panel({ className, children, ...props }: ComponentProps<"div">) {
  const region = props["aria-label"] ? { role: "region" as const } : {};
  return <Card className={cn("panel block gap-0 py-0 shadow-none", className)} {...region} {...props}>{children}</Card>;
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
    <div className="grid gap-2.5" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => <SkeletonBar key={index} className="h-3" style={{ width: `${92 - index * 17}%` }} />)}
    </div>
  );
}

type StateKind = "loading" | "error" | "empty" | "info" | "blocked";

/** One shape for every non-happy path: loading, error, empty, blocked and informational states. */
export function StateBlock({ kind, title, children, action, className = "" }: { kind: StateKind; title?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  if (kind === "error" || kind === "blocked") {
    return (
      <Alert variant="destructive" role={kind === "error" ? "alert" : "status"} className={cn("mb-5 border-[var(--ember-line)] bg-[var(--ember-wash)] px-5 py-4", className)}>
        {title ? <AlertTitle className="font-display text-lg">{title}</AlertTitle> : null}
        {children ? <AlertDescription className="text-muted-foreground [&_p]:mb-2">{children}</AlertDescription> : null}
        {action ? <div className="col-start-2 mt-3 flex flex-wrap gap-2">{action}</div> : null}
      </Alert>
    );
  }
  return (
    <Panel className={cn(kind === "empty" && "border-dashed", className)} role={kind === "loading" ? "status" : undefined}>
      {kind === "loading" ? <Skeleton lines={2} /> : null}
      {title ? <h2 className="mb-2">{title}</h2> : null}
      {children ? <div className="grid gap-2 text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
    </Panel>
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

/** The supported Protective Put path. `step` is 1-based: earlier steps read as done, later steps as upcoming.
 *  `interactive={false}` renders the same markup without links, for the read-only landing preview. */
export function JourneyRail({ step, interactive = true }: { step: 1 | 2 | 3 | 4 | 5 | 6; interactive?: boolean }) {
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
              {interactive && item.href && state !== "current" ? <Link href={item.href}>{content}</Link> : <span className="journey-static">{content}</span>}
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
