import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { HouseAgentTemplate } from "../../../lib/domain/contracts";
import { Chip } from "../ui";

export const templateSummaries: Record<HouseAgentTemplate["id"], string> = {
  protective_put: "Buys a put about 7% out of the money, 30 calendar days out, when realized volatility is calm. The premium is the cost of insurance and is lost if the stock does not fall.",
  covered_call: "Sells a call against shares you hold to collect premium.",
  cash_secured_put: "Sells a put backed by cash to collect premium or buy lower.",
  earnings_straddle: "Buys a call and a put around a reported earnings date.",
};

/** One House Agent template. Rendered by the Agents screen and, read-only, by the landing-page preview. */
export function TemplateCard({ template, interactive = true, compact = false, headingAs: Heading = "h3", href = "#configure", children }: { template: HouseAgentTemplate; interactive?: boolean; compact?: boolean; headingAs?: "h3" | "p"; href?: string; children?: ReactNode }) {
  const ready = template.availability === "paper_ready";
  return (
    <Card className={`template-card${ready ? " template-card-featured" : ""}`}>
      <div className="template-card-head">
        <Heading className="template-name">{template.name}</Heading>
        <Chip tone={ready ? "azure" : "neutral"}>{ready ? "Paper ready" : "Preview"}</Chip>
      </div>
      {compact ? null : <p className="template-summary">{templateSummaries[template.id]}</p>}
      {compact ? null : <p className="template-reason">{template.reason}</p>}
      {ready
        ? interactive
          ? <a className="template-link" href={href}>{href === "#configure" ? "Configure this agent below" : "Configure this agent"}</a>
          : <span className="template-link">Configure this agent below</span>
        : <p className="template-unavailable">{compact ? "Not yet available" : "Not yet available. It cannot be created until its venue and data requirements are verified."}</p>}
      {children}
    </Card>
  );
}
