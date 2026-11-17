"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiErrorSchema, HookCatalogResponseSchema } from "../../../lib/domain/contracts";
import type { HookCatalogResponse, HookStage } from "../../../lib/domain/contracts";
import { Chip, PageHeader, StateBlock, Panel } from "../ui";
import { errorText } from "../format";
import { AgentCharacter } from "../../marketing/characters";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";

const STAGES: HookStage[] = ["gate", "strike", "size", "pulse", "expiry", "breaker"];
const stageLabel = (stage: HookStage) => stage.charAt(0).toUpperCase() + stage.slice(1);

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
        setError(errorText(reason, "Hook catalog is temporarily unavailable."));
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const definitions = catalog?.definitions.filter((definition) => stageFilter === "all" || definition.stage === stageFilter) ?? [];
  const implementedByStage = useMemo(() => {
    const counts: Record<HookStage, number> = { gate: 0, strike: 0, size: 0, pulse: 0, expiry: 0, breaker: 0 };
    for (const definition of catalog?.definitions ?? []) if (definition.availability === "implemented") counts[definition.stage] += 1;
    return counts;
  }, [catalog]);
  const implementedTotal = STAGES.reduce((total, stage) => total + implementedByStage[stage], 0);

  return (
    <main className="page-container">
      <PageHeader
        eyebrow="RULE CAPABILITIES · SOURCE-BACKED"
        title="Hook library"
        description="Hook definitions are shown only when their PM source and runtime availability can be verified. Filtering never changes what a hook can do."
      />

      {status === "loading" ? <StateBlock kind="loading" title="Loading hook catalog…" /> : null}
      {status === "error" ? <StateBlock kind="error" title="Hook catalog unavailable"><p>{error}</p></StateBlock> : null}
      {catalog ? (
        <>
          <Panel  aria-label="Hook catalog coverage">
            <div className="panel-head">
              <strong className="coverage-title">{catalog.coverage.registeredCount} definitions registered</strong>
              <span className="coverage-sub">{catalog.coverage.expectedCount} expected in the PM brief</span>
            </div>
            {catalog.coverage.sourceStatus === "source_unavailable" ? (
              <>
                <p>{catalog.coverage.unavailableReason}</p>
                <p>No placeholder hook definitions are shown. Recipes remain unvalidated until the source definitions are available.</p>
              </>
            ) : (
              <p className="coverage-split"><Chip tone="azure">{implementedTotal} implemented</Chip><Chip>{catalog.definitions.length - implementedTotal} catalog only</Chip><span>Catalog-only hooks are documented but cannot run in a recipe.</span></p>
            )}
            <div className="stage-coverage">
              {STAGES.map((stage) => {
                const expected = catalog.coverage.expectedByStage[stage];
                const ready = implementedByStage[stage];
                return (
                  <button key={stage} type="button" className={`stage-tile${stageFilter === stage ? " is-active" : ""}`} aria-pressed={stageFilter === stage} onClick={() => setStageFilter(stageFilter === stage ? "all" : stage)}>
                    <span className="stage-tile-name"><AgentCharacter id={stage} size={30} />{stageLabel(stage)}</span>
                    <strong className="mono">{expected}</strong>
                    <span className="stage-tile-bar" aria-hidden="true"><span style={{ width: expected ? `${Math.round((ready / expected) * 100)}%` : "0%" }} /></span>
                    <span className="stage-tile-note">{ready} live</span>
                  </button>
                );
              })}
            </div>
            <div className="hook-filter-controls">
              <Label htmlFor="hook-stage-filter">Filter by stage</Label>
              <NativeSelect id="hook-stage-filter" className="hook-select" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as HookStage | "all")}>
                <option value="all">All stages</option>
                {STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </NativeSelect>
              <span className="coverage-sub">{definitions.length} shown</span>
            </div>
          </Panel>

          <div className="hook-grid">
            {definitions.map((definition) => (
              <article className={`hook-card${definition.availability === "implemented" ? "" : " hook-card-locked"}`} key={definition.id}>
                <div className="hook-card-head">
                  <h2>{definition.name}</h2>
                  <span className="hook-card-tags">
                    <Chip>{stageLabel(definition.stage)}</Chip>
                    <Chip tone={definition.availability === "implemented" ? "azure" : "neutral"}>{definition.availability === "implemented" ? "Implemented" : "Catalog only"}</Chip>
                  </span>
                </div>
                <p>{definition.summary}</p>
                {definition.implementationNote ? <p className="hook-note">{definition.implementationNote}</p> : null}
                {definition.unavailableReason ? <p className="hook-note hook-note-blocked">{definition.unavailableReason}</p> : null}
                {Object.keys(definition.parameters).length > 0 ? (
                  <details className="hook-parameters">
                    <summary>Show parameters for {definition.name} ({Object.keys(definition.parameters).length})</summary>
                    <pre>{JSON.stringify(definition.parameters, null, 2)}</pre>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
          {catalog.definitions.length > 0 && definitions.length === 0 ? <StateBlock kind="empty">No hook definitions are registered for this stage.</StateBlock> : null}
        </>
      ) : null}
    </main>
  );
}
