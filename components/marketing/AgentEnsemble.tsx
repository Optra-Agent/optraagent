"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AgentCharacter, characterColor, type CharacterId, type StageCharacterId } from "./characters";

/**
 * The hero object: the agent and the rules it is made of, as one cast of characters joined by dotted routes.
 * Protective Put sits in the middle, its five rule stages around it, and the three House Agents that are still strategy overviews farther out.
 * On a fresh visit the pieces start scattered and assemble when the opening lifts. Scrolling away lets them drift apart and fade.
 * Select one and the route to it runs with dots in its colour, and it says what it decides. Everything is HTML and SVG, so it is crisp at any width.
 * Nothing here is a result: the lines are the product's own stage questions, not recorded decisions.
 */

/** Where a note opens, chosen per character so it never covers a neighbour. */
type Bubble = "above" | "below" | "left" | "right";
type Cast = { /** Position in a narrow, square box, where the outer agents are left out. */ m: [number, number]; id: CharacterId; label: string; sub: string; line: string; x: number; y: number; s: number; ring: "center" | "stage" | "outer"; scatter: [number, number, number]; drift: [number, number, number] };

const STAGE_POSITION: Record<StageCharacterId, [number, number]> = {
  gate: [29, 24], strike: [72, 22], size: [81, 60], pulse: [53, 86], expiry: [20, 64], breaker: [50, 50],
};
const BUBBLE: Record<string, Bubble> = { protective_put: "above", gate: "right", strike: "left", size: "below", pulse: "right", expiry: "below", covered_call: "below", cash_secured_put: "below", earnings_straddle: "left" };
const COMPACT_POSITION: Record<StageCharacterId, [number, number]> = {
  gate: [20, 12], strike: [80, 12], size: [86, 50], pulse: [50, 84], expiry: [14, 50], breaker: [50, 44],
};
const SCATTER: [number, number, number][] = [[-30, -22, -140], [26, -28, 120], [34, 12, -90], [-8, 30, 160], [-34, 18, 100], [-14, -32, -60], [30, 30, 80], [-26, 28, -120]];
const DRIFT: [number, number, number][] = [[-16, -12, -24], [14, -18, 20], [20, 6, -16], [-6, 18, 26], [-18, 8, 18], [-10, -16, -14], [16, 16, 14], [-14, 14, -20]];

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function AgentEnsemble({ stages }: { stages: { id: StageCharacterId; label: string; line: string }[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const touched = useRef(false);

  const cast: Cast[] = [
    { m: [50, 44], id: "protective_put", label: "Protective Put", sub: "Paper ready", line: "Buys a put about 7% out of the money, 30 days out, when volatility is calm.", x: 50, y: 50, s: 21, ring: "center", scatter: [0, -34, 200], drift: [0, -6, 8] },
    ...stages.filter((stage) => stage.id !== "breaker").map((stage, index): Cast => ({ m: COMPACT_POSITION[stage.id], id: stage.id, label: stage.label, sub: "Rule stage", line: stage.line, x: STAGE_POSITION[stage.id][0], y: STAGE_POSITION[stage.id][1], s: 12.5, ring: "stage", scatter: SCATTER[index % SCATTER.length], drift: DRIFT[index % DRIFT.length] })),
    { m: [0, 0], id: "covered_call", label: "Covered Call", sub: "Paper ready", line: "Sells a weekly call about 5% out of the money against shares you hold.", x: 10, y: 17, s: 9, ring: "outer", scatter: [-20, -20, -80], drift: [-22, -14, -20] },
    { m: [0, 0], id: "cash_secured_put", label: "Cash-Secured Put", sub: "Paper ready", line: "Sells a weekly put near 0.25 delta, with the strike held back as virtual USDG.", x: 90, y: 35, s: 9, ring: "outer", scatter: [24, -16, 110], drift: [24, -10, 22] },
    { m: [0, 0], id: "earnings_straddle", label: "Earnings Straddle", sub: "Paper ready", line: "Buys a call and a put before a confirmed earnings report.", x: 88, y: 90, s: 9, ring: "outer", scatter: [20, 24, -100], drift: [22, 16, -18] },
  ];
  const center = cast[0];
  const routes = cast.slice(1);
  const current = cast.find((node) => node.id === active) ?? null;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let raf = 0;
    let gaze: { x: number; y: number } | null = null;
    const apply = () => {
      raf = 0;
      const progress = clamp(window.scrollY / (window.innerHeight * 0.8));
      const spread = reduced ? 0 : smooth(0.08, 0.9, progress);
      root.style.setProperty("--sp", spread.toFixed(3));
      root.style.setProperty("--sy", reduced ? "0px" : `${Math.min(window.scrollY * 0.5, window.innerHeight * 0.45).toFixed(1)}px`);
      // Once it has fully broken apart and faded, nothing of it is left to paint.
      root.dataset.gone = spread >= 0.999 ? "1" : "0";
      if (gaze) {
        const box = root.getBoundingClientRect();
        root.style.setProperty("--gx", clamp(((gaze.x - (box.left + box.width / 2)) / (box.width / 2)), -1, 1).toFixed(2));
        root.style.setProperty("--gy", clamp(((gaze.y - (box.top + box.height / 2)) / (box.height / 2)), -1, 1).toFixed(2));
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const move = (event: PointerEvent) => { gaze = { x: event.clientX, y: event.clientY }; schedule(); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    if (!coarse && !reduced) window.addEventListener("pointermove", move, { passive: true });
    apply();

    // One quiet pass through the five rule stages once the pieces have assembled. Any touch of the ensemble ends it.
    let timer = 0;
    let started = false;
    let visible = true;
    const stageIds = stages.filter((stage) => stage.id !== "breaker").map((stage) => stage.id as string);
    const step = (index: number) => {
      if (touched.current || !visible) return;
      if (index >= stageIds.length) { setActive(null); return; }
      setActive(stageIds[index]);
      timer = window.setTimeout(() => step(index + 1), 2300);
    };
    const begin = () => {
      if (started || reduced) return;
      started = true;
      timer = window.setTimeout(() => step(0), 1700);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); }, { threshold: 0.2 });
    observer.observe(root);
    if (document.documentElement.dataset.splash === "active" || document.documentElement.dataset.splash === "lift") window.addEventListener("optra:splash-done", begin, { once: true });
    else timer = window.setTimeout(begin, 1500);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("optra:splash-done", begin);
    };
  }, [stages]);

  const choose = (id: string) => {
    touched.current = true;
    setActive((existing) => (existing === id ? null : id));
  };
  const hot = (node: Cast) => active !== null && (active === node.id || (active === center.id && node.ring !== "center"));

  return (
    <div ref={rootRef} className="ens" role="group" aria-label="The agent and its rule stages. Select one to follow its route.">
      {(["wide", "compact"] as const).map((set) => {
        const from = set === "wide" ? [center.x, center.y] : center.m;
        return (
          <svg key={set} className="ens-lines" data-set={set} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {routes.filter((node) => set === "wide" || node.ring !== "outer").map((node, index) => {
              const to = set === "wide" ? [node.x, node.y] : node.m;
              const mx = (from[0] + to[0]) / 2;
              const my = (from[1] + to[1]) / 2;
              const bend = (index % 2 === 0 ? 1 : -1) * (node.ring === "outer" ? 9 : 5);
              const dx = to[0] - from[0];
              const dy = to[1] - from[1];
              const len = Math.hypot(dx, dy) || 1;
              const cx = mx - (dy / len) * bend;
              const cy = my + (dx / len) * bend;
              return <path key={node.id} className="ens-line" data-ring={node.ring} data-hot={hot(node) ? "1" : "0"} style={{ "--flow": characterColor(node.id), "--i": index } as CSSProperties} d={`M${from[0]} ${from[1]} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${to[0]} ${to[1]}`} />;
            })}
          </svg>
        );
      })}

      {cast.map((node, index) => (
        <button
          type="button"
          key={node.id}
          className="ens-n"
          data-ring={node.ring}
          data-active={active === node.id ? "1" : "0"}
          data-bubble={BUBBLE[node.id] ?? "above"}
          aria-pressed={active === node.id}
          aria-label={`${node.label}. ${node.sub}. ${node.line}`}
          onClick={() => choose(node.id)}
          style={{ "--x": `${node.x}%`, "--y": `${node.y}%`, "--mx": `${node.m[0]}%`, "--my": `${node.m[1]}%`, "--s": node.s, "--i": index, "--fx": node.scatter[0], "--fy": node.scatter[1], "--fr": node.scatter[2], "--ox": 50 - node.x, "--oy": (50 - node.y) * (5 / 6), "--ocx": node.ring === "center" ? 0 : 50 - node.m[0], "--ocy": node.ring === "center" ? 0 : 44 - node.m[1], "--dx": node.drift[0], "--dy": node.drift[1], "--dr": node.drift[2] } as CSSProperties}
        >
          <span className="ens-drift">
            <span className="ens-pop">
              <span className="ens-char"><AgentCharacter id={node.id} size={96} /></span>
              <span className="ens-label"><b>{node.label}</b><small>{node.sub}</small></span>
            </span>
          </span>
          {active === node.id ? <span className="ens-bubble" aria-hidden="true"><b>{node.label}</b>{node.line}</span> : null}
        </button>
      ))}
      <p className="sr-only" role="status">{current ? `${current.label}: ${current.line}` : ""}</p>
    </div>
  );
}
