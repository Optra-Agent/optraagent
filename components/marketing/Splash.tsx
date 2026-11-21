"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { BrandMark } from "../brand";
import { AgentCharacter, characterColor, characterDrawing, type CharacterId } from "./characters";

/**
 * The opening, on every full page load (not when you move between pages inside the site).
 * Particles are scattered at random across the whole screen, drifting in the dark while a counter runs. It collapses into the first agent, which leaves holes where its eyes will be.
 * The real character pops into place, opens its eyes and blinks. The rest of the cast arrives around it, joined by dotted routes that start to run.
 * Then it hands over to the page: the backdrop and the cast let go, and the first agent glides to the exact place it holds in the hero, where it lands alone.
 * The hero's routes and the rest of its cast then branch out of it.
 * Any key, scroll or tap skips it. Reduced motion skips it entirely. It never blocks input (pointer events pass through), it is under five seconds,
 * and a CSS failsafe removes it without JavaScript. The counter follows the opening's own timeline; it does not claim to measure loading.
 * The recipe line is the real hash of the default Protective Put recipe, computed on the server.
 */

const CONVERGE = 2300;
const CAST = 3000;
const TOTAL = 4800;
const DOCK = 1000;
const RING: CharacterId[] = ["gate", "strike", "size", "pulse", "expiry", "covered_call", "cash_secured_put", "earnings_straddle"];
const RADIUS = 37;
const STATUS: [number, string][] = [[0, "LOADING THE AGENT CAST"], [0.4, "ASSEMBLING SIX RULE STAGES"], [0.64, "CONNECTING THE ROUTES"], [0.86, "READY TO LAUNCH"]];

/** Module state outlives a client-side navigation but not a page load, so a reload plays the opening and a link inside the site does not. */
let played = false;

const ringPoint = (index: number) => {
  const angle = ((-90 + 22.5 + (index * 360) / RING.length) * Math.PI) / 180;
  return { x: Number((50 + RADIUS * Math.cos(angle)).toFixed(2)), y: Number((50 + RADIUS * Math.sin(angle)).toFixed(2)) };
};
const shortHash = (hash: string) => (hash.length > 20 ? `${hash.slice(0, 14)}…${hash.slice(-6)}` : hash);

type Particle = { x0: number; y0: number; vx: number; vy: number; wob: number; wf: number; wp: number; tx: number; ty: number; delay: number; size: number; shade: number };
type Firefly = { x: number; y: number; vx: number; vy: number; r: number; phase: number };

function sample(size: number, count: number): { x: number; y: number }[] {
  const art = characterDrawing("protective_put");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const k = size / 136;
  ctx.translate(size / 2, size / 2);
  ctx.scale(k, k);
  const body = new Path2D(art.body);
  ctx.fillStyle = art.fill;
  ctx.strokeStyle = art.fill;
  ctx.lineWidth = art.round;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fill(body);
  ctx.stroke(body);
  // The painted eyes are cut out of the body, so they read as holes the real eyes later fill.
  ctx.globalCompositeOperation = "destination-out";
  for (const eye of art.eyes) {
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, eye.r * 0.72, eye.ry * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = eye.width;
    ctx.stroke(new Path2D(eye.path));
  }
  const { data } = ctx.getImageData(0, 0, size, size);
  const filled: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (data[(y * size + x) * 4 + 3] > 140) filled.push({ x: x - size / 2, y: y - size / 2 });
  if (filled.length <= count) return filled;
  const step = filled.length / count;
  return Array.from({ length: count }, (_, index) => filled[Math.floor(index * step + Math.random() * step)]);
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ease = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

export function Splash({ recipeHash }: { recipeHash: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const html = document.documentElement;
    const finish = () => {
      root.dataset.state = "gone";
      html.dataset.splash = "done";
      window.dispatchEvent(new Event("optra:splash-done"));
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const skipByUrl = new URLSearchParams(window.location.search).get("splash") === "off";
    const ctx = canvas.getContext("2d");
    if (played || reduced || skipByUrl || !ctx) {
      finish();
      return;
    }

    html.dataset.splash = "active";
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const size = Math.round(Math.min(280, Math.max(150, Math.min(window.innerWidth, window.innerHeight) * 0.34)));
    root.style.setProperty("--splash-size", `${size}px`);
    const spot = root.querySelector<SVGElement>(".splash-agent")?.getBoundingClientRect();
    const centre = spot ? { x: spot.left + spot.width / 2, y: spot.top + spot.height / 2, unit: spot.width / 128 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 - 40, unit: size / 128 };
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const view = { w: window.innerWidth, h: window.innerHeight };
    canvas.width = view.w * ratio;
    canvas.height = view.h * ratio;
    ctx.scale(ratio, ratio);

    const targets = sample(128, coarse || (navigator.hardwareConcurrency ?? 8) <= 4 ? 1000 : 2600);
    // The scatter: particles sit at random places across the whole screen and drift on their own small paths, like dust in a dark room.
    const particles: Particle[] = targets.map((point) => ({
      x0: Math.random() * view.w,
      y0: Math.random() * view.h,
      vx: (Math.random() - 0.5) * 26,
      vy: (Math.random() - 0.5) * 26,
      wob: 4 + Math.random() * 16,
      wf: 0.4 + Math.random() * 1.6,
      wp: Math.random() * 6.28,
      // One sample pixel is 136/128 character units; the live SVG is 128 units across.
      tx: centre.x + point.x * (136 / 128) * centre.unit,
      ty: centre.y + point.y * (136 / 128) * centre.unit,
      delay: Math.random() * 0.55,
      size: 1 + Math.random() * 2.4,
      shade: Math.random(),
    }));
    const fireflies: Firefly[] = Array.from({ length: coarse ? 22 : 56 }, () => ({
      x: view.w * Math.random(), y: view.h * Math.random(), vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, r: 4 + Math.random() * 15, phase: Math.random() * 6.28,
    }));

    const started = performance.now();
    let frame = 0;
    let leaving = false;
    let exitTimer = 0;
    let removeTimer = 0;
    const done = () => {
      root.dataset.state = "gone";
      html.dataset.splash = "done";
      window.dispatchEvent(new Event("optra:splash-done"));
    };
    /** Carry the splash agent to where the hero keeps its own copy of it. Returns false when there is nowhere to land. */
    const dock = (agent: SVGElement | null) => {
      const target = document.querySelector<HTMLElement>('.ens:not([data-gone="1"]) .ens-n[data-ring="center"] .ens-char');
      if (!agent || !target) return false;
      agent.style.animation = "none";
      agent.style.opacity = "1";
      agent.style.transform = "scale(1)";
      const from = agent.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      if (to.width < 8 || from.width < 8 || to.bottom < 0 || to.top > window.innerHeight) return false;
      agent.style.transition = `transform ${DOCK}ms cubic-bezier(0.65, 0, 0.2, 1)`;
      agent.style.transform = `translate(${(to.left + to.width / 2 - (from.left + from.width / 2)).toFixed(1)}px, ${(to.top + to.height / 2 - (from.top + from.height / 2)).toFixed(1)}px) scale(${(to.width / from.width).toFixed(4)})`;
      return true;
    };
    const lift = () => {
      if (leaving) return;
      leaving = true;
      played = true;
      const seen = root.dataset.state;
      if (countRef.current) countRef.current.textContent = "100";
      root.style.setProperty("--p", "1");
      root.dataset.state = "lift";
      html.dataset.splash = "lift";
      // Only an agent that has already appeared can travel; an early skip simply lets go.
      const docked = (seen === "form" || seen === "cast") && dock(root.querySelector<SVGElement>(".splash-agent"));
      removeTimer = window.setTimeout(done, docked ? DOCK + 40 : 520);
    };

    const draw = (now: number) => {
      if (leaving) return;
      const elapsed = now - started;
      const p = clamp01(elapsed / TOTAL);
      // Trails: fade what is already drawn instead of clearing it, so each particle leaves a streak behind it.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.globalCompositeOperation = "source-over";

      // Soft glowing dots drift through the cloud and fade out as it collapses.
      const glow = (1 - clamp01((elapsed - 1500) / 800)) * Math.min(1, elapsed / 500);
      if (glow > 0.01) {
        for (const fly of fireflies) {
          fly.x += fly.vx; fly.y += fly.vy;
          const pulse = 0.55 + 0.45 * Math.sin(elapsed / 480 + fly.phase);
          const g = ctx.createRadialGradient(fly.x, fly.y, 0, fly.x, fly.y, fly.r * 2.2);
          g.addColorStop(0, `rgba(140,196,255,${(0.7 * pulse * glow).toFixed(3)})`);
          g.addColorStop(1, "rgba(140,196,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(fly.x - fly.r * 2.2, fly.y - fly.r * 2.2, fly.r * 4.4, fly.r * 4.4);
        }
      }

      const seconds = elapsed / 1000;
      for (const particle of particles) {
        // Drift across the screen (wrapping at the edges) with a little wobble, then collapse into the character at its own time.
        const dx = (((particle.x0 + particle.vx * seconds) % view.w) + view.w) % view.w + Math.sin(seconds * particle.wf + particle.wp) * particle.wob;
        const dy = (((particle.y0 + particle.vy * seconds) % view.h) + view.h) % view.h + Math.cos(seconds * particle.wf * 0.8 + particle.wp) * particle.wob;
        const t = ease((seconds - 0.9 - particle.delay) / 1.25);
        const x = dx + (particle.tx - dx) * t;
        const y = dy + (particle.ty - dy) * t;
        const twinkle = 0.55 + 0.45 * Math.sin(seconds * 2.2 * particle.wf + particle.wp);
        ctx.globalAlpha = Math.min(1, elapsed / 450) * (0.3 + 0.7 * twinkle * (1 - t) + 0.7 * t);
        ctx.fillStyle = particle.shade > 0.94 ? "#ff6a47" : particle.shade > 0.86 ? "#f3f4f6" : particle.shade > 0.58 ? "#8cc4ff" : particle.shade > 0.28 ? "#6db4ff" : "#4a8fd9";
        ctx.fillRect(x, y, particle.size, particle.size);
      }
      ctx.globalAlpha = 1;

      // The counter, the progress line and the status text all follow this same timeline.
      if (countRef.current) countRef.current.textContent = String(Math.round(p * 100)).padStart(2, "0");
      root.style.setProperty("--p", p.toFixed(3));
      const status = [...STATUS].reverse().find(([from]) => p >= from)?.[1] ?? STATUS[0][1];
      if (statusRef.current && statusRef.current.textContent !== status) statusRef.current.textContent = status;

      const state = root.dataset.state;
      if (elapsed >= CAST && state !== "cast") root.dataset.state = "cast";
      else if (elapsed >= CONVERGE && state === "boot") root.dataset.state = "form";
      if (elapsed >= TOTAL) lift();
      else frame = requestAnimationFrame(draw);
    };
    root.dataset.state = "boot";
    frame = requestAnimationFrame(draw);
    exitTimer = window.setTimeout(lift, TOTAL + 600);

    const skip = () => lift();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });
    window.addEventListener("touchstart", skip, { once: true, passive: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("wheel", skip);
      window.removeEventListener("touchstart", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, []);

  return (
    <div ref={rootRef} className="splash" data-state={played ? "gone" : "wait"} aria-hidden="true">
      <canvas ref={canvasRef} className="splash-canvas" />
      <div className="splash-box">
        <svg className="splash-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          {RING.map((id, index) => {
            const p = ringPoint(index);
            return <path key={id} className="splash-line" style={{ "--i": index, "--flow": characterColor(id) } as CSSProperties} d={`M50 50 L${p.x} ${p.y}`} />;
          })}
        </svg>
        {RING.map((id, index) => {
          const p = ringPoint(index);
          return (
            <span key={id} className="splash-cast" style={{ left: `${p.x}%`, top: `${p.y}%`, "--i": index } as CSSProperties}>
              <AgentCharacter id={id} size={96} />
            </span>
          );
        })}
        <AgentCharacter id="protective_put" size={260} className="splash-agent" />
      </div>
      <div className="splash-mark">
        <p className="splash-word"><BrandMark /><span>OPTRA <small>AGENT</small></span></p>
        <p className="splash-tag">BUILD · DEPLOY · CONTROL</p>
      </div>
      <p className="splash-status">
        <span ref={statusRef} className="splash-status-line">LOADING THE AGENT CAST</span>
        <small>PROTECTIVE PUT RECIPE · {shortHash(recipeHash)}</small>
      </p>
      <p className="splash-count"><span ref={countRef}>00</span> %</p>
      <div className="splash-bar" aria-hidden="true"><i /></div>
    </div>
  );
}
