"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "../app/ui";
import type { ForgeDemoData } from "./section-data";

/* Forge, as the interface works: source, hooks, validated recipe.
   Toggle a hook off and the same messages the Forge validator returns appear. Nothing here is computed locally:
   the messages and the hash were produced by the real validator on the server and are looked up by hook. */

export function ForgeDemo({ data }: { data: ForgeDemoData }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(data.required));
  const [locked, setLocked] = useState<{ name: string; reason: string } | null>(null);

  const issues = [...new Set(data.required.filter((id) => !on.has(id)).flatMap((id) => data.issuesIfRemoved[id] ?? []))];
  const valid = issues.length === 0;
  const toggle = (id: string) => {
    setLocked(null);
    setOn((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fd">
      <section className="fd-col" aria-labelledby="fd-1">
        <p className="fd-step mono">1</p>
        <h3 id="fd-1">Describe or click</h3>
        <div className="fd-src" data-on="0" aria-disabled="true"><span>Describe a strategy in words</span><Chip>Coming soon</Chip></div>
        <div className="fd-src" data-on="1"><span>Click rules together</span><Chip tone="azure">Working</Chip></div>
        <p className="fd-note">No AI provider is configured. Recipes are built by choosing hooks.</p>
      </section>

      <section className="fd-col fd-hooks" aria-labelledby="fd-2">
        <p className="fd-step mono">2</p>
        <h3 id="fd-2">Pick hooks</h3>
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
                      <button type="button" className="fd-chip is-locked" aria-pressed={locked?.name === hook.name} onClick={() => setLocked(locked?.name === hook.name ? null : { name: hook.name, reason: hook.reason })}>
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
          {locked ? <><b>{locked.name} is locked.</b> {locked.reason}</> : "Solid chips run today. Dashed chips are in the library but locked. Select a dashed chip to see why."}
        </p>
      </section>

      <section className="fd-col fd-recipe" aria-labelledby="fd-3" data-valid={valid ? "1" : "0"}>
        <p className="fd-step mono">3</p>
        <h3 id="fd-3">Validated recipe</h3>
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
        <p className="fd-note">{valid ? "The server issues this canonical hash once a recipe validates. This is the hash of the default recipe with example inputs." : "Forge blocks the recipe before it can reach a backtest."}</p>
        <div className="fd-actions">
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => { setOn(new Set(data.required)); setLocked(null); }} disabled={valid}>Restore recipe</button>
          <Link className={buttonVariants({ size: "sm" })} href="/forge">Open Forge</Link>
        </div>
      </section>
    </div>
  );
}
