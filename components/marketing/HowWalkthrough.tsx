"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Pause, Play, Square } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "../app/ui";
import { PinnedStory } from "./PinnedStory";

/* A four-step walkthrough of the real product. Each step shows the screen it leads to, drawn from the app's own
   concepts and classes. Every visual is labeled illustrative and shows no return, balance, trade or market activity. */

const STEPS = [
  { id: "configure", title: "Configure a strategy", text: "Pick Protective Put, choose the rules, and set virtual shares and paper capital. The server validates the recipe.", href: "/agents#configure", cta: "Configure in Agents" },
  { id: "backtest", title: "Backtest its rules", text: "Replay 720 decisions on closed hourly candles with modeled premiums, then compare with holding the stock and flat USD cash.", href: "/lab", cta: "Open the Lab" },
  { id: "paper", title: "Run on paper", text: "Launch attaches the exact backtest. A paper tick evaluates every rule on the latest closed candle.", href: "/agents", cta: "Open Agents" },
  { id: "inspect", title: "Inspect every decision", text: "Optra Tape records each rule's verdict, the data it used and the decision, including the ones to wait.", href: "/tape", cta: "Open the Tape" },
] as const;

function Configure() {
  return (
    <div className="hv-card">
      <div className="hv-fields">
        <div><span>Underlying</span><b>Choose a market</b></div>
        <div><span>Virtual reference shares</span><b className="mono">10</b></div>
        <div><span>Paper capital (USD)</span><b className="mono">100000</b></div>
      </div>
      <p className="hv-strategy"><span className="hv-kicker mono">YOUR STRATEGY</span>Protect 10 shares with a put 7% out of the money, about 30 days out, when volatility is calm.</p>
      <div className="hv-row"><Chip tone="azure">15 rules selected</Chip><Chip>Validated by the server in Forge</Chip></div>
    </div>
  );
}

function Backtest() {
  return (
    <div className="hv-card">
      <div className="hv-strip" aria-hidden="true"><i style={{ flexGrow: 721 }} /><i className="is-dec" style={{ flexGrow: 720 }} /><b /></div>
      <div className="hv-strip-labels mono"><span>721 warmup candles</span><span>720 decisions</span></div>
      <ul className="hv-slots">
        {[["Strategy", "Modeled premiums"], ["Buy and hold", "Price only"], ["Flat USD cash", "No yield"]].map(([label, note]) => <li key={label}><span>{label}<small>{note}</small></span><i /></li>)}
      </ul>
      <p className="hv-note">Results appear only after a complete run in the app. No numbers are shown here.</p>
    </div>
  );
}

function Paper() {
  return (
    <div className="hv-card">
      <ol className="hv-life" aria-label="Agent lifecycle">
        {[["Draft", "Backtest first", false], ["Running", "Paper ticks", true], ["Paused", "Resume any time", false], ["Stopped", "Fork to start again", false]].map(([name, note, on]) => (
          <li key={String(name)} data-on={on ? "1" : "0"}><b>{name}</b><small>{note}</small></li>
        ))}
      </ol>
      <div className="hv-tick">
        <span className="hv-tick-btn" aria-hidden="true"><Play />Run paper tick</span>
        <div className="hv-dots" aria-hidden="true">{Array.from({ length: 15 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 90}ms` }} />)}</div>
      </div>
      <p className="hv-note">One tick evaluates all 15 rules. Orders are modeled paper only, and live trading is disabled.</p>
      <div className="hv-row"><Chip tone="ember">PAPER</Chip><Chip><Pause />Pause</Chip><Chip><Square />Stop</Chip></div>
    </div>
  );
}

function Inspect() {
  return (
    <div className="hv-card">
      <div className="hv-decision"><Chip>skip</Chip><b>Entry blocked by calmo.</b></div>
      <p className="hv-plain">The agent did nothing because volatility was not calm enough to buy protection.</p>
      <ul className="hv-trace">
        {[["Gate", "Sessia", "pass"], ["Gate", "Corpax", "pass"], ["Gate", "Calmo", "block"], ["Breaker", "Haltr", "pass"]].map(([stage, hook, verdict]) => <li key={hook} data-v={verdict}><span className="mono">{stage}</span><b>{hook}</b><span className="mono">{verdict}</span></li>)}
      </ul>
      <p className="hv-note">Illustrative example. Not a recorded trade.</p>
    </div>
  );
}

const VISUAL = { configure: <Configure />, backtest: <Backtest />, paper: <Paper />, inspect: <Inspect /> } as const;

/* A pinned story: the steps on the left, the screen they lead to on the right. Scroll or click; both stay in step. */
export function HowWalkthrough() {
  const [step, setStep] = useState(0);
  const current = STEPS[step] ?? STEPS[0];
  const views = STEPS.map((item) => VISUAL[item.id]);
  return (
    <PinnedStory id="hs" count={STEPS.length} step={step} onStep={setStep} views={views} beat="20vh">
      {({ go, views: stage }) => (
        <>
          <nav className="ps-nav" aria-label="How Optra works">
            <ol>
              {STEPS.map((item, index) => (
                <li key={item.id} data-state={index === step ? "active" : index < step ? "done" : "next"}>
                  <button type="button" aria-current={index === step ? "step" : undefined} aria-controls={`hs-view-${index}`} onClick={() => go(index)}>
                    <span className="ps-num mono">{index + 1}</span>
                    <span className="ps-title">{item.title}</span>
                  </button>
                  <p className="ps-text">{item.text}</p>
                </li>
              ))}
            </ol>
            <div className="ps-progress" aria-hidden="true"><i style={{ transform: `scaleY(${(step + 1) / STEPS.length})` }} /></div>
          </nav>

          <div className="hs-window" role="group" aria-label="Illustrative product screens">
            <div className="hs-bar">
              <span className="hs-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="hs-route mono" key={current.id}>optra.app{current.href.replace("#configure", "")}</span>
              <Chip tone="ember">Illustrative interface</Chip>
            </div>
            {stage}
            <div className="hs-foot">
              <p>{current.text}</p>
              <Link className={buttonVariants({ size: "sm" })} href={current.href}>{current.cta}<ArrowUpRight aria-hidden /></Link>
            </div>
          </div>
        </>
      )}
    </PinnedStory>
  );
}
