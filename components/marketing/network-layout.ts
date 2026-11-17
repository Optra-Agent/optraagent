import type { GraphData } from "./graph-data";

/* Geometry of the progressive agent network. Pure and deterministic: positions, branch curves, the phase each element
   appears in, and the camera framing for each phase. The component only renders what this module describes.

   The network grows outward from one root:
     phase 0  Protective Put awakens
     phase 1  all five strategy stages form
     phase 2  implemented hooks and catalog-only sockets branch from their stages
     phase 3  the Breaker closes around every stage
     phase 4  the paper decision resolves
     phase 5  Optra Tape receives the decision
   Children are placed along their parent's direction so they visibly grow out of it. */

export type Phase = 0 | 1 | 2 | 3 | 4 | 5;
export const PHASES: Phase[] = [0, 1, 2, 3, 4, 5];
export type NodeKind = "root" | "stage" | "hook" | "risk" | "locked" | "decision" | "tape";

export type LayoutNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  phase: Phase;
  /** Where the node blooms. Always its own position: it appears at the tip of the branch that reaches it, so it stays attached. */
  from: { x: number; y: number };
  /** Stagger inside a phase, in milliseconds. */
  delay: number;
  stage?: string;
};

export type LayoutEdge = {
  id: string;
  d: string;
  from: string;
  to: string;
  kind: "branch" | "hook" | "lock" | "flow";
  phase: Phase;
  delay: number;
  stage?: string;
};

export type Camera = { s: number; fx: number; fy: number };

export type Layout = {
  view: { w: number; h: number };
  root: { x: number; y: number };
  ring: { cx: number; cy: number; rx: number; ry: number; phase: Phase; d: string; dLeft: string; dRight: string };
  orbits: { rx: number; ry: number }[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  camera: Record<Phase, Camera>;
};

export const VIEW = { w: 1200, h: 820 };
const ROOT = { x: 600, y: 360 };
const STAGE_ELLIPSE = { rx: 255, ry: 170 };
const HOOK_ELLIPSE = { rx: 440, ry: 245 };
const RING = { rx: 545, ry: 285 };

/** Clockwise from the upper left. Breaker hooks sit on the ring in the gaps between these directions. */
const STAGE_ANGLE: Record<string, number> = { gate: -126, strike: -54, size: 18, pulse: 90, expiry: 162 };
const HOOK_SPREAD: Record<number, number[]> = { 1: [0], 2: [-11, 11], 3: [-21, 0, 21] };
/** Where each stage's dashed "locked" satellite sits, relative to the stage: tucked beside it, clear of its hooks. */
const LOCK_OFFSET: Record<string, { x: number; y: number }> = { gate: { x: -108, y: 64 }, strike: { x: 108, y: 64 }, size: { x: -104, y: 66 }, pulse: { x: 118, y: 36 }, expiry: { x: 104, y: 66 } };
/** Branch drawing time and the ring's drawing time, in ms. A node blooms when its branch reaches it. */
export const BLOOM = 700;
export const RING_DRAW = 1800;
const RING_ANGLES = [-90, -18, 54, 126, 198];
const STAGE_PHASE: Record<string, Phase> = { gate: 1, strike: 1, size: 1, pulse: 1, expiry: 1 };

const rad = (deg: number) => (deg * Math.PI) / 180;
const round = (n: number) => Math.round(n * 10) / 10;
const onEllipse = (e: { rx: number; ry: number }, deg: number) => ({ x: round(ROOT.x + e.rx * Math.cos(rad(deg))), y: round(ROOT.y + e.ry * Math.sin(rad(deg))) });

/** An S-shaped cubic curve: it leaves the parent along one side and arrives at the child along the other, so branches
 *  read as organic growth rather than ruled lines. `bend` is a fraction of the length; its sign picks the side. */
export function branchPath(a: { x: number; y: number }, b: { x: number; y: number }, bend: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c1 = { x: a.x + dx * 0.36 - dy * bend, y: a.y + dy * 0.36 + dx * bend };
  const c2 = { x: a.x + dx * 0.7 + dy * bend * 0.85, y: a.y + dy * 0.7 - dx * bend * 0.85 };
  return `M${round(a.x)} ${round(a.y)} C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(b.x)} ${round(b.y)}`;
}

export function buildLayout(data: GraphData): Layout {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const stagePos: Record<string, { x: number; y: number }> = {};

  nodes.push({ id: "root", kind: "root", x: ROOT.x, y: ROOT.y, w: 150, h: 150, phase: 0, from: ROOT, delay: 0 });

  data.stages.forEach((stage, index) => {
    const angle = STAGE_ANGLE[stage.stage] ?? 0;
    const rawPos = onEllipse(STAGE_ELLIPSE, angle);
    const pos = { x: round(rawPos.x), y: round(rawPos.y) };
    stagePos[stage.stage] = pos;
    const phase = STAGE_PHASE[stage.stage] ?? 1;
    const delay = (index % 3) * 140;
    nodes.push({ id: `stage:${stage.stage}`, kind: "stage", x: pos.x, y: pos.y, w: 116, h: 50, phase, from: pos, delay: delay + BLOOM, stage: stage.stage });
    edges.push({ id: `e:root:${stage.stage}`, d: branchPath(ROOT, pos, index % 2 === 0 ? 0.17 : -0.17), from: "root", to: `stage:${stage.stage}`, kind: "branch", phase, delay, stage: stage.stage });

    const spread = HOOK_SPREAD[stage.hooks.length] ?? [0];
    stage.hooks.forEach((hook, hi) => {
      const hp = onEllipse(HOOK_ELLIPSE, angle + (spread[hi] ?? 0));
      const hd = hi * 90;
      nodes.push({ id: `hook:${hook.id}`, kind: "hook", x: round(hp.x), y: round(hp.y), w: 116, h: 32, phase: 2, from: hp, delay: hd + BLOOM, stage: stage.stage });
      edges.push({ id: `e:${stage.stage}:${hook.id}`, d: branchPath(pos, hp, hi % 2 === 0 ? 0.2 : -0.2), from: `stage:${stage.stage}`, to: `hook:${hook.id}`, kind: "hook", phase: 2, delay: hd, stage: stage.stage });
    });

    if (stage.locked.length > 0) {
      // Locked hooks stay one dashed satellite per stage.
      const off = LOCK_OFFSET[stage.stage] ?? { x: 0, y: 70 };
      const lp = { x: round(pos.x + off.x), y: round(pos.y + off.y) };
      nodes.push({ id: `locked:${stage.stage}`, kind: "locked", x: round(lp.x), y: round(lp.y), w: 92, h: 28, phase: 2, from: lp, delay: 420 + BLOOM, stage: stage.stage });
      edges.push({ id: `e:${stage.stage}:locked`, d: branchPath(pos, lp, 0.14), from: `stage:${stage.stage}`, to: `locked:${stage.stage}`, kind: "lock", phase: 2, delay: 420, stage: stage.stage });
    }
  });

  data.breaker.hooks.forEach((hook, index) => {
    const pos = onEllipse(RING, RING_ANGLES[index] ?? 0);
    nodes.push({ id: `hook:${hook.id}`, kind: "risk", x: round(pos.x), y: round(pos.y), w: 116, h: 32, phase: 3, from: { x: pos.x, y: pos.y }, delay: 500 + Math.round(((((RING_ANGLES[index] ?? 0) + 90 + 360) % 360) / 360) * RING_DRAW), stage: "breaker" });
  });

  const bottom = { x: ROOT.x, y: ROOT.y + RING.ry };
  const decision = { x: ROOT.x, y: 710 };
  const tape = { x: ROOT.x + 270, y: 710 };
  nodes.push({ id: "decision", kind: "decision", x: decision.x, y: decision.y, w: 190, h: 70, phase: 4, from: decision, delay: BLOOM });
  nodes.push({ id: "tape", kind: "tape", x: tape.x, y: tape.y, w: 170, h: 56, phase: 5, from: tape, delay: 420 + BLOOM });
  edges.push({ id: "e:ring:decision", d: `M${bottom.x} ${bottom.y} L${decision.x} ${decision.y - 35}`, from: "ring", to: "decision", kind: "flow", phase: 4, delay: 0 });
  edges.push({ id: "e:decision:tape", d: `M${decision.x + 95} ${decision.y} L${tape.x - 85} ${tape.y}`, from: "decision", to: "tape", kind: "flow", phase: 5, delay: 420 });

  const top = { x: ROOT.x, y: ROOT.y - RING.ry };
  const ringBase = `A${RING.rx} ${RING.ry} 0`;
  return {
    view: VIEW,
    root: ROOT,
    ring: {
      cx: ROOT.x,
      cy: ROOT.y,
      rx: RING.rx,
      ry: RING.ry,
      phase: 3,
      d: `M${top.x} ${top.y} ${ringBase} 1 1 ${bottom.x} ${bottom.y} ${ringBase} 1 1 ${top.x} ${top.y}`,
      dLeft: `M${top.x} ${top.y} ${ringBase} 0 0 ${bottom.x} ${bottom.y}`,
      dRight: `M${top.x} ${top.y} ${ringBase} 0 1 ${bottom.x} ${bottom.y}`,
    },
    orbits: [STAGE_ELLIPSE, HOOK_ELLIPSE],
    nodes,
    edges,
    camera: {
      0: { s: 1.6, fx: 600, fy: 380 },
      1: { s: 1.38, fx: 620, fy: 340 },
      2: { s: 1.08, fx: 600, fy: 380 },
      3: { s: 1, fx: 600, fy: 410 },
      4: { s: 1, fx: 600, fy: 410 },
      5: { s: 1, fx: 600, fy: 410 },
    },
  };
}

export const PHASE_COPY: Record<Phase, { title: string; line: string }> = {
  0: { title: "Agent awakens", line: "Protective Put starts as one rule-driven paper agent." },
  1: { title: "Strategy forms", line: "Gate, Strike, Size, Pulse and Expiry shape the recipe." },
  2: { title: "Hooks evaluate", line: "Fifteen implemented hooks connect to the five stages. Catalog-only hooks stay inactive." },
  3: { title: "Breaker protects", line: "Five risk guards surround the full rule path and can block new entries." },
  4: { title: "Paper decision", line: "The validated rule path resolves to a paper action." },
  5: { title: "Optra Tape", line: "The decision and its rule-by-rule reasons become an append-only record." },
};
