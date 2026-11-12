"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PayoffMark } from "../app/agents/TemplateCard";
import { Chip } from "../app/ui";
import type { ForgeDemoData } from "./section-data";

/* Forge as a strategy workbench: Choose agent, Configure hooks, Validate recipe, Backtest.
   The workflow rail and chips use the same classes as the real /forge screen. Toggle a hook off and the same messages
   the Forge validator returns appear. Nothing is computed locally: the messages and the hash were produced by the real
   validator on the server and are looked up by hook. */

export function ForgeDemo({ data }: { data: ForgeDemoData }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(data.required));
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const [agent, setAgent] = useState("protective_put");

  const issues = [...new Set(data.required.filter((id) => !on.has(id)).flatMap((id) => data.issuesIfRemoved[id] ?? []))];
  const valid = issues.length === 0;
  const steps = [
    { label: "Choose agent", done: true },
    { label: "Configure hooks", done: on.size > 0 },
    { label: "Validate recipe", done: valid },
    { label: "Backtest in Lab", done: false },
  ];
  const current = steps.findIndex((step) => !step.done);

  const toggle = (id: string) => {
    setNote(null);
    setOn((existing) => {
      const next = new Set(existing);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fd">
      <ol className="fd-rail" aria-label="Forge workflow">
        {steps.map((step, index) => {
          const state = step.done ? "done" : index === current ? "current" : "next";
          return (
            <li key={step.label} className={`journey-step journey-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="journey-static"><span className="journey-index">{step.done ? <Check aria-hidden /> : index + 1}</span><span className="journey-label">{step.label}</span></span>
            </li>
          );
        })}
      </ol>

      <div className="fd-body">
        <section className="fd-main" aria-labelledby="fd-config">
          <h3 id="fd-config" className="sr-only">Choose an agent and configure its hooks</h3>
          <div className="fd-agents" role="group" aria-label="House Agent">
            {data.agents.map((row) => (
              <button type="button" key={row.id} className="fd-agent" aria-pressed={agent === row.id} data-ready={row.ready ? "1" : "0"} onClick={() => { if (row.ready) { setAgent(row.id); setNote(null); } else setNote({ title: `${row.name} is not available.`, text: row.reason }); }}>
                <PayoffMark id={row.id} ready={row.ready} size="sm" />
                <span className="fd-agent-text"><b>{row.name}</b><small>{row.ready ? "Can be built" : "Locked"}</small></span>
                {row.ready ? null : <Lock aria-hidden />}
              </button>
            ))}
          </div>
          <div className="fd-stages">
            {data.stages.map((stage) => (
              <div className="fd-stage" key={stage.stage} data-risk={stage.stage === "breaker" ? "1" : "0"}>
                <p className="fd-stage-name mono">{stage.label}</p>
                <ul>
                  {stage.hooks.map((hook) => (
                    <li key={hook.id}>
                      {hook.live ? (
                        <button type="button" className="fd-chip" aria-pressed={on.has(hook.id)} onClick={() => toggle(hook.id)}>{hook.name}</button>
                      ) : (
                        <button type="button" className="fd-chip is-locked" aria-pressed={note?.title === `${hook.name} is locked.`} onClick={() => setNote(note?.title === `${hook.name} is locked.` ? null : { title: `${hook.name} is locked.`, text: hook.reason })}>
                          {hook.name}<span className="sr-only"> (catalog only, locked)</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="fd-note" role="status">
            {note ? <><b>{note.title}</b> {note.text}</> : "Solid chips run today. Dashed chips are in the library but locked. Select one to see why, or remove a hook to see the validator respond."}
          </p>
        </section>

        <aside className="fd-side">
          <section className="fd-card fd-recipe" data-valid={valid ? "1" : "0"} aria-labelledby="fd-validate">
            <p className="fd-card-kicker mono">3 · VALIDATE</p>
            <h3 id="fd-validate">Recipe</h3>
            <div className="fd-status" role="status">
              <Chip tone={valid ? "azure" : "ember"}>{valid ? "Valid" : "Blocked"}</Chip>
              <span className="mono">{on.size} of {data.required.length} required hooks</span>
            </div>
            {valid ? (
              <p className="fd-hash mono" aria-label="Recipe hash">{data.validHash.slice(0, 23)}…</p>
            ) : (
              <ul className="fd-issues" aria-label="Validation issues">
                {issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            )}
            <p className="fd-note">{valid ? "The server issues this canonical hash once a recipe validates. It is the hash of the default recipe with example inputs." : "Forge blocks the recipe before it can reach a backtest."}</p>
            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => { setOn(new Set(data.required)); setNote(null); }} disabled={valid}>Restore recipe</button>
          </section>
          <section className="fd-card fd-backtest" data-ready={valid ? "1" : "0"} aria-labelledby="fd-backtest">
            <p className="fd-card-kicker mono">4 · BACKTEST</p>
            <h3 id="fd-backtest">{valid ? "Ready for Lab" : "Waiting for a valid recipe"}</h3>
            <p className="fd-note">{valid ? "Replay 720 decisions on closed hourly candles and compare with holding the stock. Premiums are modeled." : "A backtest only runs on a recipe the server has validated."}</p>
            <div className="fd-actions">
              <Link className={cn(buttonVariants({ size: "sm" }), !valid && "fd-disabled")} href="/forge" aria-disabled={!valid}>Open Forge<ArrowUpRight aria-hidden /></Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
