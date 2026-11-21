import { ArrowRight, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { HouseAgentTemplate } from "../../../lib/domain/contracts";
import { Chip } from "../ui";
import { payoffPath, templateFacts, templateSummaries } from "./house-meta";

export { templateSummaries };

export function PayoffMark({ id, ready, size = "md" }: { id: string; ready: boolean; size?: "sm" | "md" }) {
  return (
    <svg className={`payoff-mark payoff-${size}`} data-ready={ready ? "1" : "0"} viewBox="0 0 48 42" aria-hidden="true">
      <path className="payoff-axis" d="M4 30 H44" />
      <path className="payoff-line" d={payoffPath[id as keyof typeof payoffPath] ?? payoffPath.protective_put} />
    </svg>
  );
}

/** One House Agent template. Rendered by the Agents screen and, read-only, by the landing-page preview. */
export function TemplateCard({ template, interactive = true, compact = false, headingAs: Heading = "h3", href = "#configure", children }: { template: HouseAgentTemplate; interactive?: boolean; compact?: boolean; headingAs?: "h3" | "p"; href?: string; children?: ReactNode }) {
  const ready = template.availability === "paper_ready";
  return (
    <Card className={`template-card${ready ? " template-card-featured" : ""}${compact ? " template-card-compact" : ""}`}>
      <div className="template-card-head">
        <PayoffMark id={template.id} ready={ready} size={ready && !compact ? "md" : "sm"} />
        <Heading className="template-name">{template.name}</Heading>
        <Chip tone={ready ? "azure" : "neutral"}>{ready ? "Paper ready" : "Preview"}</Chip>
      </div>
      {compact ? null : <p className="template-summary">{templateSummaries[template.id]}</p>}
      {ready && !compact ? (
        <dl className="template-facts">
          {templateFacts(template.id).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd className="mono">{fact.value}</dd></div>)}
        </dl>
      ) : null}
      {compact ? null : (
        <details className="template-why">
          <summary>{ready ? "How premiums are modeled" : "Why this is a strategy overview"}</summary>
          <p>{template.reason}</p>
        </details>
      )}
      {ready
        ? interactive
          ? <a className="template-cta" href={href}>{href === "#configure" ? "Configure this agent below" : "Configure this agent"}<ArrowRight aria-hidden /></a>
          : <span className="template-cta">Configure this agent below<ArrowRight aria-hidden /></span>
        : <p className="template-unavailable"><Lock aria-hidden />Strategy overview. Paper launch is not enabled.</p>}
      {children}
    </Card>
  );
}
