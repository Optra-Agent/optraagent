"use client";

import { useEffect, useState } from "react";
import { HouseAgentTemplateCatalogResponseSchema } from "../../../lib/domain/contracts";
import type { HouseAgentTemplate } from "../../../lib/domain/contracts";
import { Panel, Skeleton } from "../ui";
import { TemplateCard } from "./TemplateCard";

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
      {status === "loading" ? <Panel role="status"><Skeleton lines={3} /></Panel> : null}
      {status === "error" ? <p className="form-error" role="alert">Template capability is temporarily unavailable. Reload to try again.</p> : null}
      {status === "ready" ? (
        <div className="template-grid">
          {templates.map((template) => <TemplateCard key={template.id} template={template} />)}
        </div>
      ) : null}
    </section>
  );
}
