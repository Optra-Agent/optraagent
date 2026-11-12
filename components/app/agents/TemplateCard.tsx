import { ArrowRight, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { HouseAgentTemplate } from "../../../lib/domain/contracts";
import { buildProtectivePutRecipe, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../../lib/hooks/catalog";
import { Chip } from "../ui";

export const templateSummaries: Record<HouseAgentTemplate["id"], string> = {
  protective_put: "Buys a put about 7% out of the money, 30 calendar days out, when realized volatility is calm. The premium is the cost of insurance and is lost if the stock does not fall.",
  covered_call: "Sells a call against shares you hold to collect premium.",
  cash_secured_put: "Sells a put backed by cash to collect premium or buy lower.",
  earnings_straddle: "Buys a call and a put around a reported earnings date.",
};

/** Payoff-at-expiry shapes: the quickest honest way to tell strategies apart. Original vector marks, not mascots. */
const payoff: Record<string, string> = {
  protective_put: "M4 30 H18 L44 8",
  covered_call: "M4 34 L28 10 H44",
  cash_secured_put: "M4 30 L20 14 H44",
  earnings_straddle: "M4 8 L24 34 L44 8",
};

export function PayoffMark({ id, ready, size = "md" }: { id: string; ready: boolean; size?: "sm" | "md" }) {
  return (
    <svg className={`payoff-mark payoff-${size}`} data-ready={ready ? "1" : "0"} viewBox="0 0 48 42" aria-hidden="true">
      <path className="payoff-axis" d="M4 30 H44" />
      <path className="payoff-line" d={payoff[id] ?? payoff.protective_put} />
    </svg>
  );
}

function featuredFacts() {
  const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "1", initialCapitalUsd: "1000" });
  const p = recipe.parameters as Record<string, Record<string, number>>;
  return [
    { label: "Hooks", value: String(PAPER_PROTECTIVE_PUT_HOOK_IDS.length) },
    { label: "Put strike", value: `${p.percy?.otmPct}% OTM` },
    { label: "Tenor", value: `${p.tenora?.targetDTE} days` },
  ];
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
          {featuredFacts().map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd className="mono">{fact.value}</dd></div>)}
        </dl>
      ) : null}
      {compact ? null : (
        <details className="template-why">
          <summary>{ready ? "How premiums are modeled" : "Why it is not available yet"}</summary>
          <p>{template.reason}</p>
        </details>
      )}
      {ready
        ? interactive
          ? <a className="template-cta" href={href}>{href === "#configure" ? "Configure this agent below" : "Configure this agent"}<ArrowRight aria-hidden /></a>
          : <span className="template-cta">Configure this agent below<ArrowRight aria-hidden /></span>
        : <p className="template-unavailable"><Lock aria-hidden />Not yet available</p>}
      {children}
    </Card>
  );
}
