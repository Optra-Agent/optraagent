"use client";

import { useEffect, useState } from "react";
import { HouseAgentTemplateCatalogResponseSchema } from "../../../lib/domain/contracts";
import type { HouseAgentTemplate } from "../../../lib/domain/contracts";

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
        setTemplates(result.templates);
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
        <div><p className="eyebrow">HOUSE AGENTS</p><h2>Templates</h2></div>
        <span>Only verified evaluators can become paper ready.</span>
      </div>
      {status === "loading" ? <p role="status">Loading template capability…</p> : null}
      {status === "error" ? <p role="alert">Template capability is temporarily unavailable.</p> : null}
      {status === "ready" ? (
        <div className="template-grid">
          {templates.map((template) => (
            <article className="state-panel template-card" key={template.id}>
              <div className="market-status-row"><h3>{template.name}</h3><span className={`template-badge template-badge-${template.availability}`}>{template.availability === "paper_ready" ? "Paper ready" : "Preview"}</span></div>
              <p>{template.reason}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
