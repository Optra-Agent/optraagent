"use client";

import { useEffect, useState } from "react";
import { ApiErrorSchema, HookCatalogResponseSchema } from "../../../lib/domain/contracts";
import type { HookCatalogResponse, HookStage } from "../../../lib/domain/contracts";

const STAGES: HookStage[] = ["gate", "strike", "size", "pulse", "expiry", "breaker"];

function messageFrom(body: unknown): string {
  const parsed = ApiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.message : "Hook catalog is temporarily unavailable.";
}

export function HookCatalogScreen() {
  const [catalog, setCatalog] = useState<HookCatalogResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [stageFilter, setStageFilter] = useState<HookStage | "all">("all");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/hooks", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        let body: unknown = null;
        try { body = await response.json(); } catch { /* handled as an invalid response below */ }
        if (!response.ok) throw new Error(messageFrom(body));
        return HookCatalogResponseSchema.parse(body);
      })
      .then((result) => {
        setCatalog(result);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Hook catalog is temporarily unavailable.");
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const definitions = catalog?.definitions.filter((definition) => stageFilter === "all" || definition.stage === stageFilter) ?? [];

  return (
    <main className="page-container">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">RULE CAPABILITIES · SOURCE-BACKED</p>
          <h1>Hook library</h1>
          <p className="page-description">Hook definitions are shown only when their PM source and runtime availability can be verified.</p>
        </div>
      </div>

      {status === "loading" ? <p role="status">Loading hook catalog…</p> : null}
      {status === "error" ? <section className="state-panel" role="alert">{error}</section> : null}
      {catalog ? (
        <section className="state-panel" aria-label="Hook catalog coverage">
          <div className="market-status-row">
            <strong>{catalog.coverage.registeredCount} definitions registered</strong>
            <span>{catalog.coverage.expectedCount} expected in the PM brief</span>
          </div>
          {catalog.coverage.sourceStatus === "source_unavailable" ? (
            <>
              <p>{catalog.coverage.unavailableReason}</p>
              <p>No placeholder hook definitions are shown. Recipes remain unvalidated until the source definitions are available.</p>
            </>
          ) : null}
          <div className="stage-coverage">
            {STAGES.map((stage) => (
              <div key={stage}><span>{stage}</span><strong>{catalog.coverage.expectedByStage[stage]}</strong></div>
            ))}
          </div>
          <div className="hook-filter-controls">
            <label htmlFor="hook-stage-filter">Filter by stage</label>
            <select id="hook-stage-filter" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as HookStage | "all")}>
              <option value="all">All stages</option>
              {STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>
          {definitions.map((definition) => (
            <article className="hook-definition" key={definition.id}>
              <div className="market-status-row"><strong>{definition.name}</strong><span>{definition.stage} · {definition.availability}</span></div>
              <p>{definition.summary}</p>
              {definition.unavailableReason ? <p>{definition.unavailableReason}</p> : null}
              {Object.keys(definition.parameters).length > 0 ? (
                <details className="hook-parameters">
                  <summary>Show parameters for {definition.name} ({Object.keys(definition.parameters).length})</summary>
                  <pre>{JSON.stringify(definition.parameters, null, 2)}</pre>
                </details>
              ) : null}
            </article>
          ))}
          {catalog.definitions.length > 0 && definitions.length === 0 ? <p>No hook definitions are registered for this stage.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
