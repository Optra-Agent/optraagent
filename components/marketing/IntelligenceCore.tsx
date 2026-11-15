"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { drawIntelligenceCore } from "./intelligence-core-canvas";
import { sampleIntelligenceCore } from "./intelligence-core-model";
import type { IntelligenceCoreModel } from "./intelligence-core-model";

const STATES = [
  { name: "Agent Core", detail: "One paper agent, with its identity and constraints at the center." },
  { name: "Strategy Formation", detail: "Protective Put unfolds across Gate, Strike, Size, Pulse, and Expiry." },
  { name: "Hook Evaluation", detail: "15 implemented hooks are active. 21 catalog-only hooks stay inactive." },
  { name: "Risk Protection", detail: "Five Breaker rules guard the strategy's entry path." },
  { name: "Decision & Evidence", detail: "A paper decision can be represented in private Tape. This picture is illustrative." },
] as const;

function svgPoint(point: { x: number; y: number; z: number }) {
  return { x: 450 + point.x * 385 + point.z * 18, y: 224 + point.y * 178 + point.z * 11 };
}

function ServerFrame({ model, state }: { model: IntelligenceCoreModel; state: number }) {
  const progress = (state + 0.5) / STATES.length;
  const points = sampleIntelligenceCore(model, progress);
  const pointMap = new Map(points.map((point) => [point.id, svgPoint(point)]));
  const route = ["core", ...model.strategyStages.map(({ id }) => `stage:${id}`), "decision", "tape"]
    .map((id) => pointMap.get(id))
    .filter((point): point is { x: number; y: number } => Boolean(point));
  const d = route.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const center = pointMap.get("core") ?? { x: 450, y: 225 };
  return (
    <svg className="fs-core-fallback" viewBox="0 0 900 450" role="img" aria-label={`${STATES[state]?.name ?? STATES[0].name}: Protective Put paper strategy anatomy`}>
      <defs>
        <radialGradient id="optra-core-glow"><stop offset="0" stopColor="#c9e8ff" /><stop offset="0.18" stopColor="#238cff" stopOpacity=".82" /><stop offset="1" stopColor="#238cff" stopOpacity="0" /></radialGradient>
      </defs>
      <g className="fs-core-orbits">
        <ellipse cx={center.x} cy={center.y} rx="135" ry="70" />
        <ellipse cx={center.x} cy={center.y} rx="195" ry="105" />
        <ellipse cx={center.x} cy={center.y} rx="260" ry="145" />
      </g>
      <path className="fs-core-route" d={d} />
      <g className="fs-core-branches">
        {model.hooks.map((hook) => {
          const from = pointMap.get(hook.stage === "breaker" ? "core" : `stage:${hook.stage}`);
          const to = pointMap.get(`hook:${hook.id}`);
          if (!from || !to) return null;
          return <path key={hook.id} d={`M${from.x} ${from.y} Q${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 3} ${to.x} ${to.y}`} data-live={hook.live ? "1" : "0"} />;
        })}
      </g>
      <g className="fs-core-nodes">
        {points.filter(({ kind }) => kind !== "core").map((point) => {
          const position = pointMap.get(point.id);
          if (!position) return null;
          return <circle key={point.id} cx={position.x} cy={position.y} r={point.kind === "stage" ? 5.8 : point.kind === "decision" ? 7 : point.kind === "tape" ? 5 : point.kind === "breaker" ? 4 : point.live ? 3 : 2} data-kind={point.kind} data-live={point.live ? "1" : "0"} data-selected={point.selected ? "1" : "0"} />;
        })}
      </g>
      <circle className="fs-core-nucleus" cx={center.x} cy={center.y} r="50" fill="url(#optra-core-glow)" />
      <circle className="fs-core-nucleus-center" cx={center.x} cy={center.y} r="13" />
      <text className="fs-core-label" x={center.x} y={center.y + 76} textAnchor="middle">OPTRA · PAPER AGENT</text>
      {state === 4 ? <text className="fs-core-warning" x="450" y="418" textAnchor="middle">ILLUSTRATIVE · NO RECORDED TRADE</text> : null}
    </svg>
  );
}

type Props = {
  model: IntelligenceCoreModel;
  progressRef: MutableRefObject<number>;
  activeState: number;
  onSelectState: (index: number) => void;
};

export function IntelligenceCore({ model, progressRef, activeState, onSelectState }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const visualStateRef = useRef(activeState);
  const [canvasReady, setCanvasReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let visible = typeof IntersectionObserver === "undefined";
    let prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    let prefersSaveData = Boolean(connection?.saveData);
    let lastPaint = 0;
    let frameCount = 0;

    const paint = (time = performance.now()) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, rect.width < 500 ? 1.5 : 2);
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const progress = prefersReduced ? (visualStateRef.current + 0.5) / STATES.length : progressRef.current;
      canvas.dataset.progress = progress.toFixed(3);
      canvas.dataset.frameCount = String(++frameCount);
      drawIntelligenceCore(context, model, progress, rect.width, rect.height, time / 1000, !prefersReduced && !prefersSaveData);
      setCanvasReady(true);
    };

    const requestPaint = () => {
      if (!visible || frameRef.current) return;
      frameRef.current = window.requestAnimationFrame((time) => {
        frameRef.current = 0;
        paint(time);
      });
    };

    const tick = (time: number) => {
      frameRef.current = 0;
      if (!visible) return;
      if (prefersReduced || prefersSaveData) {
        paint(time);
        return;
      }
      if (time - lastPaint >= 33) {
        lastPaint = time;
        paint(time);
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    const updateMotionPreference = () => {
      prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setReducedMotion(prefersReduced);
      if (visible) {
        if (prefersReduced || prefersSaveData) {
          if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
          frameRef.current = 0;
          requestPaint();
        }
        else if (!frameRef.current) frameRef.current = window.requestAnimationFrame(tick);
      }
    };
    const updateSaveData = () => {
      prefersSaveData = Boolean(connection?.saveData);
      setSaveData(prefersSaveData);
      updateMotionPreference();
    };
    const onScroll = () => {
      if (prefersReduced || prefersSaveData) requestPaint();
    };
    const onResize = () => requestPaint();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    resizeObserver?.observe(canvas);
    const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      setActive(visible);
      if (!visible) {
        if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      } else if (!prefersReduced && !prefersSaveData) {
        frameRef.current = window.requestAnimationFrame(tick);
      } else requestPaint();
    }, { threshold: 0.02, rootMargin: "120px 0px" });
    intersectionObserver?.observe(canvas);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    connection?.addEventListener("change", updateSaveData);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    motionQuery.addEventListener("change", updateMotionPreference);

    setReducedMotion(prefersReduced);
    setSaveData(prefersSaveData);
    if (visible) {
      paint();
      if (!prefersReduced && !prefersSaveData) frameRef.current = window.requestAnimationFrame(tick);
    }
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      connection?.removeEventListener("change", updateSaveData);
      motionQuery.removeEventListener("change", updateMotionPreference);
    };
  }, [model, progressRef]);

  useEffect(() => { visualStateRef.current = activeState; }, [activeState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;
    const frame = window.requestAnimationFrame(() => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, bounds.width < 500 ? 1.5 : 2);
      canvas.width = Math.round(bounds.width * ratio);
      canvas.height = Math.round(bounds.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const progress = reducedMotion ? (visualStateRef.current + 0.5) / STATES.length : progressRef.current;
      canvas.dataset.progress = progress.toFixed(3);
      drawIntelligenceCore(context, model, progress, bounds.width, bounds.height, 0, false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeState, model, progressRef, reducedMotion]);

  const fallbackState = Math.min(STATES.length - 1, Math.max(0, activeState));
  return (
    <figure className="fs-core" data-core-state={fallbackState} data-renderer={canvasReady ? "canvas" : "svg"} data-active={active ? "1" : "0"} data-reduced-motion={reducedMotion ? "1" : "0"} data-save-data={saveData ? "1" : "0"} data-hook-total={model.hooks.length} data-hook-live={model.hooks.filter(({ live }) => live).length} data-hook-catalog-only={model.hooks.filter(({ live }) => !live).length} data-breaker-count={model.breakers.length}>
      <div className="fs-core-stage">
        <ServerFrame model={model} state={fallbackState} />
        <canvas ref={canvasRef} className="fs-core-canvas" aria-hidden="true" />
        <div className="fs-core-index" aria-hidden="true"><span>OPTRA</span><i /> <span>INTELLIGENCE CORE</span><b>0{fallbackState + 1} / 05</b></div>
        <div className="fs-core-controls" role="group" aria-label="Intelligence Core stages">
          {STATES.map((state, index) => (
            <button key={state.name} type="button" aria-pressed={fallbackState === index} aria-controls="forge-core-caption" onClick={() => onSelectState(index)}>
              <span className="fs-core-control-index">0{index + 1}</span><span>{state.name}</span>
            </button>
          ))}
        </div>
      </div>
      <figcaption id="forge-core-caption" className="fs-core-caption" aria-live="polite" aria-atomic="true">
        <span className="fs-core-caption-count mono">CORE / 0{fallbackState + 1}</span>
        <span><b>{STATES[fallbackState]?.name}</b><small>{STATES[fallbackState]?.detail}</small></span>
        <span className="fs-core-caption-note">No live execution · paper system</span>
      </figcaption>
    </figure>
  );
}
