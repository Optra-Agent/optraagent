"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Database, Gauge, ListChecks, ScrollText, Waypoints } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "../app/ui";
import { FlowPath } from "./FlowPath";
import type { FlowNode } from "./FlowPath";
import type { GraphStage } from "./graph-data";
import type { FlowScenario } from "./graph-flow";
import { PinnedStory } from "./PinnedStory";

/* The decision replay, as a short pinned story. Pick one of three illustrative ticks (it never changes on its own),
   then scroll or click through the real path of a decision: market input, hook evaluations, risk guard, paper decision,
   Tape record. The hook that blocked is named where it stopped the path. The rule wording is the engine's own; the
   plain sentences are written for people. Nothing here is a recorded trade, and no private Tape record is ever shown. */

const WHY_BLOCKED: Record<string, string> = {
  sessia: "The market was closed. Entries are only allowed in regular US trading hours.",
  calmo: "Volatility was not calm enough to buy protection.",
};
const SHORT: Record<string, string> = { sessia: "Waited: market closed", calmo: "Waited: volatility not calm" };
const WHY_OPEN = "Every rule agreed, so the agent opened a modeled put on paper.";
/** Which input each blocking hook reads. */
const INPUT_OF: Record<string, number> = { calmo: 1, sessia: 2 };
const INPUTS = [
  { id: "candle", label: "Latest closed hourly candle and the current quote" },
  { id: "vol", label: "Realized volatility from the candles before it" },
  { id: "clock", label: "The session clock, in America/New_York time" },
  { id: "actions", label: "Known token corporate actions" },
  { id: "account", label: "The paper account and any open position" },
];

const STEPS = [
  { id: "input", title: "Market input", text: "Each tick starts from data: a closed candle and quote, volatility, the session clock, corporate actions and the paper account." },
  { id: "rules", title: "Hook evaluations", text: "Gate, Strike, Size, Pulse and Expiry rules each return a verdict. Any Gate block stops a new entry." },
  { id: "guard", title: "Risk guard", text: "The five Breakers check data health, daily loss, drawdown and exposure on every tick." },
  { id: "decision", title: "Paper decision", text: "The verdicts combine into one action: open, hold, close or skip. Skipping is a decision too." },
  { id: "tape", title: "Tape record", text: "The decision, every hook verdict, the data source and the recipe hash are appended to the Tape." },
] as const;
const ICON = [Waypoints, ListChecks, Gauge, ScrollText, Database];

export function TapeTimeline({ ticks, stages }: { ticks: FlowScenario[]; stages: GraphStage[] }) {
  const [picked, setPicked] = useState<string>(ticks[0]?.id ?? "");
  const [step, setStep] = useState(0);
  const tick = ticks.find((row) => row.id === picked) ?? ticks[0];
  if (!tick) return null;

  const rows = stages.map((stage) => ({ stage, hooks: stage.hooks.map((hook) => ({ hook, verdict: tick.verdicts[hook.id] })) }));
  const flat = rows.flatMap((row) => row.hooks.map((item) => ({ ...item, stage: row.stage })));
  const blocked = flat.filter((row) => row.verdict?.status === "block");
  const passed = flat.filter((row) => row.verdict && row.verdict.status !== "block" && row.verdict.status !== "noop").length;
  const idle = flat.filter((row) => row.verdict?.status === "noop").length;
  const culprit = blocked[0];
  const stop = culprit ? (culprit.stage.stage === "breaker" ? 2 : 1) : null;
  const why = tick.action === "open" ? WHY_OPEN : (WHY_BLOCKED[culprit?.hook.id ?? ""] ?? tick.reason);
  const index = ticks.indexOf(tick);
  const guardRow = rows.find((row) => row.stage.stage === "breaker");
  const mainRows = rows.filter((row) => row.stage.stage !== "breaker");

  const nodes: FlowNode[] = STEPS.map((item, i) => ({
    id: item.id,
    label: item.title,
    sub: i === 1 && culprit && stop === 1 ? `${culprit.hook.name} blocked` : i === 2 && culprit && stop === 2 ? `${culprit.hook.name} blocked` : i === 3 ? tick.action : undefined,
    icon: ICON[i]!,
    tone: stop === i ? "ember" : "azure",
  }));
  const verdictChip = (status: string | undefined) => <span className="tp-v" data-v={status ?? "noop"}>{status ?? "n/a"}</span>;

  const views = [
    <div key="input" className="tp-view">
      <p className="tp-kicker mono">WHAT THE ENGINE LOOKS AT</p>
      <ul className="tp-inputs">
        {INPUTS.map((input, i) => {
          const used = culprit && INPUT_OF[culprit.hook.id] === i;
          return <li key={input.id} data-used={used ? "1" : "0"}><span>{input.label}</span>{used ? <em>{culprit?.hook.name} read this and blocked</em> : null}</li>;
        })}
      </ul>
      <p className="tp-note">These are the kinds of inputs a tick reads. The values below them are not shown: this example has no market data in it.</p>
    </div>,
    <div key="rules" className="tp-view">
      <p className="tp-kicker mono">GATE, STRIKE, SIZE, PULSE, EXPIRY</p>
      <ul className="tp-rows">
        {mainRows.map((row) => (
          <li key={row.stage.stage}>
            <span className="tp-stage mono">{row.stage.label}</span>
            <span className="tp-hooks">{row.hooks.map(({ hook, verdict }) => verdict ? <span key={hook.id} className="tp-hook" data-v={verdict.status}><b>{hook.name}</b>{verdictChip(verdict.status)}</span> : null)}</span>
          </li>
        ))}
      </ul>
      {culprit && stop === 1 ? <p className="tp-block"><b className="mono">{culprit.hook.id}</b>{culprit.verdict?.reason}</p> : <p className="tp-note">No Gate rule blocked this tick.</p>}
    </div>,
    <div key="guard" className="tp-view">
      <p className="tp-kicker mono">BREAKER, ON EVERY TICK</p>
      <ul className="tp-rows">
        <li>
          <span className="tp-stage mono">Breaker</span>
          <span className="tp-hooks">{guardRow?.hooks.map(({ hook, verdict }) => verdict ? <span key={hook.id} className="tp-hook" data-v={verdict.status}><b>{hook.name}</b>{verdictChip(verdict.status)}</span> : null)}</span>
        </li>
      </ul>
      {culprit && stop === 2 ? <p className="tp-block"><b className="mono">{culprit.hook.id}</b>{culprit.verdict?.reason}</p> : <p className="tp-note">All five Breakers passed on this tick. When one blocks, new entries stop and exits keep running.</p>}
    </div>,
    <div key="decision" className="tp-view tp-decision" data-action={tick.action}>
      <p className="tp-kicker mono">THE DECISION</p>
      <div className="tp-verdict"><span>{tick.action === "open" ? "Opened" : "Waited"}</span><Chip tone={tick.action === "open" ? "azure" : "neutral"}>{tick.action}</Chip></div>
      <p className="tp-why">{why}</p>
      <div className="tp-bar" role="img" aria-label={`${passed} rules passed, ${blocked.length} blocked, ${idle} idle`}>
        {flat.map((row) => <i key={row.hook.id} data-v={row.verdict?.status ?? "noop"} title={`${row.hook.name}: ${row.verdict?.status ?? "n/a"}`} />)}
      </div>
      <p className="tp-legend mono"><span data-v="pass">{passed} passed</span>{blocked.length > 0 ? <span data-v="block">{blocked.length} blocked</span> : null}{idle > 0 ? <span data-v="noop">{idle} idle</span> : null}</p>
    </div>,
    <div key="tape" className="tp-view">
      <p className="tp-kicker mono">WHAT THE TAPE WOULD WRITE</p>
      <dl className="tp-record">
        <div><dt>Action</dt><dd className="mono">{tick.action}</dd></div>
        <div><dt>Reason</dt><dd>{why}</dd></div>
        <div><dt>Hook verdicts</dt><dd className="mono">{flat.length} recorded</dd></div>
        <div><dt>Source</dt><dd className="mono">robinhood_stock_token_api</dd></div>
        <div><dt>Recipe</dt><dd className="mono">sha256:…</dd></div>
        <div><dt>Mode</dt><dd className="mono">PAPER</dd></div>
      </dl>
      <details className="tp-details">
        <summary>Show every rule and the engine&apos;s wording</summary>
        <p className="tp-engine mono">{tick.reason}</p>
        <ul className="tp-rows">
          {rows.map((row) => (
            <li key={row.stage.stage}>
              <span className="tp-stage mono">{row.stage.label}</span>
              <span className="tp-hooks">{row.hooks.map(({ hook, verdict }) => verdict ? <span key={hook.id} className="tp-hook" data-v={verdict.status}><b>{hook.name}</b> {verdict.status}</span> : null)}</span>
            </li>
          ))}
        </ul>
        {blocked.map((row) => <p className="tp-block" key={row.hook.id}><b className="mono">{row.hook.id}</b>{row.verdict?.reason}</p>)}
      </details>
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/tape">Open the Tape<ArrowUpRight aria-hidden /></Link>
    </div>,
  ];

  return (
    <figure className="dj">
      <PinnedStory id="tape" count={STEPS.length} step={step} onStep={setStep} views={views} beat="30vh">
        {({ go, views: stage }) => (
          <>
            <div className="dj-left">
              <div className="dj-ticks" role="group" aria-label="Pick an illustrative tick">
                {ticks.map((row, i) => (
                  <button type="button" key={row.id} className="dj-entry" aria-pressed={row.id === tick.id} data-action={row.action} onClick={() => setPicked(row.id)}>
                    <span className="dj-entry-top"><span className="dj-tick mono">Tick {i + 1}</span><Chip tone={row.action === "open" ? "azure" : "neutral"}>{row.action}</Chip></span>
                    <span className="dj-entry-line">{row.action === "open" ? "Opened a modeled put" : SHORT[Object.entries(row.verdicts).find(([, verdict]) => verdict.status === "block")?.[0] ?? ""] ?? row.reason}</span>
                  </button>
                ))}
              </div>
              <nav className="ps-nav" aria-label="Path of a decision">
                <ol>
                  {STEPS.map((item, i) => (
                    <li key={item.id} data-state={i === step ? "active" : i < step ? "done" : "next"} data-block={stop === i ? "1" : "0"}>
                      <button type="button" aria-current={i === step ? "step" : undefined} aria-controls={`tape-view-${i}`} onClick={() => go(i)}>
                        <span className="ps-num mono">{i + 1}</span>
                        <span className="ps-title">{item.title}</span>
                      </button>
                      <p className="ps-text">{item.text}</p>
                    </li>
                  ))}
                </ol>
                <div className="ps-progress" aria-hidden="true"><i style={{ transform: `scaleY(${(step + 1) / STEPS.length})` }} /></div>
              </nav>
            </div>
            <div className="dj-right" aria-label={`Tick ${index + 1} decision replay`}>
              <p className="dj-disclose mono"><Chip tone="ember">Illustrative example</Chip>Not a recorded trade. Nothing here came from a real Tape.</p>
              <FlowPath nodes={nodes} active={step} stop={stop} />
              {stage}
            </div>
          </>
        )}
      </PinnedStory>
    </figure>
  );
}
