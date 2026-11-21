"use client";

import { useEffect, useRef } from "react";
import type { FloorScene, LabelKey } from "./floor-scene";
import { floorStore, useFloor } from "./floor-store";
import { ENTRY, floorReadout } from "./payoff";

/**
 * The signature visual: one fixed canvas behind the page that shows the Protective Floor.
 * It anchors itself to a slot in the layout. In the hero it holds still while the page scrolls, then breaks apart and fades as the hero leaves.
 * In the Protective Floor section it follows a sticky stage and answers to the two sliders and the view buttons.
 * Three.js is loaded on demand after first paint. With no WebGL2, Save-Data or a lost context, a flat SVG takes its place (see FloorDiagram).
 */

let webgl2: boolean | null = null;
function supportsWebgl2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2 = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const num = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const LABELS: LabelKey[] = ["floor", "entry", "with", "without", "axis", "cost"];

export function SignatureStage() {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<Partial<Record<LabelKey, HTMLElement | null>>>({});
  const { params } = useFloor();
  const readout = floorReadout(params);

  useEffect(() => {
    const layer = layerRef.current;
    const canvas = canvasRef.current;
    if (!layer || !canvas) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (!supportsWebgl2() || connection?.saveData) {
      floorStore.set({ gl: "off" });
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
    let scene: FloorScene | null = null;
    let cancelled = false;
    let raf = 0;
    const cleanups: (() => void)[] = [];

    const floorSlot = () => document.querySelector<HTMLElement>('[data-sig-slot="floor"]');

    // The object is about 19 world units wide; at zoom 1 the overview camera frames roughly 12 units of height. At zoom 1 it spans about
    // 2 x the viewport height in pixels and is about 0.62 as tall as it is wide. The zoom that fits a slot is limited by the slot's width and height.
    const fitFor = (rect: DOMRect) => clamp(Math.min(rect.width * 0.95, rect.height * 1.5) / (2 * window.innerHeight), 0.12, 1.2);

    const measure = () => {
      raf = 0;
      if (!scene) return;
      const vh = window.innerHeight;
      const floor = floorSlot();
      const floorRect = floor?.getBoundingClientRect();
      const seen = floorRect ? clamp((Math.min(floorRect.bottom, vh) - Math.max(floorRect.top, 0)) / Math.max(1, Math.min(floorRect.height, vh))) : 0;
      if (floorRect) scene.setAnchor({ cx: floorRect.left + floorRect.width * 0.47, cy: floorRect.top + floorRect.height / 2, fit: fitFor(floorRect) });
      scene.setExplode(0);
      const visibility = smooth(0.05, 0.5, seen);

      layer.style.setProperty("--sig", visibility.toFixed(3));
      layer.dataset.on = visibility > 0.01 ? "1" : "0";
      scene.setActive(visibility > 0.01 && !document.hidden);
      if (reduced) scene.renderOnce();
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    const start = async () => {
      const { createFloorScene } = await import("./floor-scene");
      if (cancelled) return;
      try {
        scene = createFloorScene(canvas, { reduced, lowPower, coarse, params: floorStore.get().params });
      } catch {
        floorStore.set({ gl: "off" });
        return;
      }
      scene.onContextLost(() => {
        floorStore.set({ gl: "off" });
        layer.dataset.on = "0";
      });
      const bound: Partial<Record<LabelKey, HTMLElement>> = {};
      for (const key of LABELS) {
        const el = labelRefs.current[key];
        if (el) bound[key] = el;
      }
      scene.bindLabels(bound);
      scene.setView(floorStore.get().view);
      floorStore.set({ gl: "ready" });

      // The columns assemble the first time the stage comes into view.
      const begin = () => scene?.playIntro();
      const intro = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { begin(); intro.disconnect(); } }, { threshold: 0.25 });
      const slot = floorSlot();
      if (slot) intro.observe(slot);
      else begin();
      cleanups.push(() => intro.disconnect());

      cleanups.push(floorStore.subscribe(() => {
        const next = floorStore.get();
        scene?.setParams(next.params);
        scene?.setView(next.view);
        if (next.view === "overview") scene?.setYaw(0);
        if (reduced) scene?.renderOnce();
      }));

      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
      cleanups.push(() => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); });
      const visibility = () => schedule();
      document.addEventListener("visibilitychange", visibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", visibility));

      if (!coarse && !reduced) {
        const move = (event: PointerEvent) => scene?.setPointer((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
        window.addEventListener("pointermove", move, { passive: true });
        cleanups.push(() => window.removeEventListener("pointermove", move));
      }

      // Dragging the floor stage turns the object a little. The view buttons are the keyboard route to the same views.
      const stage = floorSlot();
      if (stage) {
        let originX = 0;
        let originYaw = 0;
        let yaw = 0;
        const down = (event: PointerEvent) => {
          originX = event.clientX;
          originYaw = yaw;
          stage.setPointerCapture(event.pointerId);
          stage.dataset.drag = "1";
        };
        const drag = (event: PointerEvent) => {
          if (stage.dataset.drag !== "1") return;
          yaw = originYaw + (event.clientX - originX) / 420;
          scene?.setYaw(yaw);
        };
        const up = () => { stage.dataset.drag = "0"; };
        stage.addEventListener("pointerdown", down);
        stage.addEventListener("pointermove", drag);
        stage.addEventListener("pointerup", up);
        stage.addEventListener("pointercancel", up);
        cleanups.push(() => {
          stage.removeEventListener("pointerdown", down);
          stage.removeEventListener("pointermove", drag);
          stage.removeEventListener("pointerup", up);
          stage.removeEventListener("pointercancel", up);
        });
      }
      measure();
    };

    // First paint comes first. The 3D library loads when the browser is idle.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const idle = hasIdle ? window.requestIdleCallback(() => void start(), { timeout: 1200 }) : window.setTimeout(() => void start(), 250);

    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
      cleanups.forEach((fn) => fn());
      scene?.dispose();
      scene = null;
    };
  }, []);

  return (
    <div ref={layerRef} className="sig" data-on="0" data-scene="hero" aria-hidden="true">
      <canvas ref={canvasRef} className="sig-canvas" />
      <div className="sig-labels">
        <span ref={(el) => { labelRefs.current.floor = el; }} className="sig-label" data-key="floor"><b>Floor {num(readout.floor)}</b><i>strike {params.strike} minus premium {num(params.premium)}</i></span>
        <span ref={(el) => { labelRefs.current.entry = el; }} className="sig-label" data-key="entry"><b>Entry {ENTRY}</b></span>
        <span ref={(el) => { labelRefs.current.with = el; }} className="sig-label" data-key="with"><b>With the put</b></span>
        <span ref={(el) => { labelRefs.current.without = el; }} className="sig-label" data-key="without"><b>Holding alone</b></span>
        <span ref={(el) => { labelRefs.current.axis = el; }} className="sig-label" data-key="axis"><i>Price at expiry, 60 to 140</i></span>
        <span ref={(el) => { labelRefs.current.cost = el; }} className="sig-label" data-key="cost"><b>Premium paid</b></span>
      </div>
    </div>
  );
}
