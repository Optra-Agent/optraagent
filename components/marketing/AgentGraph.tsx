"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import { FLOW_STEPS, STEP_LABEL } from "./graph-flow";
import type { FlowScenario, FlowStep, Verdict } from "./graph-flow";
import type { GraphAgent, GraphData, GraphHook, GraphStage } from "./graph-data";

/* The Optra Agent Intelligence Graph.
   One SVG canvas (viewBox units, so it scales as a whole), HTML for the detail panel.
   Nodes are persistent: selection only changes data attributes, and CSS transitions move, fade and draw them.
   No physics, no canvas, no animation library, no per-frame JavaScript. Idle motion is a few CSS dash pulses. */

type AgentId = GraphAgent["id"];
type Selection = { kind: "stage"; id: string } | { kind: "hook"; id: string } | null;

const W = 1000;
const H = 520;
const COL = [330, 470, 610, 750, 890];
const STAGE_Y = 120;
const HOOK_Y0 = 200;
const HOOK_DY = 38;
const BAND = { x: 210, y: 322, w: 752, h: 90 };
const BREAKER_Y = 384;
const DECISION = { x: 500, y: 468 };
const TAPE = { x: 780, y: 468 };

const OVERVIEW: Record<AgentId, { x: number; y: number }> = {
  protective_put: { x: 210, y: 150 },
  covered_call: { x: 790, y: 150 },
  cash_secured_put: { x: 210, y: 370 },
  earnings_straddle: { x: 790, y: 370 },
};
const HUB = { x: 500, y: 260 };
const FOCUS = { x: 100, y: STAGE_Y };
const DOCK: Record<Exclude<AgentId, "protective_put">, { x: number; y: number }> = {
  covered_call: { x: 100, y: 214 },
  cash_secured_put: { x: 100, y: 258 },
  earnings_straddle: { x: 100, y: 302 },
};

/** Payoff-diagram glyphs: the shape of each strategy's profit and loss at expiry (flat floor, capped gain, V). */
const PAYOFF: Record<AgentId, string> = {
  protective_put: "M2 22 H12 L36 4",
  covered_call: "M2 24 L22 6 H36",
  cash_secured_put: "M2 22 L14 10 H36",
  earnings_straddle: "M2 4 L19 24 L36 4",
};

const at = (delay: number): CSSProperties => ({ "--d": `${delay}ms` }) as CSSProperties;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Glyph({ id, x = 0, y = 0 }: { id: AgentId; x?: number; y?: number }) {
  return (
    <g className="gx-glyph" transform={`translate(${x} ${y})`} aria-hidden="true">
      <path d={PAYOFF[id]} />
    </g>
  );
}

function Edge({ d, show, delay = 0, kind = "solid", pulse, hot, done, dim }: { d: string; show: boolean; delay?: number; kind?: "solid" | "dashed" | "guard"; pulse?: { name: string; delay: number }; hot?: boolean; done?: boolean; dim?: boolean }) {
  return (
    <g className="gx-edge" data-kind={kind} data-show={show ? "1" : "0"} data-hot={hot ? "1" : "0"} data-done={done ? "1" : "0"} data-dim={dim ? "1" : "0"} style={at(delay)} aria-hidden="true">
      <path className="gx-line" d={d} pathLength={kind === "solid" ? 1 : undefined} />
      {pulse && show ? <path className={`gx-pulse gx-pulse-${pulse.name}`} d={d} pathLength={1} style={{ animationDelay: `calc(var(--d, 0ms) + ${700 + pulse.delay}ms)` }} /> : null}
    </g>
  );
}

type NodeProps = {
  x: number;
  y: number;
  show: boolean;
  delay?: number;
  scale?: number;
  className?: string;
  label?: string;
  pressed?: boolean;
  onActivate?: () => void;
  state?: Record<string, string | undefined>;
  children: ReactNode;
};

function Node({ x, y, show, delay = 0, scale = 1, className, label, pressed, onActivate, state, children }: NodeProps) {
  const interactive = Boolean(onActivate);
  const onKey = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate?.();
    }
  };
  const data = Object.fromEntries(Object.entries(state ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [`data-${key}`, value]));
  return (
    <g
      className={cn("gx-n", interactive && "gx-btn", className)}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      data-show={show ? "1" : "0"}
      {...data}
      {...(interactive ? { role: "button", tabIndex: show ? 0 : -1, "aria-label": label, "aria-pressed": pressed, onClick: onActivate, onKeyDown: onKey } : {})}
    >
      <g className="gx-in" style={at(delay)}>
        <g className="gx-s" style={{ transform: `scale(${scale})` }}>{children}</g>
      </g>
    </g>
  );
}

/* ───────────── Panel ───────────── */

const verdictTone: Record<Verdict, Tone> = { pass: "azure", select: "azure", size: "azure", action: "azure", block: "ember", noop: "neutral" };

function HookOutput({ hook }: { hook: GraphHook }) {
  const { example } = hook;
  return (
    <div className="gx-out" role="group" aria-label="Illustrative evaluation output">
      <p className="gx-out-label">Illustrative output. Example values, not a recorded decision.</p>
      <div className="gx-out-row">
        <span className="gx-out-stage mono">{hook.stage}</span>
        <b className="mono">{hook.id}</b>
        <Chip tone={verdictTone[example.status]}>{example.status}</Chip>
      </div>
      <p className="gx-out-reason">{example.reason}</p>
      {example.value !== undefined || example.threshold !== undefined ? (
        <p className="gx-out-meta mono">
          {example.value !== undefined ? `value ${example.value}${example.unit ? ` ${example.unit}` : ""}` : ""}
          {example.value !== undefined && example.threshold !== undefined ? " · " : ""}
          {example.threshold !== undefined ? `limit ${example.threshold}${example.value === undefined && example.unit ? ` ${example.unit}` : ""}` : ""}
        </p>
      ) : null}
    </div>
  );
}

type Controller = {
  data: GraphData;
  agent: AgentId | null;
  sel: Selection;
  flow: FlowScenario | null;
  step: number;
  playing: boolean;
  scenarios: FlowScenario[];
  pickAgent: (id: AgentId) => void;
  pickStage: (id: string) => void;
  pickHook: (id: string) => void;
  startFlow: (scenario: FlowScenario) => void;
  stepFlow: () => void;
  closeFlow: () => void;
  back: () => void;
};

function Panel({ c }: { c: Controller }) {
  const { data, agent, sel, flow } = c;
  const allHooks = [...data.stages.flatMap((stage) => stage.hooks), ...data.breaker.hooks];
  const selectedAgent = data.agents.find((row) => row.id === agent) ?? null;

  if (flow && selectedAgent) return <FlowPanel c={c} scenario={flow} />;

  if (sel?.kind === "hook") {
    const hook = allHooks.find((row) => row.id === sel.id);
    if (hook) {
      return (
        <div className="gx-card" key={`hook-${hook.id}`}>
          <p className="gx-kicker mono">{hook.stage} hook</p>
          <h3>{hook.name}</h3>
          <div className="gx-chips"><Chip tone="azure">Implemented</Chip><Chip>{selectedAgent?.name} recipe</Chip></div>
          <p className="gx-lead">{hook.summary}</p>
          {hook.params.length ? (
            <dl className="gx-params" aria-label={`${hook.name} parameters in this recipe`}>
              {hook.params.map((param) => <div key={param.key}><dt className="mono">{param.key}</dt><dd className="mono">{param.value}</dd></div>)}
            </dl>
          ) : null}
          <HookOutput hook={hook} />
          {hook.note ? <p className="gx-note">{hook.note}</p> : null}
        </div>
      );
    }
  }

  if (sel?.kind === "stage") {
    const stage = [...data.stages, data.breaker].find((row) => row.stage === sel.id);
    if (stage) {
      const locked = stage.total - stage.live;
      return (
        <div className="gx-card" key={`stage-${stage.stage}`}>
          <p className="gx-kicker mono">{stage.stage === "breaker" ? "Risk guard" : "Stage"}</p>
          <h3>{stage.label}</h3>
          <p className="gx-lead">{stage.question}{stage.stage === "breaker" ? " It checks every tick and can stop new entries. Exits keep running." : ""}</p>
          <div className="gx-chips"><Chip tone="azure">{stage.live} of {stage.total} implemented</Chip>{locked > 0 ? <Chip>{locked} catalog only</Chip> : null}</div>
          <p className="gx-label">Used by this recipe</p>
          <ul className="gx-hooklist">{stage.hooks.map((hook) => <li key={hook.id}><b>{hook.name}</b><span>{hook.summary}</span></li>)}</ul>
        </div>
      );
    }
  }

  if (selectedAgent?.ready) {
    return (
      <div className="gx-card" key="agent-pp">
        <p className="gx-kicker mono">House Agent</p>
        <h3>{selectedAgent.name}</h3>
        <div className="gx-chips"><Chip tone="azure">Paper ready</Chip><Chip tone="ember">Modeled premiums</Chip></div>
        <p className="gx-lead">{selectedAgent.summary}</p>
        <dl className="gx-facts">
          <div><dt>Hooks used</dt><dd className="mono">{data.stages.reduce((n, s) => n + s.hooks.length, 0) + data.breaker.hooks.length} of {data.hookTotal}</dd></div>
          <div><dt>Stages</dt><dd className="mono">6</dd></div>
        </dl>
        <p className="gx-hint">Select a stage or a hook to read its rule. The Breaker runs beneath all of them.</p>
        <div className="gx-actions">
          <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => c.startFlow(c.scenarios[0]!)}>View decision flow</button>
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/agents#configure">Configure this agent</Link>
          <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={c.back}>Back to overview</button>
        </div>
      </div>
    );
  }

  if (selectedAgent) {
    return (
      <div className="gx-card" key={`agent-${selectedAgent.id}`}>
        <p className="gx-kicker mono">House Agent</p>
        <h3>{selectedAgent.name}</h3>
        <div className="gx-chips"><Chip>Preview</Chip><Chip>Not yet available</Chip></div>
        <p className="gx-lead">{selectedAgent.summary}</p>
        <p className="gx-note">{selectedAgent.reason}</p>
        <p className="gx-hint">No recipe exists for this agent, so there is no hook graph to expand. It cannot be created until its venue and data requirements are verified.</p>
        <div className="gx-actions">
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={c.back}>Back to overview</button>
        </div>
      </div>
    );
  }

  return (
    <div className="gx-card" key="overview">
      <p className="gx-kicker mono">Optra Agent</p>
      <h3>Pick an agent to see how it decides.</h3>
      <p className="gx-lead">Every House Agent is a recipe of hooks. Each tick the engine runs the rules, checks risk, records a paper decision and writes it to Optra Tape.</p>
      <ul className="gx-roster" aria-label="House Agents">
        {data.agents.map((row) => (
          <li key={row.id}>
            <button type="button" onClick={() => c.pickAgent(row.id)} aria-pressed={agent === row.id}>
              <svg className="gx-roster-glyph" data-ready={row.ready ? "1" : "0"} viewBox="0 0 38 28" aria-hidden="true"><path d={PAYOFF[row.id]} /></svg>
              <span>{row.name}</span>
              <Chip tone={row.ready ? "azure" : "neutral"}>{row.ready ? "Paper ready" : "Preview"}</Chip>
            </button>
          </li>
        ))}
      </ul>
      <p className="gx-note">Only Protective Put can be created today. The others stay in Preview and never appear paper ready.</p>
    </div>
  );
}

function FlowPanel({ c, scenario }: { c: Controller; scenario: FlowScenario }) {
  const { data, step } = c;
  const done = step >= FLOW_STEPS.length - 1;
  const stageByStep = (name: FlowStep): GraphStage | undefined => [...data.stages, data.breaker].find((row) => row.stage === name);
  return (
    <div className="gx-card" key="flow">
      <p className="gx-kicker mono">Decision flow</p>
      <h3>{scenario.source === "recorded" ? "A recorded decision" : "How one tick becomes a decision"}</h3>
      <div className="gx-chips">
        <Chip tone={scenario.source === "recorded" ? "azure" : "ember"}>{scenario.source === "recorded" ? "Public Tape record" : "Illustrative example"}</Chip>
        <Chip>Paper</Chip>
      </div>
      <div className="gx-seg" role="group" aria-label="Example">
        {c.scenarios.map((row) => (
          <button key={row.id} type="button" aria-pressed={row.id === scenario.id} onClick={() => c.startFlow(row)}>{row.label}</button>
        ))}
      </div>
      <ol className="gx-steps" aria-label="Evaluation order">
        {FLOW_STEPS.map((name, index) => {
          const reached = step >= index;
          const stage = stageByStep(name);
          const state = step === index ? "active" : reached ? "done" : "pending";
          return (
            <li key={name} data-state={state}>
              <p className="gx-step-title">{STEP_LABEL[name]}</p>
              {reached && stage ? (
                <ul className="gx-step-hooks">
                  {stage.hooks.map((hook) => {
                    const verdict = scenario.verdicts[hook.id];
                    if (!verdict) return null;
                    return (
                      <li key={hook.id}>
                        <b>{hook.name}</b> <Chip tone={verdictTone[verdict.status]}>{verdict.status}</Chip>
                        {verdict.status === "block" ? <span className="gx-step-why">{verdict.reason}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {reached && name === "decision" ? (
                <p className="gx-step-result"><Chip tone={scenario.action === "open" ? "azure" : "neutral"}>{scenario.action}</Chip> {scenario.reason}</p>
              ) : null}
              {reached && name === "tape" ? <p className="gx-step-why">The decision, every hook verdict and the recipe hash are appended to the agent&apos;s Tape.</p> : null}
            </li>
          );
        })}
      </ol>
      <p className="gx-note">
        {scenario.source === "recorded" ? "From the public Tape." : "Illustrative example. Not a recorded trade, and nothing is sent onchain."} The engine evaluates every hook each tick and combines the verdicts: any Gate or Breaker block stops a new entry.
      </p>
      <div className="gx-actions">
        <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => c.startFlow(scenario)}>Replay</button>
        {!done && !c.playing ? <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={c.stepFlow}>Next step</button> : null}
        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={c.closeFlow}>Close flow</button>
      </div>
    </div>
  );
}

/* ───────────── Canvas ───────────── */

function Hub({ expanded }: { expanded: boolean }) {
  return (
    <Node x={expanded ? FOCUS.x : HUB.x} y={expanded ? 36 : HUB.y} show scale={expanded ? 0.5 : 1.15} className="gx-hubnode">
      <circle className="gx-hub-ring" r="42" />
      <circle className="gx-hub" r="34" />
      <g className="gx-mark" aria-hidden="true">
        <circle r="13" />
        <path d="M-22 0 H22" />
        <circle className="gx-mark-dot" cx="13" r="3.4" />
      </g>
      <text className="gx-hub-label" y="64" textAnchor="middle" data-hide={expanded ? "1" : "0"}>OPTRA</text>
    </Node>
  );
}

export type GraphProps = { data: GraphData; recorded?: FlowScenario | null; initialAgent?: AgentId | null };

export function AgentGraph({ data, recorded = null, initialAgent = null }: GraphProps) {
  const [agent, setAgent] = useState<AgentId | null>(initialAgent);
  const [sel, setSel] = useState<Selection>(null);
  const [flow, setFlow] = useState<FlowScenario | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [touched, setTouched] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The recorded scenario only exists when the public Tape returned a record.
  const scenarios = recorded ? [...data.scenarios, recorded] : data.scenarios;

  const expanded = agent === "protective_put";

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setStep((value) => {
        if (value >= FLOW_STEPS.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, step === 0 ? 650 : 1050);
    return () => window.clearTimeout(timer);
  }, [playing, step]);

  // Idle pulses only run while the graph is on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { root.dataset.live = entry?.isIntersecting ? "1" : "0"; }, { rootMargin: "80px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const reveal = () => {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 859px)").matches) return;
    window.requestAnimationFrame(() => {
      const box = panelRef.current?.getBoundingClientRect();
      if (box && (box.top > window.innerHeight * 0.7 || box.bottom < 0)) panelRef.current?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    });
  };

  const c: Controller = {
    data,
    agent,
    sel,
    flow,
    step,
    playing,
    scenarios,
    pickAgent(id) {
      setTouched(true);
      if (id === agent && !sel && !flow) {
        setAgent(null);
        return;
      }
      setAgent(id);
      setSel(null);
      setFlow(null);
      setPlaying(false);
      reveal();
    },
    pickStage(id) {
      setSel((current) => (current?.kind === "stage" && current.id === id ? null : { kind: "stage", id }));
      setFlow(null);
      reveal();
    },
    pickHook(id) {
      setSel((current) => (current?.kind === "hook" && current.id === id ? null : { kind: "hook", id }));
      setFlow(null);
      reveal();
    },
    startFlow(scenario) {
      setFlow(scenario);
      setSel(null);
      if (reduced()) {
        setStep(FLOW_STEPS.length - 1);
        setPlaying(false);
      } else {
        setStep(0);
        setPlaying(true);
      }
      reveal();
    },
    stepFlow() {
      setStep((value) => Math.min(FLOW_STEPS.length - 1, value + 1));
    },
    closeFlow() {
      setFlow(null);
      setPlaying(false);
    },
    back() {
      setPlaying(false);
      if (flow) setFlow(null);
      else if (sel) setSel(null);
      else setAgent(null);
    },
  };

  const onRootKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && (agent || sel || flow)) {
      event.stopPropagation();
      c.back();
    }
  };

  const allHooks = [...data.stages.flatMap((stage) => stage.hooks), ...data.breaker.hooks];
  const selHook = sel?.kind === "hook" ? allHooks.find((hook) => hook.id === sel.id) : undefined;
  const selStage = sel?.kind === "stage" ? sel.id : selHook?.stage;
  const flowOn = flow !== null && expanded;

  const stageStep = (stage: string) => FLOW_STEPS.indexOf(stage as FlowStep);
  const revealed = (stage: string) => flowOn && step >= stageStep(stage);
  const activeStage = (stage: string) => flowOn && step === stageStep(stage);
  const dimStage = (stage: string) => (flowOn ? !revealed(stage) : selStage !== undefined && selStage !== stage);
  const verdictOf = (hook: GraphHook): Verdict | undefined => (revealed(hook.stage) ? flow?.verdicts[hook.id]?.status : undefined);

  const crumb: { label: string; onClick?: () => void }[] = [{ label: "Agents", onClick: agent ? () => { setAgent(null); setSel(null); setFlow(null); setPlaying(false); } : undefined }];
  const agentRow = data.agents.find((row) => row.id === agent);
  if (agentRow) crumb.push({ label: agentRow.name, onClick: sel || flow ? () => { setSel(null); setFlow(null); setPlaying(false); } : undefined });
  if (flow) crumb.push({ label: "Decision flow" });
  else if (selHook) crumb.push({ label: selHook.name });
  else if (sel?.kind === "stage") crumb.push({ label: `${sel.id.charAt(0).toUpperCase()}${sel.id.slice(1)}` });

  const statusText = flow
    ? `Decision flow, step ${step + 1} of ${FLOW_STEPS.length}: ${STEP_LABEL[FLOW_STEPS[step] ?? "gate"]}.${step >= FLOW_STEPS.length - 1 ? ` Result: ${flow.action}. ${flow.reason}` : ""}`
    : selHook ? `${selHook.name} selected. ${selHook.summary}`
    : sel?.kind === "stage" ? `${sel.id} stage selected.`
    : agentRow ? `${agentRow.name} selected. ${agentRow.ready ? "Paper ready. Hook stages shown." : "Preview. Not yet available."}`
    : "Overview of four House Agents.";

  /* Nodes that exist only when Protective Put is expanded appear in a short sequence: stages left to right, then their hooks. */
  const stageDelay = (index: number) => 220 + index * 90;
  const hookDelay = (stageIndex: number, hookIndex: number) => 520 + stageIndex * 90 + hookIndex * 70;

  const hookPos = (stageIndex: number, hookIndex: number) => ({ x: COL[stageIndex]! + 8, y: HOOK_Y0 + hookIndex * HOOK_DY });
  const breakerPos = (index: number) => ({ x: COL[index]! + 8, y: BREAKER_Y });

  const handOffs = COL.slice(0, 4).map((x, index) => `M${x + 54} ${STAGE_Y} H${COL[index + 1]! - 54}`);

  return (
    <div ref={rootRef} className="gx" data-agent={agent ?? "none"} data-expanded={expanded ? "1" : "0"} data-flow={flowOn ? "1" : "0"} data-touched={touched ? "1" : "0"} data-live="1" onKeyDown={onRootKey}>
      <p className="sr-only" role="status">{statusText}</p>
      <div className="gx-bar">
        <nav aria-label="Graph location">
          <ol className="gx-crumbs">
            {crumb.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.onClick ? <button type="button" onClick={item.onClick}>{item.label}</button> : <span aria-current={index === crumb.length - 1 ? "step" : undefined}>{item.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        <ul className="gx-legend" aria-label="Legend">
          <li><i className="k-rule" />Rule path</li>
          <li><i className="k-risk" />Breaker guard</li>
          <li><i className="k-off" />Not yet available</li>
        </ul>
      </div>

      <div className="gx-body">
        <div className="gx-canvas">
          <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Optra Agent graph. Four House Agents; Protective Put expands into six hook stages." preserveAspectRatio="xMidYMid meet">
            {/* Edges first, so every node sits on top of its connections. */}
            <Edge d={`M${HUB.x} ${HUB.y} L${OVERVIEW.protective_put.x} ${OVERVIEW.protective_put.y}`} show={!expanded} delay={80} pulse={{ name: "slow", delay: 0 }} hot={agent === "protective_put"} />
            {(["covered_call", "cash_secured_put", "earnings_straddle"] as const).map((id, index) => (
              <Edge key={id} d={`M${HUB.x} ${HUB.y} L${OVERVIEW[id].x} ${OVERVIEW[id].y}`} show={!expanded} kind="dashed" delay={160 + index * 70} hot={agent === id} />
            ))}

            <Edge d={`M${FOCUS.x} 54 V86`} show={expanded} delay={80} />
            <Edge d={`M${FOCUS.x + 86} ${STAGE_Y} H${COL[0]! - 54}`} show={expanded} delay={260} pulse={{ name: "walk", delay: 0 }} done={flowOn && step >= 0} dim={dimStage("gate")} />
            {handOffs.map((d, index) => (
              <Edge key={d} d={d} show={expanded} delay={340 + index * 90} pulse={{ name: "walk", delay: (index + 1) * 600 }} done={flowOn && step > index} dim={flowOn ? step <= index : selStage !== undefined} />
            ))}
            <Edge d={`M${COL[4]! + 54} ${STAGE_Y} H972 V${BREAKER_Y} H${BAND.x + BAND.w}`} show={expanded} delay={760} pulse={{ name: "walk", delay: 3000 }} done={flowOn && step >= 4} dim={flowOn ? step < 4 : selStage !== undefined} />

            {data.stages.map((stage, si) => stage.hooks.map((hook, hi) => {
              const pos = hookPos(si, hi);
              return <Edge key={`b-${hook.id}`} d={`M${COL[si]! - 52} ${STAGE_Y + 28} V${pos.y} H${pos.x - 48}`} show={expanded} delay={hookDelay(si, hi) - 120} hot={selHook?.id === hook.id} pulse={selHook?.id === hook.id ? { name: "branch", delay: 0 } : undefined} dim={flowOn ? !revealed(stage.stage) : selStage !== undefined && selHook?.id !== hook.id && selStage !== stage.stage} />;
            }))}

            {[228, 400, 540, 680, 820].map((x, index) => (
              <Edge key={x} d={`M${x} ${BAND.y} V${STAGE_Y + 4}`} show={expanded} kind="guard" delay={820 + index * 70} hot={selStage === "breaker"} dim={flowOn ? step < 5 : selStage !== undefined && selStage !== "breaker"} />
            ))}
            <Edge d={`M${DECISION.x} ${BAND.y + BAND.h} V${DECISION.y - 23}`} show={expanded} delay={1100} done={flowOn && step >= 6} />
            <Edge d={`M${DECISION.x + 100} ${DECISION.y} H${TAPE.x - 100}`} show={expanded} delay={1180} done={flowOn && step >= 7} />

            {/* Breaker band: a guard layer, not a final step. */}
            <Node x={0} y={0} show={expanded} delay={700} className={cn("gx-bandnode")} state={{ dim: dimStage("breaker") ? "1" : "0", active: activeStage("breaker") || selStage === "breaker" ? "1" : "0" }}>
              <rect className="gx-band" x={BAND.x} y={BAND.y} width={BAND.w} height={BAND.h} rx="12" />
              <text className="gx-band-title" x={BAND.x + 16} y={BAND.y + 22}>BREAKER</text>
              <text className="gx-band-sub" x={BAND.x + 88} y={BAND.y + 22}>Risk check. Always on. Can stop new entries at every hand-off.</text>
            </Node>

            {/* Hub and agents */}
            <Hub expanded={expanded} />

            {data.agents.map((row) => {
              const isFocus = expanded && row.id === "protective_put";
              const pos = row.id === "protective_put" ? (expanded ? FOCUS : OVERVIEW.protective_put) : OVERVIEW[row.id];
              const showFull = row.id === "protective_put" || !expanded;
              return (
                <Node
                  key={row.id}
                  x={pos.x}
                  y={pos.y}
                  show={showFull}
                  scale={isFocus ? 0.9 : expanded ? 1 : 1.2}
                  className={cn("gx-agent", row.ready ? "is-ready" : "is-preview")}
                  label={`${row.name}. ${row.ready ? "Paper ready. Show its hook stages." : "Preview, not yet available. Show details."}`}
                  pressed={agent === row.id}
                  onActivate={() => c.pickAgent(row.id)}
                  state={{ active: agent === row.id ? "1" : "0", dim: agent && agent !== row.id && !expanded ? "1" : "0" }}
                >
                  <rect className="gx-box" x="-95" y="-39" width="190" height="78" rx="11" />
                  <rect className="gx-focus" x="-100" y="-44" width="200" height="88" rx="14" />
                  {row.ready && !touched ? <rect className="gx-invite" x="-100" y="-44" width="200" height="88" rx="14" /> : null}
                  <Glyph id={row.id} x={-82} y={-14} />
                  <text className="gx-name" x="-34" y="-9">{row.name}</text>
                  <text className={cn("gx-tag mono", row.ready ? "is-ready" : "")} x="-34" y="8">{row.ready ? "PAPER READY" : "PREVIEW"}</text>
                  <text className="gx-sub" x="-34" y="26">{row.ready ? `${data.stages.reduce((n, s) => n + s.hooks.length, 0) + data.breaker.hooks.length} hooks · paper only` : "Not yet available"}</text>
                </Node>
              );
            })}

            {/* Docked agents while Protective Put is expanded */}
            <text className="gx-dock-label" x={FOCUS.x} y={186} textAnchor="middle" data-show={expanded ? "1" : "0"}>OTHER HOUSE AGENTS</text>
            {(["covered_call", "cash_secured_put", "earnings_straddle"] as const).map((id, index) => {
              const row = data.agents.find((item) => item.id === id)!;
              return (
                <Node key={`dock-${id}`} x={DOCK[id].x} y={DOCK[id].y} show={expanded} delay={200 + index * 60} className="gx-agent gx-dock is-preview" label={`${row.name}. Preview, not yet available. Show details.`} pressed={agent === id} onActivate={() => c.pickAgent(id)} state={{ active: agent === id ? "1" : "0" }}>
                  <rect className="gx-box" x="-75" y="-18" width="150" height="36" rx="9" />
                  <rect className="gx-focus" x="-79" y="-22" width="158" height="44" rx="11" />
                  <Glyph id={id} x={-66} y={-10} />
                  <text className="gx-name sm" x={-22} y="4">{row.name}</text>
                </Node>
              );
            })}

            {/* Stages */}
            {data.stages.map((stage, index) => (
              <Node
                key={stage.stage}
                x={COL[index]!}
                y={STAGE_Y}
                show={expanded}
                delay={stageDelay(index)}
                className="gx-stage"
                label={`${stage.label} stage. ${stage.live} of ${stage.total} hooks implemented. Show details.`}
                pressed={sel?.kind === "stage" && sel.id === stage.stage}
                onActivate={() => c.pickStage(stage.stage)}
                state={{ dim: dimStage(stage.stage) ? "1" : "0", active: activeStage(stage.stage) || (selStage === stage.stage) ? "1" : "0" }}
              >
                <rect className="gx-box" x="-54" y="-28" width="108" height="56" rx="10" />
                <rect className="gx-focus" x="-58" y="-32" width="116" height="64" rx="13" />
                <text className="gx-stage-name mono" y="-5" textAnchor="middle">{stage.label.toUpperCase()}</text>
                <text className="gx-stage-count mono" y="14" textAnchor="middle">{stage.live} of {stage.total}</text>
              </Node>
            ))}

            {/* Hooks of the five stages */}
            {data.stages.map((stage, si) => stage.hooks.map((hook, hi) => {
              const pos = hookPos(si, hi);
              const verdict = verdictOf(hook);
              return (
                <Node
                  key={hook.id}
                  x={pos.x}
                  y={pos.y}
                  show={expanded}
                  delay={hookDelay(si, hi)}
                  className="gx-hook"
                  label={`${hook.name}, ${stage.label} hook, implemented. Show its rule.`}
                  pressed={selHook?.id === hook.id}
                  onActivate={() => c.pickHook(hook.id)}
                  state={{ active: selHook?.id === hook.id ? "1" : "0", dim: flowOn ? (revealed(hook.stage) ? "0" : "1") : selStage !== undefined && selStage !== hook.stage && selHook?.id !== hook.id ? "1" : selHook && selHook.id !== hook.id ? "1" : "0", verdict }}
                >
                  <rect className="gx-box" x="-48" y="-15" width="96" height="30" rx="7" />
                  <rect className="gx-focus" x="-52" y="-19" width="104" height="38" rx="10" />
                  <circle className="gx-dot" cx="-36" cy="0" r="3.5" />
                  <text className="gx-hook-name" x="-26" y="4">{hook.name}</text>
                </Node>
              );
            }))}

            {/* Breaker hooks */}
            {data.breaker.hooks.map((hook, index) => {
              const pos = breakerPos(index);
              const verdict = verdictOf(hook);
              return (
                <Node
                  key={hook.id}
                  x={pos.x}
                  y={pos.y}
                  show={expanded}
                  delay={900 + index * 70}
                  className="gx-hook gx-risk"
                  label={`${hook.name}, Breaker hook, implemented. Show its rule.`}
                  pressed={selHook?.id === hook.id}
                  onActivate={() => c.pickHook(hook.id)}
                  state={{ active: selHook?.id === hook.id ? "1" : "0", dim: flowOn ? (revealed("breaker") ? "0" : "1") : selHook && selHook.id !== hook.id ? "1" : "0", verdict }}
                >
                  <rect className="gx-box" x="-48" y="-15" width="96" height="30" rx="7" />
                  <rect className="gx-focus" x="-52" y="-19" width="104" height="38" rx="10" />
                  <circle className="gx-dot" cx="-36" cy="0" r="3.5" />
                  <text className="gx-hook-name" x="-26" y="4">{hook.name}</text>
                </Node>
              );
            })}

            {/* Breaker header is selectable as a stage. */}
            <Node x={BAND.x + BAND.w - 60} y={BAND.y + 17} show={expanded} delay={760} className="gx-bandbtn" label="Breaker stage. 5 of 5 hooks implemented. Show details." pressed={sel?.kind === "stage" && sel.id === "breaker"} onActivate={() => c.pickStage("breaker")}>
              <rect className="gx-box" x="-48" y="-13" width="96" height="26" rx="7" />
              <rect className="gx-focus" x="-52" y="-17" width="104" height="34" rx="10" />
              <text className="gx-band-count mono" y="4" textAnchor="middle">{data.breaker.live} of {data.breaker.total}</text>
            </Node>

            {/* Decision and Tape */}
            <Node x={DECISION.x} y={DECISION.y} show={expanded} delay={1060} className="gx-end" state={{ active: flowOn && step >= 6 ? "1" : "0", verdict: flowOn && step >= 6 ? (flow?.action === "open" ? "pass" : "noop") : undefined }}>
              <rect className="gx-box" x="-100" y="-23" width="200" height="46" rx="10" />
              <text className="gx-end-title" y="-3" textAnchor="middle">Paper decision</text>
              <text className="gx-end-sub mono" y="13" textAnchor="middle">{flowOn && step >= 6 ? flow?.action : "open · hold · close · skip"}</text>
            </Node>
            <Node x={TAPE.x} y={TAPE.y} show={expanded} delay={1140} className="gx-end" state={{ active: flowOn && step >= 7 ? "1" : "0" }}>
              <rect className="gx-box" x="-100" y="-23" width="200" height="46" rx="10" />
              <text className="gx-end-title" y="-3" textAnchor="middle">Optra Tape</text>
              <text className="gx-end-sub mono" y="13" textAnchor="middle">every decision recorded</text>
            </Node>
          </svg>
        </div>

        {/* Mobile: the same state as a vertical, tappable sequence. The SVG above is hidden on narrow screens. */}
        <div className="gm">
          <ul className="gm-agents" aria-label="House Agents">
            {data.agents.map((row) => (
              <li key={row.id}>
                <button type="button" className="gm-agent" onClick={() => c.pickAgent(row.id)} aria-pressed={agent === row.id} data-ready={row.ready ? "1" : "0"}>
                  <svg viewBox="0 0 38 28" aria-hidden="true"><path d={PAYOFF[row.id]} /></svg>
                  <span className="gm-agent-name">{row.name}</span>
                  <Chip tone={row.ready ? "azure" : "neutral"}>{row.ready ? "Paper ready" : "Preview"}</Chip>
                </button>
              </li>
            ))}
          </ul>
          {expanded ? (
            <ol className="gm-tree" aria-label="Protective Put hook stages">
              {[...data.stages, data.breaker].map((stage) => (
                <li key={stage.stage} className={stage.stage === "breaker" ? "is-risk" : ""} data-dim={dimStage(stage.stage) ? "1" : "0"}>
                  <button type="button" className="gm-stage" onClick={() => c.pickStage(stage.stage)} aria-pressed={sel?.kind === "stage" && sel.id === stage.stage}>
                    <span className="mono">{stage.label.toUpperCase()}</span>
                    <small className="mono">{stage.live} of {stage.total}</small>
                  </button>
                  <ul className="gm-hooks">
                    {stage.hooks.map((hook) => (
                      <li key={hook.id}>
                        <button type="button" className="gm-hook" onClick={() => c.pickHook(hook.id)} aria-pressed={selHook?.id === hook.id} data-verdict={verdictOf(hook)}>{hook.name}</button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <li className="gm-end"><span>Paper decision</span><span>Optra Tape</span></li>
            </ol>
          ) : null}
        </div>

        <div className="gx-panel" ref={panelRef}>
          <Panel c={c} />
        </div>
      </div>
    </div>
  );
}
