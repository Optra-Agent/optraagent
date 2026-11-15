"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Lock, Pause, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PayoffMark } from "../app/agents/TemplateCard";
import { Chip } from "../app/ui";
import { PinnedStory } from "./PinnedStory";
import type { ForgeDemoData } from "./section-data";
import { ForgeWorkflowPreview } from "./ForgeWorkflowPreview";

/* The Forge strategy studio: choose an agent, configure rules, validate, backtest.
   Only the 15 rules that run today are shown by default; the 21 locked rules sit behind one disclosure. The strategy
   preview is written in plain language from the real Protective Put defaults. Remove a rule and the preview shows the
   real validator's message. Nothing is computed locally: messages and the hash were produced by the real validator on
   the server and are looked up by rule. The workflow rail uses the same classes as the real /forge screen. */

export function ForgeDemo({ data }: { data: ForgeDemoData }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(data.required));
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const [agent, setAgent] = useState("protective_put");
  // The demonstration: a short, labeled run that selects the agent, lights its rules stage by stage, validates, and
  // points at Backtest. `tick` is null when the studio is settled (the meaningful default before hydration).
  const rootRef = useRef<HTMLDivElement>(null);
  const [story, setStory] = useState(0);
  const [tick, setTick] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const started = useRef(false);
  const stageCount = data.stages.length;
  const demoPhase = tick === null ? "settled" : tick < 2 ? "agent" : tick < 2 + stageCount ? "rules" : tick < 4 + stageCount ? "validate" : "valid";
  const lit = tick === null ? stageCount : demoPhase === "agent" ? 0 : demoPhase === "rules" ? tick - 1 : stageCount;
  const END = 7 + stageCount;
  const stepTicks = [1, 1 + stageCount, 2 + stageCount, 4 + stageCount, null];
  const stageForTick = (value: number) => value < 2 ? 0 : value < 2 + stageCount ? 1 : value < 4 + stageCount ? 2 : value < 5 + stageCount ? 3 : 4;
  const activeStage = playing && tick !== null ? stageForTick(tick) : story;

  useEffect(() => {
    if (!playing || !inView || tick === null) return;
    const timer = window.setTimeout(() => {
      if (tick >= END) { setStory(4); setTick(null); setPlaying(false); } else setTick(tick + 1);
    }, tick === 0 ? 560 : 760);
    return () => window.clearTimeout(timer);
  }, [playing, inView, tick, END]);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const update = () => setSaveData(Boolean(connection?.saveData));
    update();
    connection?.addEventListener("change", update);
    return () => connection?.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setInView(entry.isIntersecting);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const prefersSaveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
      if (entry.isIntersecting && !started.current && !reduce && !prefersSaveData) {
        started.current = true;
        setOn(new Set(data.required));
        setTick(0);
        setPlaying(true);
      }
    }, { threshold: 0.01, rootMargin: "80px 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, [data.required]);

  // A scroll or direct selection takes over immediately; autoplay never restores edited rules.
  const onStory = (index: number, source: "scroll" | "go") => {
    started.current = true;
    setStory(index);
    if (source === "go") return;
    setPlaying(false);
    setNote(null);
    setTick(stepTicks[index] ?? null);
  };
  const stopAutoplay = () => { started.current = true; setStory(activeStage); setPlaying(false); setTick(null); };
  const markRulesEdited = () => { stopAutoplay(); };
  const replay = () => { started.current = true; setStory(0); setOn(new Set(data.required)); setNote(null); setTick(0); setPlaying(true); };
  const selectStory = (index: number) => {
    started.current = true;
    setPlaying(false);
    setStory(index);
    setNote(null);
    setTick(stepTicks[index] ?? null);
    coreGoRef.current?.(index);
  };

  const issues = [...new Set(data.required.filter((id) => !on.has(id)).flatMap((id) => data.issuesIfRemoved[id] ?? []))];
  const valid = issues.length === 0;
  const lockedCount = data.stages.reduce((total, stage) => total + stage.hooks.filter((hook) => !hook.live).length, 0);
  const inProgress = playing && inView;
  const togglePlayback = () => {
    if (playing) {
      started.current = true;
      setStory(activeStage);
      setPlaying(false);
    } else if (tick === null) replay();
    else { started.current = true; setPlaying(true); }
  };
  const coreGoRef = useRef<((index: number) => void) | null>(null);

  const toggle = (id: string) => {
    markRulesEdited();
    setNote(null);
    setOn((existing) => {
      const next = new Set(existing);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fs" ref={rootRef} data-demo={demoPhase} data-live={inView ? "1" : "0"} data-save-data={saveData ? "1" : "0"}>
      <div className="fs-demo-bar">
        <Chip tone="ember">{inProgress ? "Demonstration running" : "Demonstration"}</Chip>
        <span className="fs-demo-text">A short UI demo of the supported recipe. It runs no backtest and no paper tick.</span>
        <div className="fs-demo-controls" role="group" aria-label="Demonstration controls">
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={togglePlayback} aria-pressed={inProgress}>{inProgress ? <Pause aria-hidden /> : <Play aria-hidden />}{inProgress ? "Pause" : tick === null ? "Play" : "Resume"}</button>
          <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={replay}><RotateCcw aria-hidden />Replay</button>
        </div>
      </div>
      <div className="fs-studio">
        <div className="fs-top">
          <div className="fs-agents" role="group" aria-label="House Agent">
            {data.agents.map((row) => (
              <button type="button" key={row.id} className="fs-agent" aria-pressed={agent === row.id} data-ready={row.ready ? "1" : "0"} onClick={() => { stopAutoplay(); if (row.ready) { setAgent(row.id); setNote(null); } else setNote({ title: `${row.name} is not available.`, text: row.reason }); }}>
                <PayoffMark id={row.id} ready={row.ready} size="sm" />
                <span><b>{row.name}</b><small>{row.ready ? "Can be built" : "Locked"}</small></span>
                {row.ready ? null : <Lock aria-hidden />}
              </button>
            ))}
          </div>
          <p className="fs-ai"><Chip>Coming soon</Chip> Describe a strategy in words. No AI provider is configured, so rules are chosen by clicking.</p>
        </div>

        <PinnedStory id="forge-core" count={5} step={story} onStep={onStory} variant="stack" beat="32vh" className="fs-story" goRef={coreGoRef}>
          {() => <ForgeWorkflowPreview data={data} agent={agent} selected={on} valid={valid} issues={issues} activeStage={activeStage} autoPlaying={inProgress} onSelectStage={selectStory} onToggleRule={toggle} />}
        </PinnedStory>

        <div className="fs-grid">
          <section className="fs-rules" aria-labelledby="fs-rules-title">
            <h3 id="fs-rules-title">Rules</h3>
            <p className="fs-sub">Each stage answers one question. Turn a rule off to see what the validator says.</p>
            <div className="fs-groups">
              {data.stages.map((stage) => {
                const live = stage.hooks.filter((hook) => hook.live);
                return (
                  <div className="fs-group" key={stage.stage} data-risk={stage.stage === "breaker" ? "1" : "0"} data-lit={data.stages.indexOf(stage) < lit ? "1" : "0"} data-now={tick !== null && demoPhase === "rules" && data.stages.indexOf(stage) === lit - 1 ? "1" : "0"}>
                    <div className="fs-group-head"><span className="fs-group-name mono">{stage.label}</span><span className="fs-group-q">{stage.question}</span></div>
                    <ul>
                      {live.map((hook) => (
                        <li key={hook.id}><button type="button" className="fd-chip" aria-pressed={on.has(hook.id)} onClick={() => toggle(hook.id)}>{hook.name}</button></li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <details className="fs-locked" onToggle={stopAutoplay}>
              <summary><ChevronDown aria-hidden />Show the {lockedCount} locked rules</summary>
              <div className="fs-locked-body">
                {data.stages.map((stage) => {
                  const locked = stage.hooks.filter((hook) => !hook.live);
                  if (locked.length === 0) return null;
                  return (
                    <div className="fs-group" key={stage.stage}>
                      <div className="fs-group-head"><span className="fs-group-name mono">{stage.label}</span></div>
                      <ul>
                        {locked.map((hook) => (
                          <li key={hook.id}>
                            <button type="button" className="fd-chip is-locked" aria-pressed={note?.title === `${hook.name} is locked.`} onClick={() => { stopAutoplay(); setNote(note?.title === `${hook.name} is locked.` ? null : { title: `${hook.name} is locked.`, text: hook.reason }); }}>
                              {hook.name}<span className="sr-only"> (catalog only, locked)</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </details>
            <p className="fs-note" role="status">{note ? <><b>{note.title}</b> {note.text}</> : null}</p>
          </section>

          <aside className="fs-preview" data-valid={valid ? "1" : "0"} aria-labelledby="fs-preview-title">
            <p className="fs-kicker mono">YOUR STRATEGY</p>
            <h3 id="fs-preview-title">Protective Put</h3>
            <div className="fs-status" role="status">
              {demoPhase === "agent" || demoPhase === "rules" ? <Chip>Building</Chip> : demoPhase === "validate" ? <Chip tone="azure">Validating…</Chip> : <Chip tone={valid ? "azure" : "ember"}>{valid ? "Valid" : "Blocked"}</Chip>}
              <span className="mono">{on.size} of {data.required.length} rules</span>
            </div>
            <ol className="fs-lines">
              {data.stages.map((stage, index) => {
                const chosen = stage.hooks.filter((hook) => hook.live && on.has(hook.id));
                return (
                  <li key={stage.stage} data-risk={stage.stage === "breaker" ? "1" : "0"} data-empty={chosen.length === 0 ? "1" : "0"} data-lit={index < lit ? "1" : "0"} data-current={tick !== null && demoPhase === "rules" && index === lit - 1 ? "1" : "0"}>
                    <span className="fs-line-stage mono">{stage.label}</span>
                    <span className="fs-line-text">{chosen.length ? chosen.map((hook) => hook.line).join(". ") : "No rule yet"}</span>
                  </li>
                );
              })}
            </ol>
            {valid ? null : (
              <ul className="fs-issues" aria-label="Validation issues">
                {issues.map((issue) => <li key={issue}><TriangleAlert aria-hidden />{issue}</li>)}
              </ul>
            )}
            <div className="fs-next" data-point={demoPhase === "valid" ? "1" : "0"}>
              <Link className={cn(buttonVariants({ size: "sm" }), !valid && "fd-disabled")} href="/lab" aria-disabled={!valid}>Backtest in Lab<ArrowUpRight aria-hidden /></Link>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/forge">Open Forge</Link>
              <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => { stopAutoplay(); setOn(new Set(data.required)); setNote(null); }} disabled={valid}>Restore recipe</button>
            </div>
            <details className="fs-tech" onToggle={stopAutoplay}>
              <summary>Technical details</summary>
              {valid ? <p className="mono" aria-label="Recipe hash">{data.validHash.slice(0, 23)}…</p> : <p>No hash is issued while the recipe is blocked.</p>}
              <p>The server issues a canonical hash once a recipe validates. This is the hash of the default recipe with example inputs.</p>
            </details>
          </aside>
        </div>
      </div>
    </div>
  );
}
