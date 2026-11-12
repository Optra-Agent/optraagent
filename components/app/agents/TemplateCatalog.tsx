"use client";

import { useEffect, useState } from "react";
import { HouseAgentTemplateCatalogResponseSchema } from "../../../lib/domain/contracts";
import type { HouseAgentTemplate } from "../../../lib/domain/contracts";
import { Chip, Skeleton } from "../ui";

const summaries: Record<HouseAgentTemplate["id"], string> = {
  protective_put: "Buys a put about 7% out of the money, 30 calendar days out, when realized volatility is calm. The premium is the cost of insurance and is lost if the stock does not fall.",
  covered_call: "Sells a call against shares you hold to collect premium.",
  cash_secured_put: "Sells a put backed by cash to collect premium or buy lower.",
  earnings_straddle: "Buys a call and a put around a reported earnings date.",
};

export function TemplateCatalog() {
  const [templates, setTemplates] = useState<HouseAgentTemplate[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agents/templates", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Template capability is temporarily unavailable.");
        return HouseAgentTemplateCatalogResponseSchema.parse(await response.json());
      })
      .then((result) => {
        setTemplates([...result.templates].sort((a, b) => Number(b.availability === "paper_ready") - Number(a.availability === "paper_ready")));
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="template-catalog-section" aria-label="House Agent templates">
      <div className="section-heading">
        <div><p className="eyebrow">HOUSE AGENTS</p><h2>Select a House Agent</h2></div>
        <span>A template becomes paper ready only when its rules have verified evaluators.</span>
      </div>
      {status === "loading" ? <div className="state-panel" role="status"><Skeleton lines={3} /></div> : null}
      {status === "error" ? <p className="state-panel state-error" role="alert">Template capability is temporarily unavailable. Reload to try again.</p> : null}
      {status === "ready" ? (
        <div className="template-grid">
          {templates.map((template) => {
            const ready = template.availability === "paper_ready";
            return (
              <article className={`template-card${ready ? " template-card-featured" : ""}`} key={template.id}>
                <div className="template-card-head">
                  <h3>{template.name}</h3>
                  <Chip tone={ready ? "azure" : "neutral"}>{ready ? "Paper ready" : "Preview"}</Chip>
                </div>
                <p className="template-summary">{summaries[template.id]}</p>
                <p className="template-reason">{template.reason}</p>
                {ready
                  ? <a className="template-link" href="#configure">Configure this agent below</a>
                  : <p className="template-unavailable">Not yet available. It cannot be created until its venue and data requirements are verified.</p>}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
