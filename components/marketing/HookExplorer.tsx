"use client";

import { useState } from "react";
import { Activity, ChevronDown, Crosshair, DoorOpen, Scaling, ShieldAlert, Timer } from "lucide-react";
import type { ComponentType } from "react";
import { Chip } from "../app/ui";
import { FlowPath } from "./FlowPath";
import { PinnedStory } from "./PinnedStory";
import type { ExplorerHook, ExplorerStage } from "./section-data";

/* The strategy explorer, as a short pinned story. Left: the five stages and the Breaker. Right: a sticky picture of the
   path with the active stage lit, a pulse that travels to it, and the Breaker rail guarding every stage, then that
   stage's explanation and its rules. Click a stage or scroll; both stay in step. Locked hooks are one disclosure away. */

const STAGE_ICON: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { gate: DoorOpen, strike: Crosshair, size: Scaling, pulse: Activity, expiry: Timer, breaker: ShieldAlert };

function Cells({ live, total }: { live: number; total: number }) {
  return (
    <span className="cells" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => <i key={index} className={index < live ? "is-live" : ""} />)}
    </span>
  );
}

function Rule({ hook, open, onToggle }: { hook: ExplorerHook; open: boolean; onToggle: () => void }) {
  return (
    <li className="hw-rule" data-live={hook.live ? "1" : "0"} data-open={open ? "1" : "0"}>
      <button type="button" className="hw-rule-head" aria-expanded={open} onClick={onToggle}>
        <span className="hw-rule-name">{hook.name}</span>
        <span className="hw-rule-line">{hook.live ? hook.line ?? hook.summary : hook.summary}</span>
        <span className="hw-rule-state mono" data-live={hook.live ? "1" : "0"}>{hook.live ? "Implemented" : "Locked"}</span>
        <ChevronDown className="hw-rule-caret" aria-hidden />
      </button>
      {open ? (
        <div className="hw-rule-body" role="region" aria-label={`${hook.name} details`}>
          <div className="hx-chips"><Chip tone={hook.live ? "azure" : "neutral"}>{hook.live ? "Implemented" : "Catalog only, locked"}</Chip>{hook.inRecipe ? <Chip>Used by Protective Put</Chip> : null}</div>
          <p className="hw-sum">{hook.summary}</p>
          {hook.note ? <p className="hw-note"><b>{hook.live ? "Implementation" : "Why it is locked"}.</b> {hook.note}</p> : null}
          {hook.params.length ? (
            <dl className="hw-params" aria-label="Parameters">
              {hook.params.map((param) => <div key={param.key}><dt className="mono">{param.key}</dt><dd className="mono">{param.spec}</dd></div>)}
            </dl>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function HookExplorer({ stages }: { stages: ExplorerStage[] }) {
  const [step, setStep] = useState(0);
  const [openRule, setOpenRule] = useState("");
  const main = stages.filter((stage) => stage.stage !== "breaker");
  const breaker = stages.find((stage) => stage.stage === "breaker");
  const order = breaker ? [...main, breaker] : main;
  const nodes = main.map((stage) => ({ id: stage.stage, label: stage.label, sub: `${stage.live} of ${stage.total}`, icon: STAGE_ICON[stage.stage] ?? Activity }));

  const views = order.map((stage, index) => {
    const Icon = STAGE_ICON[stage.stage] ?? Activity;
    const isGuard = stage.stage === "breaker";
    const used = stage.hooks.filter((hook) => hook.live);
    const locked = stage.hooks.filter((hook) => !hook.live);
    return (
      <div key={stage.stage} className="hw-view" data-risk={isGuard ? "1" : "0"}>
        <FlowPath nodes={nodes} active={isGuard ? main.length - 1 : index} guard guardActive={isGuard} />
        <div className="hw-panel" data-risk={isGuard ? "1" : "0"}>
          <div className="hw-panel-head">
            <span className="hw-panel-icon"><Icon aria-hidden /></span>
            <div>
              <p className="hw-kicker mono">{isGuard ? "GUARD · EVERY TICK" : `STAGE ${index + 1} OF ${main.length}`}</p>
              <h3>{isGuard ? "Breaker" : stage.question}</h3>
            </div>
            <span className="hw-panel-count mono">{stage.live} of {stage.total} implemented</span>
          </div>
          <p className="hw-blurb">{stage.blurb}</p>
          <p className="hw-label">{isGuard ? "The five guards a Protective Put runs" : "What a Protective Put checks here"}</p>
          <ul className="hw-rules">
            {used.map((hook) => <Rule key={hook.id} hook={hook} open={openRule === hook.id} onToggle={() => setOpenRule(openRule === hook.id ? "" : hook.id)} />)}
          </ul>
          {locked.length > 0 ? (
            <details className="hw-locked">
              <summary><ChevronDown aria-hidden />{locked.length} catalog-only {locked.length === 1 ? "hook" : "hooks"} in {stage.label} (locked)</summary>
              <ul className="hw-rules hw-rules-locked">
                {locked.map((hook) => <Rule key={hook.id} hook={hook} open={openRule === hook.id} onToggle={() => setOpenRule(openRule === hook.id ? "" : hook.id)} />)}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    );
  });

  return (
    <PinnedStory id="hooks" count={order.length} step={step} onStep={(index) => { setStep(index); setOpenRule(""); }} views={views} beat="30vh">
      {({ go, views: stage }) => (
        <>
          <nav className="ps-nav hw-nav" aria-label="Hook stages">
            <ol>
              {order.map((item, index) => {
                const Icon = STAGE_ICON[item.stage] ?? Activity;
                const isGuard = item.stage === "breaker";
                return (
                  <li key={item.stage} data-state={index === step ? "active" : index < step ? "done" : "next"} data-risk={isGuard ? "1" : "0"}>
                    <button type="button" aria-current={index === step ? "step" : undefined} aria-controls={`hooks-view-${index}`} onClick={() => go(index)}>
                      <span className="hw-nav-icon"><Icon aria-hidden /></span>
                      <span className="hw-nav-text">
                        <span className="hw-nav-name mono">{item.label.toUpperCase()}</span>
                        <span className="hw-nav-ask">{isGuard ? "Guards every stage, every tick" : item.question}</span>
                      </span>
                      <span className="hw-nav-count mono">{item.live} of {item.total}<Cells live={item.live} total={item.total} /></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          {stage}
        </>
      )}
    </PinnedStory>
  );
}
