"use client";

import { ArrowUpRight, Check, Lock } from "lucide-react";
import Link from "next/link";
import type { KeyboardEvent } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PayoffMark } from "../app/agents/TemplateCard";
import type { ForgeDemoData } from "./section-data";

const WORKFLOW = [
  { label: "Agent selection", short: "Agent", description: "Choose the only House Agent enabled for paper execution." },
  { label: "Rule composition", short: "Rules", description: "See the selected evaluators and change them in the same recipe." },
  { label: "Recipe validation", short: "Validate", description: "A complete recipe can be hashed; a missing required rule is blocked." },
  { label: "Backtest readiness", short: "Backtest", description: "Lab checks historical coverage and shows results only after a run." },
  { label: "Decision & Tape", short: "Decision", description: "A paper decision carries its reasons into the wallet owner's private Tape." },
] as const;

type Props = {
  data: ForgeDemoData;
  agent: string;
  selected: ReadonlySet<string>;
  valid: boolean;
  issues: string[];
  activeStage: number;
  autoPlaying: boolean;
  onSelectStage: (index: number) => void;
  onToggleRule: (id: string) => void;
};

function StateLabel({ state }: { state: "ready" | "blocked" | "pending" | "locked" }) {
  return <span className={`fww-state fww-state-${state}`}>{state === "ready" ? <Check aria-hidden /> : state === "locked" ? <Lock aria-hidden /> : null}{state === "ready" ? "Ready" : state === "blocked" ? "Blocked" : state === "locked" ? "Catalog only" : "Run in Lab"}</span>;
}

export function ForgeWorkflowPreview({ data, agent, selected, valid, issues, activeStage, autoPlaying, onSelectStage, onToggleRule }: Props) {
  const supportedAgent = data.agents.find(({ id }) => id === agent) ?? data.agents.find(({ ready }) => ready);
  const defaultRecipe = valid && selected.size === data.required.length && data.required.every((id) => selected.has(id));
  const selectedCount = data.required.filter((id) => selected.has(id)).length;
  const catalogOnlyCount = data.stages.reduce((total, stage) => total + stage.hooks.filter(({ live }) => !live).length, 0);
  const sessionHook = data.stages.flatMap(({ hooks }) => hooks).find(({ id, name }) => /sessia|session/i.test(`${id} ${name}`));
  const onStageKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % WORKFLOW.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + WORKFLOW.length - 1) % WORKFLOW.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = WORKFLOW.length - 1;
    else return;
    event.preventDefault();
    onSelectStage(next);
    document.getElementById(`fww-tab-${next}`)?.focus();
  };

  return (
    <section className="fww" data-active-stage={activeStage} data-valid={valid ? "1" : "0"} data-auto-playing={autoPlaying ? "1" : "0"} aria-labelledby="fww-title">
      <header className="fww-head">
        <div>
          <p className="fww-overline mono">FORGE WORKFLOW <span>·</span> SUPPORTED RECIPE</p>
          <h3 id="fww-title">Protective Put, from rules to a reasoned decision.</h3>
        </div>
        <span className="fww-paper-tag">PAPER ONLY</span>
      </header>

      <div className="fww-tabs" role="tablist" aria-label="Protective Put workflow">
        {WORKFLOW.map((item, index) => (
          <button
            id={`fww-tab-${index}`}
            key={item.label}
            type="button"
            role="tab"
            aria-selected={activeStage === index}
            aria-controls="fww-panel"
            tabIndex={activeStage === index ? 0 : -1}
            onClick={() => onSelectStage(index)}
            onKeyDown={(event) => onStageKeyDown(event, index)}
          >
            <span className="fww-tab-number">0{index + 1}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div id="fww-panel" className="fww-panel" role="tabpanel" aria-labelledby={`fww-tab-${activeStage}`} data-workflow-panel key={activeStage} aria-live="polite" aria-atomic="true">
        <div className="fww-panel-copy">
          <p className="fww-kicker mono">STEP 0{activeStage + 1} <span> / </span> 05</p>
          <h4>{WORKFLOW[activeStage]?.label}</h4>
          <p>{WORKFLOW[activeStage]?.description}</p>
        </div>

        {activeStage === 0 ? (
          <div className="fww-agent-card">
            <span className="fww-agent-mark">{supportedAgent ? <PayoffMark id={supportedAgent.id} ready={supportedAgent.ready} size="sm" /> : null}</span>
            <div className="fww-agent-copy">
              <span className="mono">SELECTED HOUSE AGENT</span>
              <strong>{supportedAgent?.name ?? "Protective Put"}</strong>
              <small>{supportedAgent?.ready ? "Paper ready · rules are selected by clicking" : "Preview · no paper evaluator"}</small>
            </div>
            <StateLabel state={supportedAgent?.ready ? "ready" : "locked"} />
          </div>
        ) : null}

        {activeStage === 1 ? (
          <div className="fww-rules" aria-label="Protective Put rule composition">
            <div className="fww-rules-summary"><strong>{selectedCount} of {data.required.length} required rules selected</strong><span>{catalogOnlyCount} catalog-only hooks stay locked</span></div>
            <div className="fww-rule-stages">
              {data.stages.map((stage) => {
                const hooks = stage.hooks.filter(({ live }) => live);
                const selectedHooks = hooks.filter(({ id }) => selected.has(id));
                return (
                  <section className="fww-rule-stage" key={stage.stage} data-breaker={stage.stage === "breaker" ? "1" : "0"}>
                    <div className="fww-rule-stage-head"><strong>{stage.label}</strong><span>{selectedHooks.length} / {hooks.length} active</span></div>
                    <div className="fww-rule-chips">
                      {hooks.map((hook) => (
                        <button key={hook.id} type="button" className="fww-rule-chip" aria-pressed={selected.has(hook.id)} onClick={() => onToggleRule(hook.id)} title={hook.line}>
                          <span aria-hidden="true" />{hook.name}
                        </button>
                      ))}
                      {stage.hooks.filter(({ live }) => !live).length ? <span className="fww-locked-count"><Lock aria-hidden />+{stage.hooks.filter(({ live }) => !live).length}</span> : null}
                    </div>
                  </section>
                );
              })}
            </div>
            <p className="fww-rule-foot">Click an implemented rule to edit it. Catalog-only hooks cannot enter the recipe.</p>
          </div>
        ) : null}

        {activeStage === 2 ? (
          <div className="fww-validation" data-result={valid ? "valid" : "blocked"}>
            <div className="fww-validation-status"><span className="fww-validation-mark">{valid ? <Check aria-hidden /> : "!"}</span><div><span className="mono">SERVER VALIDATOR PREVIEW</span><strong>{valid ? "Recipe valid" : "Recipe blocked"}</strong></div><StateLabel state={valid ? "ready" : "blocked"} /></div>
            {valid ? (
              <div className="fww-hash"><span className="mono">{defaultRecipe ? "CANONICAL RECIPE HASH" : "VALIDATION"}</span><code>{defaultRecipe ? `${data.validHash.slice(0, 19)}…` : "Required implemented rules are selected"}</code></div>
            ) : (
              <ul className="fww-issues" aria-label="Validator feedback">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            )}
            <p className="fww-disclaimer">This preview uses validator results for the supported default recipe and its individual required-rule checks. The Forge app validates edited recipes on the server.</p>
          </div>
        ) : null}

        {activeStage === 3 ? (
          <div className="fww-readiness">
            <div className="fww-readiness-status"><div><span className="mono">NEXT · HISTORICAL REPLAY</span><strong>{valid ? "Ready to configure in Lab" : "Restore the required rules first"}</strong></div><StateLabel state={valid ? "ready" : "blocked"} /></div>
            <ul>
              <li><span>Recipe validation</span><StateLabel state={valid ? "ready" : "blocked"} /></li>
              <li><span>Historical candle coverage</span><StateLabel state="pending" /></li>
              <li><span>Benchmarks and metrics</span><span className="fww-state fww-state-pending">After a successful run</span></li>
            </ul>
            <div className="fww-lab-action"><Link className={cn(buttonVariants({ size: "sm" }), !valid && "fww-disabled")} href="/lab" aria-disabled={!valid}>Open Lab <ArrowUpRight aria-hidden /></Link><span>No backtest runs from this demo.</span></div>
          </div>
        ) : null}

        {activeStage === 4 ? (
          <div className="fww-evidence">
            <p className="fww-example-label">ILLUSTRATIVE BEHAVIOR <span>· NOT EXECUTED HERE</span></p>
            <ol aria-label="Example paper decision route">
              <li><span className="fww-evidence-index">01</span><div><strong>Market input</strong><small>US session closed</small></div><span className="fww-evidence-status">Example condition</span></li>
              <li><span className="fww-evidence-index">02</span><div><strong>Hook evaluation</strong><small>{sessionHook?.name ?? "Session check"} blocks a new entry</small></div><span className="fww-evidence-status">Entry blocked</span></li>
              <li data-outcome="skip"><span className="fww-evidence-index">03</span><div><strong>Paper decision</strong><small>Skip · 0 orders</small></div><span className="fww-evidence-status">No position change</span></li>
              <li><span className="fww-evidence-index">04</span><div><strong>Optra Tape</strong><small>The real tick stores its reasons privately for the wallet owner.</small></div><span className="fww-evidence-status">Only after a real tick</span></li>
            </ol>
            <p className="fww-evidence-foot">A verified engine behavior example. This marketing view makes no request and creates no record.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
