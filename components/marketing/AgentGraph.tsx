"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { ChevronDown, ListTree, Lock, Pause, Play, RotateCcw, SkipBack } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import { FLOW_STEPS, STEP_LABEL } from "./graph-flow";
import type { FlowScenario, FlowStep, Verdict } from "./graph-flow";
import type { GraphAgent, GraphData, GraphHook, GraphStage } from "./graph-data";
import { buildLayout, PHASE_COPY, PHASES, VIEW } from "./network-layout";
import type { LayoutEdge, LayoutNode, Phase } from "./network-layout";

/* Optra Agent Network.
   One agent grows outward into its rule system: stages, then hooks, with the Breaker closing around everything as an
   always-on guard, and the paper decision and Optra Tape at the end. Geometry lives in network-layout.ts. This file
   renders it. Nodes are persistent; a phase only changes where they sit (from their parent to their own spot) and
   whether they are visible, so CSS transitions make the network visibly grow. No physics, no animation library. */

type AgentId = GraphAgent["id"];

const PAYOFF: Record<AgentId, string> = {
  protective_put: "M-24 12 H-6 L24 -14",
  covered_call: "M-24 14 L2 -10 H24",
  cash_secured_put: "M-24 10 L-6 -6 H24",
  earnings_straddle: "M-24 -14 L0 14 L24 -14",
};
const SMALL_PAYOFF: Record<AgentId, string> = {
  protective_put: "M2 22 H12 L36 4",
  covered_call: "M2 24 L22 6 H36",
  cash_secured_put: "M2 22 L14 10 H36",
  earnings_straddle: "M2 4 L19 24 L36 4",
};

/** Hold time before the next phase while auto-playing, in milliseconds. */
const PHASE_HOLD: Record<Phase, number> = { 0: 150, 1: 3000, 2: 3400, 3: 4200, 4: 1500 };
const FLOW_HOLD = 1000;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function ToolButton({ icon, label, hint, onClick, primary, pressed, disabled }: { icon: ReactNode; label: string; hint: string; onClick: () => void; primary?: boolean; pressed?: boolean; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn(buttonVariants({ variant: primary ? "default" : "outline", size: "sm" }), "pn-tool")} onClick={onClick} aria-pressed={pressed} disabled={disabled}>
          {icon}<span className="pn-tool-label">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

const tone: Record<Verdict, Tone> = { pass: "azure", select: "azure", size: "azure", action: "azure", block: "ember", noop: "neutral" };
const px = (value: number) => `${value}px`;

/* ───────────── SVG pieces ───────────── */

function Edge({ edge, show, hot, done, dim, pulse }: { edge: LayoutEdge; show: boolean; hot?: boolean; done?: boolean; dim?: boolean; pulse?: number }) {
  const solid = edge.kind !== "lock";
  return (
    <g className="pn-edge" data-kind={edge.kind} data-show={show ? "1" : "0"} data-hot={hot ? "1" : "0"} data-done={done ? "1" : "0"} data-dim={dim ? "1" : "0"} style={{ "--d": `${edge.delay}ms` } as CSSProperties} aria-hidden="true">
      <path className="pn-line" d={edge.d} pathLength={solid ? 1 : undefined} />
      {pulse !== undefined && show ? <path className="pn-pulse" d={edge.d} pathLength={1} style={{ animationDelay: `calc(var(--d, 0ms) + ${900 + pulse}ms)` }} /> : null}
    </g>
  );
}

type NodeProps = {
  node: LayoutNode;
  show: boolean;
  label?: string;
  pressed?: boolean;
  onActivate?: () => void;
  state?: Record<string, string | undefined>;
  className?: string;
  children: ReactNode;
};

function Node({ node, show, label, pressed, onActivate, state, className, children }: NodeProps) {
  const interactive = Boolean(onActivate);
  const cx = show ? node.x : node.from.x;
  const cy = show ? node.y : node.from.y;
  const data = Object.fromEntries(Object.entries(state ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [`data-${key}`, value]));
  const onKey = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate?.();
    }
  };
  return (
    <g
      className={cn("pn-n", interactive && "pn-btn", className)}
      style={{ "--cx": px(cx), "--cy": px(cy), "--ox": px(node.x), "--oy": px(node.y), "--d": `${node.delay}ms` } as CSSProperties}
      data-show={show ? "1" : "0"}
      data-kind={node.kind}
      {...data}
      {...(interactive ? { role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": pressed, onClick: onActivate, onKeyDown: onKey } : {})}
    >
      <g className="pn-in">{children}</g>
    </g>
  );
}

function Glyph({ id, ready }: { id: AgentId; ready: boolean }) {
  return (
    <g className="pn-glyph" data-ready={ready ? "1" : "0"} aria-hidden="true">
      <path d={PAYOFF[id]} />
    </g>
  );
}

/* ───────────── Detail card ───────────── */

function HookOutput({ hook }: { hook: GraphHook }) {
  const { example } = hook;
  return (
    <div className="pn-out" role="group" aria-label="Illustrative evaluation text">
      <p className="pn-out-label"><b>Illustrative only.</b> Engine wording for a typical result. Not a Tape record.</p>
      <div className="pn-out-row">
        <span className="pn-mono pn-dim">{hook.stage}</span>
        <b className="pn-mono">{hook.id}</b>
        <Chip tone={tone[example.status]}>{example.status}</Chip>
      </div>
      <p className="pn-out-reason">{example.reason}</p>
      {example.threshold !== undefined ? <p className="pn-out-meta pn-mono">limit {example.threshold}{example.unit ? ` ${example.unit}` : ""}</p> : null}
    </div>
  );
}

type Ctl = {
  data: GraphData;
  agent: GraphAgent;
  phase: Phase;
  sel: string | null;
  collapsed: string[];
  flow: FlowScenario | null;
  step: number;
  scenarios: FlowScenario[];
  select: (id: string | null) => void;
  toggleCollapse: (stage: string) => void;
  startFlow: (scenario: FlowScenario) => void;
  closeFlow: () => void;
  explore: () => void;
  focus: string | null;
  setFocus: (stage: string | null) => void;
};

function Card({ c }: { c: Ctl }) {
  const { data, agent, sel, flow } = c;
  const allHooks = [...data.stages.flatMap((stage) => stage.hooks), ...data.breaker.hooks];
  const stages = [...data.stages, data.breaker];

  if (!agent.ready) {
    return (
      <div className="pn-card" key={`preview-${agent.id}`}>
        <p className="pn-kicker">House Agent</p>
        <h3>{agent.name}</h3>
        <div className="pn-chips"><Chip>Preview</Chip><Chip>Not yet available</Chip></div>
        <p className="pn-lead">{agent.summary}</p>
        <p className="pn-note">{agent.reason}</p>
        <p className="pn-hint">No recipe exists for this agent, so there is no network to grow. It cannot be created until its venue and data requirements are verified.</p>
      </div>
    );
  }

  if (sel?.startsWith("hook:")) {
    const hook = allHooks.find((row) => `hook:${row.id}` === sel);
    if (hook) {
      return (
        <div className="pn-card" key={sel}>
          <p className="pn-kicker">{hook.stage} hook</p>
          <h3>{hook.name}</h3>
          <div className="pn-chips"><Chip tone="azure">Implemented</Chip><Chip>Protective Put recipe</Chip></div>
          <p className="pn-lead">{hook.summary}</p>
          {hook.params.length ? (
            <dl className="pn-params" aria-label={`${hook.name} parameters in this recipe`}>
              {hook.params.map((param) => <div key={param.key}><dt className="pn-mono">{param.key}</dt><dd className="pn-mono">{param.value}</dd></div>)}
            </dl>
          ) : null}
          <HookOutput hook={hook} />
          {hook.note ? <p className="pn-note">{hook.note}</p> : null}
          {flow ? <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => c.select(null)}>Back to decision timeline</button> : null}
        </div>
      );
    }
  }

  if (sel?.startsWith("locked:")) {
    const stage = stages.find((row) => `locked:${row.stage}` === sel);
    if (stage) {
      return (
        <div className="pn-card" key={sel}>
          <p className="pn-kicker">{stage.stage} stage</p>
          <h3>{stage.locked.length} catalog-only hooks</h3>
          <div className="pn-chips"><Chip>Locked</Chip><Chip tone="azure">{stage.live} of {stage.total} implemented</Chip></div>
          <p className="pn-lead">These hooks are in the library but have no verified evaluator, so they cannot take part in an evaluation. Forge blocks recipes that use them.</p>
          <ul className="pn-locklist">
            {stage.locked.map((hook) => <li key={hook.id}><b>{hook.name}</b><span>{hook.reason}</span></li>)}
          </ul>
        </div>
      );
    }
  }

  if (sel?.startsWith("stage:")) {
    const stage = stages.find((row) => `stage:${row.stage}` === sel);
    if (stage) {
      const hidden = c.collapsed.includes(stage.stage);
      return (
        <div className="pn-card" key={sel}>
          <p className="pn-kicker">{stage.stage === "breaker" ? "Risk guard" : "Stage"}</p>
          <h3>{stage.label}</h3>
          <p className="pn-lead">{stage.question}{stage.stage === "breaker" ? " It is checked on every tick and can stop new entries. Exits keep running." : ""}</p>
          <div className="pn-chips"><Chip tone="azure">{stage.live} of {stage.total} implemented</Chip>{stage.locked.length ? <Chip>{stage.locked.length} catalog only</Chip> : null}</div>
          <p className="pn-label">Used by this recipe</p>
          <ul className="pn-locklist">
            {stage.hooks.map((hook) => <li key={hook.id}><button type="button" className="pn-link" onClick={() => c.select(`hook:${hook.id}`)}>{hook.name}</button><span>{hook.summary}</span></li>)}
          </ul>
          <div className="pn-actions">
            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => c.toggleCollapse(stage.stage)}>{hidden ? "Show its hooks" : "Hide its hooks"}</button>
            {flow ? <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => c.select(null)}>Back to decision timeline</button> : null}
          </div>
        </div>
      );
    }
  }

  if (flow && c.phase === 4) return <FlowCard c={c} scenario={flow} />;

  return (
    <div className="pn-card" key="agent">
      <p className="pn-kicker">House Agent</p>
      <h3>{agent.name}</h3>
      <div className="pn-chips"><Chip tone="azure">Paper ready</Chip><Chip tone="ember">Modeled premiums</Chip></div>
      <p className="pn-lead">{agent.summary}</p>
      <dl className="pn-facts">
        <div><dt>Hooks used</dt><dd className="pn-mono">{data.stages.reduce((n, s) => n + s.hooks.length, 0) + data.breaker.hooks.length} of {data.hookTotal}</dd></div>
        <div><dt>Stages</dt><dd className="pn-mono">6</dd></div>
      </dl>
      <div className="pn-actions">
        {c.phase === 0 ? <button type="button" className={buttonVariants({ size: "sm" })} onClick={c.explore}>Explore agent</button> : null}
        <button type="button" className={buttonVariants({ variant: c.phase === 0 ? "outline" : "default", size: "sm" })} onClick={() => c.startFlow(c.scenarios[0]!)}>View decision flow</button>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/agents#configure">Configure this agent</Link>
      </div>
    </div>
  );
}

const STAGE_NAME: Record<FlowStep, string> = { gate: "Gate", strike: "Strike", size: "Size", pulse: "Pulse", expiry: "Expiry", breaker: "Breaker", decision: "Paper decision", tape: "Optra Tape" };
const STAGE_ASK: Record<FlowStep, string> = { gate: "May the agent enter?", strike: "Which put?", size: "How many units?", pulse: "Manage an open position", expiry: "Close before expiry", breaker: "Risk check on every tick", decision: "The verdicts become one action", tape: "Written down for later" };

/** The decision timeline: a result summary first, then one row per stage that opens into hook verdicts on demand. */
function FlowCard({ c, scenario }: { c: Ctl; scenario: FlowScenario }) {
  const { data, step } = c;
  const [flipped, setFlipped] = useState<string[]>([]);
  const lookup = (name: FlowStep): GraphStage | undefined => [...data.stages, data.breaker].find((row) => row.stage === name);
  const recorded = scenario.source === "recorded";
  const done = step >= FLOW_STEPS.length - 1;
  const progress = Math.max(0, Math.min(1, (step + 1) / FLOW_STEPS.length));
  const blocked = scenario.action === "skip" || scenario.action === "hold";
  return (
    <div className="pn-card pn-timeline" key="flow">
      <p className="pn-kicker">Decision timeline</p>
      <h3>{recorded ? "A public Tape record" : "How one tick becomes a decision"}</h3>
      <div className="pn-chips">
        <Chip tone={recorded ? "azure" : "ember"}>{recorded ? "Public Tape record" : "Illustrative only"}</Chip>
        <Chip>Paper</Chip>
      </div>
      <div className="pn-seg" role="group" aria-label="Example">
        {c.scenarios.map((row) => <button key={row.id} type="button" aria-pressed={row.id === scenario.id} onClick={() => c.startFlow(row)}>{row.label}</button>)}
      </div>

      <div className="pn-result" data-done={done ? "1" : "0"} data-tone={blocked ? "blocked" : "open"} role="status">
        <div className="pn-result-top">
          <span className="pn-result-label">{done ? "Result" : "Evaluating"}</span>
          {done ? <Chip tone={scenario.action === "open" ? "azure" : "neutral"}>{scenario.action}</Chip> : null}
        </div>
        <p className="pn-result-text">{done ? scenario.reason : `Step ${Math.max(step + 1, 0)} of ${FLOW_STEPS.length}: ${STAGE_NAME[FLOW_STEPS[Math.max(step, 0)] ?? "gate"]}`}</p>
        <div className="pn-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
      </div>

      <ol className="pn-rail" aria-label="Evaluation order">
        {FLOW_STEPS.map((name, index) => {
          const reached = step >= index;
          const stage = lookup(name);
          const verdicts = stage ? stage.hooks.map((hook) => ({ hook, verdict: scenario.verdicts[hook.id] })).filter((row) => row.verdict) : [];
          const blocks = verdicts.filter((row) => row.verdict?.status === "block").length;
          const passes = verdicts.filter((row) => row.verdict && row.verdict.status !== "block" && row.verdict.status !== "noop").length;
          const nones = verdicts.length - blocks - passes;
          const hasBody = reached && (verdicts.length > 0 || name === "decision" || name === "tape");
          const open = hasBody && (blocks > 0) !== flipped.includes(name);
          return (
            <li key={name} data-state={step === index ? "active" : reached ? "done" : "pending"} data-block={reached && blocks > 0 ? "1" : "0"}>
              <button type="button" className="pn-rail-head" aria-expanded={hasBody ? open : undefined} disabled={!hasBody} onClick={() => { c.setFocus(stage ? name : null); setFlipped((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name])); }}>
                <span className="pn-rail-name">{STAGE_NAME[name]}</span>
                <span className="pn-rail-ask">{STAGE_ASK[name]}</span>
                {reached && verdicts.length > 0 ? (
                  <span className="pn-rail-tally mono">
                    {passes > 0 ? <span data-v="pass">{passes} pass</span> : null}
                    {blocks > 0 ? <span data-v="block">{blocks} block</span> : null}
                    {nones > 0 ? <span data-v="noop">{nones} idle</span> : null}
                  </span>
                ) : null}
                {hasBody ? <ChevronDown className="pn-rail-caret" aria-hidden /> : null}
              </button>
              {open ? (
                <div className="pn-rail-body">
                  {verdicts.length > 0 ? (
                    <ul className="pn-step-hooks">
                      {verdicts.map(({ hook, verdict }) => (
                        <li key={hook.id}>
                          <b>{hook.name}</b> <Chip tone={tone[verdict!.status]}>{verdict!.raw ?? verdict!.status}</Chip>
                          {verdict!.status === "block" ? <span className="pn-step-why">{verdict!.reason}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {name === "decision" ? <p className="pn-step-why">{scenario.reason}</p> : null}
                  {name === "tape" ? <p className="pn-step-why">The decision, every hook verdict and the recipe hash are appended to the agent&apos;s Tape.</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="pn-note">
        {recorded ? "From the public Tape." : "Illustrative only. Not a recorded trade, and nothing is sent onchain."} Any Gate or Breaker block stops a new entry.
      </p>
      <div className="pn-actions">
        <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => c.startFlow(scenario)}>Replay example</button>
        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={c.closeFlow}>Close</button>
      </div>
    </div>
  );
}

/* ───────────── Main ───────────── */

export type GraphProps = { data: GraphData; recorded?: FlowScenario | null };

export function AgentGraph({ data, recorded = null }: GraphProps) {
  const layout = useMemo(() => buildLayout(data), [data]);
  const scenarios = useMemo(() => (recorded ? [...data.scenarios, recorded] : data.scenarios), [data, recorded]);
  const allHooks = useMemo(() => [...data.stages.flatMap((stage) => stage.hooks), ...data.breaker.hooks], [data]);

  const [agentId, setAgentId] = useState<AgentId>("protective_put");
  const [phase, setPhase] = useState<Phase>(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [flow, setFlow] = useState<FlowScenario | null>(null);
  const [step, setStep] = useState(-1);
  const [flowFocus, setFlowFocus] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  const agent = data.agents.find((row) => row.id === agentId) ?? data.agents[0]!;

  // Auto-play advances phases, then the illustrative flow. One timer at a time, cleared on pause or unmount.
  useEffect(() => {
    if (!playing) return;
    const delay = phase < 4 ? PHASE_HOLD[phase] : flow ? FLOW_HOLD : PHASE_HOLD[4];
    const timer = window.setTimeout(() => {
      if (phase < 4) setPhase((phase + 1) as Phase);
      else if (!flow) {
        setFlow(scenarios[0] ?? null);
        setStep(0);
      } else if (step < FLOW_STEPS.length - 1) setStep(step + 1);
      else setPlaying(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, phase, flow, step, scenarios]);

  // The first time the network is mostly on screen it grows once by itself. Pausing stops it; reduced motion never starts it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      root.dataset.live = entry?.isIntersecting ? "1" : "0";
      if (entry && entry.intersectionRatio >= 0.5 && !autoStarted.current && !reduced()) {
        autoStarted.current = true;
        setPlaying(true);
      }
    }, { threshold: [0, 0.5], rootMargin: "60px 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const interacted = () => { autoStarted.current = true; };
  const needs = (id: string): Phase => (id.startsWith("hook:") || id.startsWith("locked:") ? 3 : id === "stage:pulse" || id === "stage:expiry" || id === "stage:breaker" ? 2 : 1);
  const reset = () => { setSel(null); setFlow(null); setStep(-1); setCollapsed([]); setFlowFocus(null); };

  const c: Ctl = {
    data, agent, phase, sel, collapsed, flow, step, scenarios,
    select(id) {
      interacted();
      setPlaying(false);
      if (id === sel) { setSel(null); return; }
      setSel(id);
      if (id && id !== "root") setPhase((current) => (current < needs(id) ? needs(id) : current));
    },
    toggleCollapse(stage) {
      setCollapsed((current) => (current.includes(stage) ? current.filter((item) => item !== stage) : [...current, stage]));
    },
    startFlow(scenario) {
      interacted();
      setSel(null);
      setPhase(4);
      setFlow(scenario);
      if (reduced()) { setStep(FLOW_STEPS.length - 1); setPlaying(false); } else { setStep(0); setPlaying(true); }
    },
    closeFlow() { setFlow(null); setStep(-1); setPlaying(false); setFlowFocus(null); },
    focus: flowFocus,
    setFocus: setFlowFocus,
    explore() { interacted(); setSel(null); setPhase(1); setPlaying(true); },
  };

  const goTo = (target: Phase) => { interacted(); setPlaying(false); setFlow(null); setStep(-1); setSel(null); setPhase(target); };
  const replay = () => { interacted(); reset(); setPhase(0); window.setTimeout(() => setPlaying(true), 450); };
  const start = () => { interacted(); setPlaying(false); reset(); setPhase(0); };
  const pickAgent = (id: AgentId) => { interacted(); setAgentId(id); setPhase(0); setPlaying(false); reset(); };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (sel) { event.stopPropagation(); setSel(null); } else if (flow) { event.stopPropagation(); c.closeFlow(); }
  };

  const ready = agent.ready;
  const stageOf = (id: string | null): string | null => {
    if (!id) return null;
    if (id.startsWith("stage:") || id.startsWith("locked:")) return id.split(":")[1] ?? null;
    if (id.startsWith("hook:")) return allHooks.find((hook) => `hook:${hook.id}` === id)?.stage ?? null;
    return null;
  };
  const selStage = stageOf(sel);
  const flowOn = ready && flow !== null && phase === 4 && step >= 0;
  const stepOf = (stage: string) => FLOW_STEPS.indexOf(stage as FlowStep);
  const reached = (stage: string | undefined) => flowOn && stage !== undefined && step >= stepOf(stage);
  const verdictOf = (node: LayoutNode): Verdict | undefined => (flowOn && reached(node.stage) ? flow?.verdicts[node.id.replace("hook:", "")]?.status : undefined);
  const selNode = layout.nodes.find((node) => node.id === sel);
  const side = selNode && selNode.x > 600 ? "left" : "right";

  const showCard = !ready || sel !== null || flowOn;
  // When a card is open the network slides and shrinks into the free side, so the card never covers what it describes.
  const camera = (() => {
    let cam = layout.camera[phase];
    if (selNode && phase >= 3 && selNode.kind !== "root") cam = { s: 1.15, fx: selNode.x, fy: Math.min(560, Math.max(260, selNode.y)) };
    else if (flowOn) cam = { s: 0.78, fx: 600, fy: 410 };
    else if (showCard) cam = { ...cam, s: Math.min(cam.s, 1.3) };
    if (showCard) {
      const shift = (side === "right" ? 1 : -1) * 175;
      return { ...cam, fx: cam.fx + shift / cam.s };
    }
    return cam;
  })();

  const inCollapsed = (stage: string | undefined, kind: string) => stage !== undefined && collapsed.includes(stage) && (kind === "hook" || kind === "risk" || kind === "locked" || kind === "lock");
  const visible = (node: LayoutNode) => ready && node.phase <= phase && !inCollapsed(node.stage, node.kind);
  const visibleEdge = (edge: LayoutEdge) => ready && edge.phase <= phase && !inCollapsed(edge.stage, edge.kind);
  const dimmed = (stage: string | undefined) => (flowOn ? !reached(stage) || (flowFocus !== null && stage !== flowFocus) : selStage !== null && stage !== undefined && stage !== selStage);
  const nodeById = (id: string) => layout.nodes.find((node) => node.id === id)!;
  const stageData = (name: string | undefined) => [...data.stages, data.breaker].find((row) => row.stage === name);

  const statusText = !ready
    ? `${agent.name}, Preview. Not yet available.`
    : flowOn
      ? `Decision flow, step ${step + 1} of ${FLOW_STEPS.length}: ${STEP_LABEL[FLOW_STEPS[step] ?? "gate"]}.${step >= FLOW_STEPS.length - 1 ? ` Illustrative result: ${flow?.action}. ${flow?.reason}` : ""}`
      : sel
        ? `${sel.replace(":", " ")} selected.`
        : `State ${phase + 1} of 5: ${PHASE_COPY[phase].title}.`;

  const idle = phase === 0 && !playing;

  const controls = (
    <div className="pn-controls" role="toolbar" aria-label="Network playback">
      {idle ? (
        <ToolButton primary icon={<Play aria-hidden />} label="Explore agent" hint="Grow the agent into its stages, hooks and decision" onClick={c.explore} disabled={!ready} />
      ) : (
        <>
          <ToolButton icon={playing ? <Pause aria-hidden /> : <Play aria-hidden />} label={playing ? "Pause" : "Play"} hint={playing ? "Pause the growth" : "Continue the growth"} pressed={playing} onClick={() => { interacted(); setPlaying((value) => !value); }} />
          <ToolButton icon={<RotateCcw aria-hidden />} label="Replay" hint="Replay the growth from one agent" onClick={replay} />
          {phase === 4 && !flow ? <ToolButton icon={<ListTree aria-hidden />} label="View decision flow" hint="Step through how one tick becomes a decision (illustrative)" onClick={() => c.startFlow(scenarios[0]!)} /> : null}
          <ToolButton icon={<SkipBack aria-hidden />} label="Back to start" hint="Return to the single agent" onClick={start} />
        </>
      )}
    </div>
  );
  const stepper = (
    <ol className="pn-dots" aria-label="Network states">
      {PHASES.map((value) => (
        <li key={value}>
          <button type="button" disabled={!ready} aria-label={`State ${value + 1}: ${PHASE_COPY[value].title}`} aria-current={phase === value ? "step" : undefined} data-done={phase >= value ? "1" : "0"} onClick={() => goTo(value)}>{value + 1}</button>
        </li>
      ))}
    </ol>
  );
  const caption = (
    <div className="pn-caption">
      <p className="pn-state">
        <span className="pn-mono pn-state-live">STATE {phase + 1} / 5</span>
        <span className="pn-mono pn-state-static">COMPLETE NETWORK</span>
        <span className="pn-state-live pn-title">{ready ? PHASE_COPY[phase].title : "Preview agent"}</span>
        <span className="pn-state-static pn-title">{ready ? "Protective Put" : "Preview agent"}</span>
      </p>
      <p className="pn-state-line pn-state-live">{ready ? PHASE_COPY[phase].line : "No recipe exists yet, so nothing grows from this agent."}</p>
      <p className="pn-state-line pn-state-static">{ready ? "The agent, six hook stages, the Breaker guard, a paper decision and Optra Tape." : "No recipe exists yet, so nothing grows from this agent."}</p>
      {ready ? stepper : null}
    </div>
  );
  const illustration = flow?.source === "recorded" ? "PUBLIC TAPE RECORD" : "ILLUSTRATIVE ONLY · NO RECORDED TRADE";

  return (
    <TooltipProvider delayDuration={150}>
    <div ref={rootRef} className="pn" data-phase={phase} data-agent={agent.id} data-ready={ready ? "1" : "0"} data-playing={playing ? "1" : "0"} data-flow={flowOn ? "1" : "0"} data-live="1" onKeyDown={onKey}>
      <p className="sr-only" role="status">{statusText}</p>

      <div className="pn-head">
        <ul className="pn-agents" aria-label="House Agents">
          {data.agents.map((row) => (
            <li key={row.id}>
              <button type="button" className="pn-agent" aria-pressed={row.id === agentId} data-ready={row.ready ? "1" : "0"} onClick={() => pickAgent(row.id)}>
                <span className="pn-agent-mark"><svg viewBox="0 0 38 28" aria-hidden="true"><path d={SMALL_PAYOFF[row.id]} /></svg></span>
                <span className="pn-agent-text"><b>{row.name}</b><small>{row.ready ? "Paper ready" : "Preview"}</small></span>
                {row.ready ? null : <Lock className="pn-agent-lock" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        {ready ? controls : null}
      </div>

      <div className="pn-stage">
        {caption}

        <svg className="pn-svg" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="group" aria-label="Optra Agent network. Protective Put grows into six hook stages, the Breaker guard, a paper decision and Optra Tape." preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="pn-root-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14263b" />
              <stop offset="100%" stopColor="#09111b" />
            </linearGradient>
            <radialGradient id="pn-glow-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1e8fff" stopOpacity="0.3" />
              <stop offset="55%" stopColor="#1e8fff" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#1e8fff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g className="pn-cam" style={{ "--s": camera.s, "--fx": px(camera.fx), "--fy": px(camera.fy) } as CSSProperties}>
            <g className="pn-atmos" aria-hidden="true">
              <circle className="pn-glow" cx={layout.root.x} cy={layout.root.y} r="330" fill="url(#pn-glow-grad)" />
              {layout.orbits.map((orbit, index) => <ellipse key={index} className="pn-orbit-guide" cx={layout.root.x} cy={layout.root.y} rx={orbit.rx} ry={orbit.ry} />)}
            </g>

            {/* Breaker ring: an always-on guard around the whole network, not the last step. */}
            <g className="pn-ring" data-show={ready && phase >= layout.ring.phase ? "1" : "0"} data-dim={dimmed("breaker") ? "1" : "0"} data-hot={selStage === "breaker" || (flowOn && reached("breaker")) ? "1" : "0"} style={{ "--d": "700ms" } as CSSProperties} aria-hidden="true">
              <path className="pn-ring-line" d={layout.ring.d} pathLength={1} />
              <path className="pn-ring-scan" d={layout.ring.d} pathLength={1} />
              {flowOn && step >= 5 ? (
                <>
                  <path className="pn-ring-flow" d={layout.ring.dLeft} pathLength={1} />
                  <path className="pn-ring-flow" d={layout.ring.dRight} pathLength={1} />
                </>
              ) : null}
              <text className="pn-ring-label pn-mono" x={layout.ring.cx + 84} y={layout.ring.cy - layout.ring.ry + 4}>BREAKER · ALWAYS ON</text>
            </g>

            {layout.edges.map((edge) => {
              const stage = edge.stage;
              const hot = edge.kind !== "flow" && stage !== undefined && selStage === stage;
              const flowStep = edge.kind === "flow" ? (edge.to === "decision" ? 6 : 7) : stage !== undefined ? stepOf(stage) : 0;
              const done = flowOn && step >= flowStep;
              const pulse = edge.kind === "branch" && stage ? stepOf(stage) * 700 : edge.kind === "hook" && hot ? 0 : edge.kind === "flow" && phase === 4 && !flowOn ? 0 : undefined;
              return <Edge key={edge.id} edge={edge} show={visibleEdge(edge)} hot={hot} done={done} dim={edge.kind === "flow" ? flowOn && step < flowStep : dimmed(stage)} pulse={pulse} />;
            })}

            {/* The root agent: the one focal point. */}
            <Node
              node={nodeById("root")}
              show
              label={`${agent.name}. ${ready ? "Paper agent. Explore it." : "Preview, not yet available. Show details."}`}
              pressed={sel === "root"}
              onActivate={() => (ready && idle && !reduced() ? c.explore() : c.select("root"))}
              state={{ active: sel === "root" ? "1" : "0", ready: ready ? "1" : "0" }}
              className="pn-root"
            >
              <circle className="pn-orbit-ring" r="100" />
              <g className="pn-segments" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const start = ((-90 + index * 60 + 7) * Math.PI) / 180;
                  const end = ((-90 + index * 60 + 53) * Math.PI) / 180;
                  const r = 86;
                  return <path key={index} className={index === 5 ? "pn-seg pn-seg-risk" : "pn-seg"} d={`M${(Math.cos(start) * r).toFixed(1)} ${(Math.sin(start) * r).toFixed(1)} A${r} ${r} 0 0 1 ${(Math.cos(end) * r).toFixed(1)} ${(Math.sin(end) * r).toFixed(1)}`} />;
                })}
              </g>
              <path className="pn-root-shell" d="M0 -72 L62.4 -36 V36 L0 72 L-62.4 36 V-36 Z" fill="url(#pn-root-fill)" />
              <path className="pn-root-inner" d="M0 -60 L52 -30 V30 L0 60 L-52 30 V-30 Z" />
              <circle className="pn-root-disc" r="40" />
              <path className="pn-focus" d="M0 -80 L69 -40 V40 L0 80 L-69 40 V-40 Z" />
              <g transform="translate(0 -6) scale(1.35)"><Glyph id={agent.id} ready={ready} /></g>
              <path className="pn-root-strike" d="M-30 22 H30" />
              <circle className="pn-root-dot" cx="18" cy="22" r="3.4" />
              <g className="pn-root-check" transform="translate(46 -46)" aria-hidden="true">
                <circle r="12" />
                <path d="M-5 0.5 L-1.5 4 L5.5 -3.5" />
              </g>
              <text className="pn-root-name" y="118" textAnchor="middle">{agent.name}</text>
              <g className="pn-root-more" data-compact={phase >= 2 ? "1" : "0"}>
                <text className="pn-root-tag pn-mono" y="140" textAnchor="middle" data-ready={ready ? "1" : "0"}>{ready ? "PAPER AGENT" : "PREVIEW"}</text>
                <text className="pn-root-sub" y="160" textAnchor="middle">{ready ? "15 hooks · paper only · modeled premiums" : "Not yet available"}</text>
              </g>
            </Node>

            {layout.nodes.filter((node) => node.kind === "stage").map((node) => {
              const stage = stageData(node.stage)!;
              return (
                <Node key={node.id} node={node} show={visible(node)} label={`${stage.label} stage. ${stage.live} of ${stage.total} hooks implemented. Show details.`} pressed={sel === node.id} onActivate={() => c.select(node.id)} className="pn-stage-node" state={{ active: sel === node.id || (flowOn && (flowFocus === node.stage || (flowFocus === null && step === stepOf(node.stage ?? "")))) ? "1" : "0", dim: dimmed(node.stage) ? "1" : "0" }}>
                  <polygon className="pn-box" points="-58,0 -44,-25 44,-25 58,0 44,25 -44,25" />
                  <polygon className="pn-focus" points="-64,0 -47,-31 47,-31 64,0 47,31 -47,31" />
                  <text className="pn-stage-name pn-mono" y="-3" textAnchor="middle">{stage.label.toUpperCase()}</text>
                  <text className="pn-stage-count" y="14" textAnchor="middle">{stage.live} of {stage.total}</text>
                </Node>
              );
            })}

            {layout.nodes.filter((node) => node.kind === "hook" || node.kind === "risk").map((node) => {
              const hook = allHooks.find((row) => `hook:${row.id}` === node.id)!;
              return (
                <Node key={node.id} node={node} show={visible(node)} label={`${hook.name}, ${hook.stage} hook, implemented. Show its rule.`} pressed={sel === node.id} onActivate={() => c.select(node.id)} className={cn("pn-hook", node.kind === "risk" && "pn-risk")} state={{ active: sel === node.id ? "1" : "0", dim: dimmed(node.stage) ? "1" : "0", verdict: verdictOf(node) }}>
                  <rect className="pn-box" x="-58" y="-16" width="116" height="32" rx="16" />
                  <rect className="pn-focus" x="-62" y="-20" width="124" height="40" rx="20" />
                  <circle className="pn-dot" cx="-40" cy="0" r="4" />
                  <text className="pn-hook-name" x="-28" y="4.5">{hook.name}</text>
                </Node>
              );
            })}

            {layout.nodes.filter((node) => node.kind === "locked").map((node) => {
              const stage = stageData(node.stage)!;
              return (
                <Node key={node.id} node={node} show={visible(node)} label={`${stage.locked.length} catalog-only ${stage.label} hooks. Locked. Show details.`} pressed={sel === node.id} onActivate={() => c.select(node.id)} className="pn-locked" state={{ active: sel === node.id ? "1" : "0", dim: dimmed(node.stage) ? "1" : "0" }}>
                  <rect className="pn-box" x="-46" y="-14" width="92" height="28" rx="14" />
                  <rect className="pn-focus" x="-50" y="-18" width="100" height="36" rx="18" />
                  <text className="pn-locked-text" y="4.5" textAnchor="middle">{stage.locked.length} locked</text>
                </Node>
              );
            })}

            <Node node={nodeById("decision")} show={ready && phase >= 4} className="pn-decision" state={{ active: flowOn && step >= 6 ? "1" : "0", verdict: flowOn && step >= 6 ? (flow?.action === "open" ? "pass" : "noop") : undefined }}>
              <polygon className="pn-box" points="0,-35 95,0 0,35 -95,0" />
              <text className="pn-end-title" y="-2" textAnchor="middle">Paper decision</text>
              <text className="pn-end-sub pn-mono" y="14" textAnchor="middle">{flowOn && step >= 6 ? flow?.action : "open · hold · close · skip"}</text>
            </Node>
            <Node node={nodeById("tape")} show={ready && phase >= 4} className="pn-tape" state={{ active: flowOn && step >= 7 ? "1" : "0" }}>
              <rect className="pn-box" x="-85" y="-28" width="170" height="56" rx="10" />
              <path className="pn-tape-lines" d="M-66 -10 H-30 M-66 0 H-40 M-66 10 H-34" />
              <text className="pn-end-title" x="-14" y="-2">Optra Tape</text>
              <text className="pn-end-sub pn-mono" x="-14" y="14">every decision</text>
            </Node>
            <g className="pn-illus" data-show={ready && phase >= 4 ? "1" : "0"} aria-hidden="true">
              <text className="pn-mono" x={layout.root.x + 135} y="800" textAnchor="middle">{illustration}</text>
            </g>
          </g>
        </svg>

        {idle && ready ? (
          <div className="pn-cta">
            <button type="button" className={cn(buttonVariants({ size: "lg" }), "pn-cta-btn")} onClick={c.explore}>Explore agent</button>
            <p>Watch Protective Put grow into its rules, or select the agent.</p>
          </div>
        ) : null}

        {showCard ? <div className="pn-float" data-side={side}><Card c={c} /></div> : null}
      </div>

      {/* Compact layout: the same growth as a vertical branching sequence. */}
      <div className="pm" data-ready={ready ? "1" : "0"}>
        {ready ? <div className="pm-bar">{controls}</div> : null}
        {caption}
        <button type="button" className="pm-root" onClick={() => (ready && idle && !reduced() ? c.explore() : c.select("root"))} aria-pressed={sel === "root"} data-ready={ready ? "1" : "0"}>
          <svg viewBox="0 0 38 28" aria-hidden="true"><path d={SMALL_PAYOFF[agent.id]} /></svg>
          <span className="pm-root-name">{agent.name}</span>
          <small>{ready ? "PAPER AGENT · 15 hooks" : "PREVIEW · Not yet available"}</small>
        </button>
        {ready ? (
          <ol className="pm-tree" style={{ "--grow": phase / 4 } as CSSProperties} aria-label="Protective Put hook stages">
            {[...data.stages, data.breaker].map((stage) => {
              const stagePhase = stage.stage === "pulse" || stage.stage === "expiry" || stage.stage === "breaker" ? 2 : 1;
              const hooksOpen = phase >= 3 && !collapsed.includes(stage.stage);
              return (
                <li key={stage.stage} className={cn("pm-stage", stage.stage === "breaker" && "is-risk")} data-show={phase >= stagePhase ? "1" : "0"} data-dim={dimmed(stage.stage) ? "1" : "0"}>
                  <button type="button" className="pm-stage-btn" aria-pressed={sel === `stage:${stage.stage}`} onClick={() => c.select(`stage:${stage.stage}`)}>
                    <span className="pn-mono">{stage.label.toUpperCase()}</span>
                    <small className="pn-mono">{stage.live} of {stage.total}{stage.stage === "breaker" ? " · always on" : ""}</small>
                  </button>
                  <ul className="pm-hooks" data-show={hooksOpen ? "1" : "0"}>
                    {stage.hooks.map((hook, index) => {
                      const verdict = flowOn && reached(stage.stage) ? flow?.verdicts[hook.id]?.status : undefined;
                      return <li key={hook.id} style={{ "--i": index } as CSSProperties}><button type="button" className="pm-hook" aria-pressed={sel === `hook:${hook.id}`} data-verdict={verdict} onClick={() => c.select(`hook:${hook.id}`)}>{hook.name}</button></li>;
                    })}
                    {stage.locked.length ? <li style={{ "--i": stage.hooks.length } as CSSProperties}><button type="button" className="pm-hook is-locked" aria-pressed={sel === `locked:${stage.stage}`} onClick={() => c.select(`locked:${stage.stage}`)}>{stage.locked.length} locked<span className="sr-only"> catalog-only hooks</span></button></li> : null}
                  </ul>
                </li>
              );
            })}
            <li className="pm-end" data-show={phase >= 4 ? "1" : "0"}>
              <span>Paper decision</span><span>Optra Tape</span>
              <small className="pn-mono">{illustration}</small>
            </li>
          </ol>
        ) : null}
        {showCard ? <div className="pm-card"><Card c={c} /></div> : null}
      </div>
    </div>
    </TooltipProvider>
  );
}
