"use client";

import { useState } from "react";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import type { GraphStage } from "./graph-data";
import type { FlowScenario, Verdict } from "./graph-flow";

/* An event trail: each tick is one entry; open it to read the evaluation behind the decision.
   The three ticks are labeled illustrative. Hook reasons are the engine's own strings. */

const tone: Record<Verdict, Tone> = { pass: "azure", select: "azure", size: "azure", action: "azure", block: "ember", noop: "neutral" };

export function TapeTimeline({ ticks, stages }: { ticks: FlowScenario[]; stages: GraphStage[] }) {
  const [open, setOpen] = useState<string>(ticks[0]?.id ?? "");
  return (
    <figure className="tt">
      <figcaption>Illustrative paper example. Not a recorded trade.</figcaption>
      <ol className="tt-list reveal-stagger">
        {ticks.map((tick, index) => {
          const expanded = open === tick.id;
          return (
            <li key={tick.id} className="tt-item" data-action={tick.action} data-open={expanded ? "1" : "0"} style={{ "--i": index } as React.CSSProperties}>
              <button type="button" className="tt-head" aria-expanded={expanded} aria-controls={`tt-${tick.id}`} onClick={() => setOpen(expanded ? "" : tick.id)}>
                <span className="tt-tick mono">Tick {index + 1}</span>
                <Chip tone={tick.action === "open" ? "azure" : "neutral"}>{tick.action}</Chip>
                <span className="tt-reason">{tick.reason}</span>
                <span className="tt-caret" aria-hidden="true" />
              </button>
              <div className="tt-body" id={`tt-${tick.id}`} role="region" aria-label={`Tick ${index + 1} evaluation`} hidden={!expanded}>
                <div className="tt-inner">
                  <ul className="tt-stages">
                    {stages.map((stage) => (
                      <li key={stage.stage}>
                        <span className="tt-stage mono">{stage.label}</span>
                        <span className="tt-hooks">
                          {stage.hooks.map((hook) => {
                            const verdict = tick.verdicts[hook.id];
                            return verdict ? <span key={hook.id} className="tt-hook" data-v={verdict.status}><b>{hook.name}</b> {verdict.status}</span> : null;
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {Object.entries(tick.verdicts).filter(([, verdict]) => verdict.status === "block").map(([id, verdict]) => (
                    <p className="tt-why" key={id}><b className="mono">{id}</b> {verdict.reason}</p>
                  ))}
                  {tick.action === "open" ? <p className="tt-why">A modeled put is opened at a slippage-adjusted theoretical premium. Venue fees are excluded.</p> : null}
                  <p className="tt-foot mono">Protective Put · PAPER · source robinhood_stock_token_api · recipe sha256:…</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
