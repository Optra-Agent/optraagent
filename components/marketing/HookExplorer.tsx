"use client";

import { useState } from "react";
import { Activity, Crosshair, DoorOpen, Scaling, ShieldAlert, Timer } from "lucide-react";
import type { ComponentType } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Chip } from "../app/ui";
import type { ExplorerStage } from "./section-data";

/* The registry as a workbench: one stage at a time, every hook in the catalog, implemented or locked.
   Deliberately not a network. The graph above shows how one agent uses hooks; this shows what exists. */

const STAGE_ICON: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { gate: DoorOpen, strike: Crosshair, size: Scaling, pulse: Activity, expiry: Timer, breaker: ShieldAlert };

function Cells({ live, total }: { live: number; total: number }) {
  return (
    <span className="cells" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => <i key={index} className={index < live ? "is-live" : ""} />)}
    </span>
  );
}

export function HookExplorer({ stages }: { stages: ExplorerStage[] }) {
  const first = (stage: ExplorerStage) => (stage.hooks.find((hook) => hook.live) ?? stage.hooks[0])?.id ?? "";
  const [active, setActive] = useState<string>(stages[0]?.stage ?? "gate");
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(stages.map((stage) => [stage.stage, first(stage)])));

  return (
    <Tabs value={active} onValueChange={setActive} className="hx">
      <TabsList variant="line" className="hx-ruler" aria-label="Hook stages">
        {stages.map((stage, index) => (
          <TabsTrigger key={stage.stage} value={stage.stage} className="hx-tab" data-risk={stage.stage === "breaker" ? "1" : "0"} style={{ "--i": index } as React.CSSProperties}>
            {(() => { const Icon = STAGE_ICON[stage.stage] ?? Activity; return <span className="hx-tab-icon"><Icon aria-hidden /></span>; })()}
            <span className="hx-tab-name mono">{stage.label.toUpperCase()}</span>
            {stage.stage === "breaker" ? null : <span className="hx-tab-ask">{stage.question}</span>}
            <Cells live={stage.live} total={stage.total} />
            <span className="hx-tab-count mono">{stage.live} of {stage.total}</span>
            {stage.stage === "breaker" ? <span className="hx-tab-note">Runs on every tick. Can stop new entries.</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {stages.map((stage) => {
        const selected = stage.hooks.find((hook) => hook.id === picked[stage.stage]) ?? stage.hooks[0];
        return (
          <TabsContent key={stage.stage} value={stage.stage} className="hx-panel">
            <div className="hx-list">
              <p className="hx-q">{stage.question} <span className="mono">{stage.live} of {stage.total} implemented</span></p>
              <ul className="hx-grid" aria-label={`${stage.label} hooks`}>
                {stage.hooks.map((hook, index) => (
                  <li key={hook.id} style={{ "--i": index } as React.CSSProperties}>
                    <button type="button" className="hx-tile" data-live={hook.live ? "1" : "0"} aria-pressed={selected?.id === hook.id} onClick={() => setPicked((current) => ({ ...current, [stage.stage]: hook.id }))}>
                      <span className="hx-tile-top">
                        <b>{hook.name}</b>
                        <span className="hx-state mono" data-live={hook.live ? "1" : "0"}>{hook.live ? "Implemented" : "Catalog only"}</span>
                      </span>
                      <span className="hx-tile-sum">{hook.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {selected ? (
              <div className="hx-detail" key={selected.id} role="region" aria-label={`${selected.name} details`}>
                <p className="hx-kicker mono">{stage.stage} hook</p>
                <h3>{selected.name}</h3>
                <div className="hx-chips">
                  <Chip tone={selected.live ? "azure" : "neutral"}>{selected.live ? "Implemented" : "Catalog only, locked"}</Chip>
                  {selected.inRecipe ? <Chip>Used by Protective Put</Chip> : null}
                </div>
                <p className="hx-sum">{selected.summary}</p>
                {selected.note ? (
                  <p className="hx-note"><b>{selected.live ? "Implementation" : "Why it is locked"}.</b> {selected.note}</p>
                ) : null}
                {selected.params.length ? (
                  <dl className="hx-params" aria-label="Parameters">
                    {selected.params.map((param) => <div key={param.key}><dt className="mono">{param.key}</dt><dd className="mono">{param.spec}</dd></div>)}
                  </dl>
                ) : null}
              </div>
            ) : null}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
