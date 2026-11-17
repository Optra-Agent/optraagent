"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { AgentCharacter, characterColor, type StageCharacterId } from "./characters";
import { PinnedStory } from "./PinnedStory";
import type { RiskRail } from "./section-data";

/**
 * The one story the landing tells after the agents: Protective Put, from rules to a reasoned decision, in four steps.
 * The same characters as the hero walk through it. Each step is one picture and one sentence, with a link to the real screen.
 * Every picture is a labeled illustration. None shows a price, a return, a balance or a trade.
 */

type StageNote = { id: StageCharacterId; label: string; line: string };
type Props = { stages: StageNote[]; rails: RiskRail[] };

const STEPS = [
  { id: "build", title: "Build it from rules", text: "Pick Protective Put and click its rules together. The server checks the recipe and refuses anything it cannot run.", href: "/forge", cta: "Open Forge" },
  { id: "backtest", title: "Backtest before anything runs", text: "The Lab replays hourly candles with modeled premiums, then compares the agent with holding the stock and with flat cash. Without a complete backtest, nothing reaches a paper run.", href: "/lab", cta: "Open the Lab" },
  { id: "paper", title: "Run it on paper", text: "A paper tick checks every rule on the latest closed candle. New entries happen only in regular US hours, and five breakers can stop them. Exits keep running.", href: "/agents", cta: "Open Agents" },
  { id: "why", title: "Read why it acted", text: "The Tape records each rule's verdict and the data it used, including the ticks where the agent did nothing.", href: "/tape", cta: "Open the Tape" },
] as const;

/* Where the five rule characters stand around the agent, in percent of the stage. */
const RING: Record<string, [number, number]> = { gate: [20, 24], strike: [80, 24], size: [86, 62], pulse: [50, 90], expiry: [14, 62] };

function Build({ stages }: { stages: StageNote[] }) {
  const ring = stages.filter((stage) => stage.id in RING);
  return (
    <div className="sc-build">
      <svg className="sc-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ring.map((stage, index) => {
          const [x, y] = RING[stage.id] as [number, number];
          return <path key={stage.id} className="sc-line" style={{ "--flow": characterColor(stage.id), "--i": index } as CSSProperties} d={`M50 52 Q${(50 + x) / 2 + (index % 2 ? 4 : -4)} ${(52 + y) / 2} ${x} ${y}`} />;
        })}
      </svg>
      <div className="sc-core" style={{ "--x": "50%", "--y": "50%" } as CSSProperties}>
        <AgentCharacter id="protective_put" size={150} />
        <b>Protective Put</b>
      </div>
      {ring.map((stage, index) => {
        const [x, y] = RING[stage.id] as [number, number];
        return (
          <div key={stage.id} className="sc-stage" style={{ "--x": `${x}%`, "--y": `${y}%`, "--i": index } as CSSProperties}>
            <AgentCharacter id={stage.id} size={78} />
            <b>{stage.label}</b>
            <small>{stage.line}</small>
          </div>
        );
      })}
    </div>
  );
}

function Backtest({ stages }: { stages: StageNote[] }) {
  return (
    <div className="sc-backtest">
      <div className="sc-locked" aria-hidden="true">
        {stages.slice(0, 5).map((stage) => <AgentCharacter key={stage.id} id={stage.id} size={34} live={false} />)}
        <span>Rules locked</span>
      </div>
      <div className="sc-candles" aria-hidden="true"><i style={{ flexGrow: 721 }} /><i className="is-decide" style={{ flexGrow: 720 }} /></div>
      <div className="sc-candle-labels mono"><span>721 warm-up candles</span><span>720 decisions</span></div>
      <ul className="sc-lanes">
        {[["The agent", "Modeled premiums"], ["Buy and hold", "Price only"], ["Flat USD cash", "No yield"]].map(([label, note]) => (
          <li key={label}><span>{label}<small>{note}</small></span><i /></li>
        ))}
      </ul>
      <p className="sc-note">Illustration. Results appear only after a complete run in the app, so no numbers are shown here.</p>
    </div>
  );
}

const DAY = [
  { name: "Overnight", from: 0, to: 4, on: false },
  { name: "Pre-market", from: 4, to: 9.5, on: false },
  { name: "Regular hours", from: 9.5, to: 16, on: true },
  { name: "After-hours", from: 16, to: 20, on: false },
  { name: "Overnight", from: 20, to: 24, on: false },
];

function Paper({ rails }: { rails: RiskRail[] }) {
  return (
    <div className="sc-paper">
      <div className="sc-day" role="img" aria-label="A US trading day in Eastern Time. New entries are allowed only in regular hours, 09:30 to 16:00.">
        {DAY.map((part, index) => (
          <div key={`${part.name}-${index}`} className="sc-part" data-on={part.on ? "1" : "0"} style={{ flexGrow: part.to - part.from }}>
            {part.on ? <AgentCharacter className="sc-awake" id="protective_put" size={64} /> : null}
            <b>{part.name}</b>
            <small>{part.on ? "New entries allowed" : "Entries blocked"}</small>
          </div>
        ))}
      </div>
      <div className="sc-hours mono" aria-hidden="true"><span>00:00</span><span>09:30</span><span>16:00</span><span>24:00</span></div>
      <div className="sc-breakers">
        <AgentCharacter id="breaker" size={52} />
        <div>
          <b>Five breakers watch every tick.</b>
          <p>They stop new entries on a fast price move, a daily loss, a drawdown, too much exposure, or bad data. Exits keep running.</p>
          <ul>{rails.map((rail) => <li key={rail.id}>{rail.name}</li>)}<li>Venux</li></ul>
        </div>
      </div>
      <p className="sc-note">Illustration of a US trading day. Whether the market is open right now is the engine&apos;s call, with holidays and early closes.</p>
    </div>
  );
}

const TICKS = [
  { n: 1, verdict: "skip", title: "Waited: market closed", plain: "The agent did nothing because the session was not regular hours.", trace: [["Gate", "Sessia", "block"], ["Gate", "Calmo", "pass"], ["Breaker", "Haltr", "pass"]] },
  { n: 2, verdict: "skip", title: "Waited: volatility not calm", plain: "The agent did nothing because volatility was not calm enough to buy protection.", trace: [["Gate", "Sessia", "pass"], ["Gate", "Calmo", "block"], ["Breaker", "Haltr", "pass"]] },
  { n: 3, verdict: "open", title: "Opened a modeled put", plain: "Every rule agreed, so the agent bought a modeled put on paper.", trace: [["Gate", "Sessia", "pass"], ["Gate", "Calmo", "pass"], ["Breaker", "Haltr", "pass"]] },
] as const;

function Why() {
  const [pick, setPick] = useState(1);
  const tick = TICKS[pick] ?? TICKS[0];
  return (
    <div className="sc-why">
      <div className="sc-ticks" role="group" aria-label="Three example ticks">
        {TICKS.map((item, index) => (
          <button key={item.n} type="button" aria-pressed={pick === index} data-verdict={item.verdict} onClick={() => setPick(index)}>
            <span className="mono">Tick {item.n}<em>{item.verdict}</em></span>
            <b>{item.title}</b>
          </button>
        ))}
      </div>
      <div className="sc-reason">
        <AgentCharacter id="protective_put" size={88} />
        <div>
          <p className="sc-plain">{tick.plain}</p>
          <ul className="sc-trace">
            {tick.trace.map(([stage, hook, verdict]) => <li key={hook} data-v={verdict}><span className="mono">{stage}</span><b>{hook}</b><span className="mono">{verdict}</span></li>)}
          </ul>
        </div>
      </div>
      <p className="sc-note">Illustrative example. Not a recorded trade, and nothing here came from a real Tape.</p>
    </div>
  );
}

export function StoryScene({ stages, rails }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step] ?? STEPS[0];
  const views: ReactNode[] = [<Build key="b" stages={stages} />, <Backtest key="t" stages={stages} />, <Paper key="p" rails={rails} />, <Why key="w" />];
  return (
    <PinnedStory id="story" count={STEPS.length} step={step} onStep={setStep} views={views} beat="26vh" className="sc">
      {({ go, views: stage }) => (
        <>
          <nav className="ps-nav" aria-label="How Optra works">
            <ol>
              {STEPS.map((item, index) => (
                <li key={item.id} data-state={index === step ? "active" : index < step ? "done" : "next"}>
                  <button type="button" aria-current={index === step ? "step" : undefined} aria-controls={`story-view-${index}`} onClick={() => go(index)}>
                    <span className="ps-num mono">{index + 1}</span>
                    <span className="ps-title">{item.title}</span>
                  </button>
                  <p className="ps-text">{item.text}</p>
                </li>
              ))}
            </ol>
            <div className="ps-progress" aria-hidden="true"><i style={{ transform: `scaleY(${(step + 1) / STEPS.length})` }} /></div>
          </nav>
          <div className="sc-frame">
            {stage}
            <div className="sc-foot">
              <p className="mono">Step {step + 1} of {STEPS.length} · {current.title}</p>
              <Link className={buttonVariants({ size: "sm" })} href={current.href}>{current.cta}</Link>
            </div>
          </div>
        </>
      )}
    </PinnedStory>
  );
}
