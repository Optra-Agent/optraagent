"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

/**
 * The page ruler on the right edge. A tape of ticks from 0 to 100 slides past a fixed needle that reads the scroll position as a percentage.
 * The section names wait stacked at the bottom. As their section nears, each name breaks into letters that swing in an arc onto the ruler, stand in a vertical column,
 * ride up it, and settle back into a word in the parked list at the top. Fast scrolling smears the tape and the names in flight with a little motion blur.
 * Hover the ruler and the tape stretches to the full height, with every name sitting beside the tick where its section starts.
 * Every name is a real link. Below 1360px the page menu does this job and the ruler is not drawn.
 *
 * All positions are written straight to the DOM from one scroll-driven frame loop, so scrolling never goes through React.
 */
const STOPS: { id: string; label: string }[] = [
  { id: "intro", label: "Intro" },
  { id: "floor", label: "Floor" },
  { id: "app", label: "App" },
  { id: "agents", label: "Agents" },
  { id: "studio", label: "Agent" },
  { id: "forge", label: "Forge" },
  { id: "how", label: "How" },
  { id: "tape", label: "Tape" },
  { id: "sessions", label: "Risk" },
  { id: "developers", label: "API" },
  { id: "verify", label: "Verify" },
  { id: "faq", label: "FAQ" },
];
const TICKS = Array.from({ length: 101 }, (_, index) => index);

const ROW = 21; // vertical room for one name
const TOP = 92; // first parked name, below the site header
const FOOT = 40; // gap under the stack
const U_REST = 10.5; // px per percent on the sliding tape
const FOLD_X = 14; // where the vertical column of letters stands, measured from the right edge of the word
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

export function StageRail() {
  const railRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const tape = rail.querySelector<HTMLElement>(".rail-tape");
    const needle = rail.querySelector<HTMLElement>(".rail-needle");
    const readout = rail.querySelector<HTMLElement>("[data-pct]");
    const links = Array.from(rail.querySelectorAll<HTMLAnchorElement>(".rail-label"));
    if (!tape || !needle) return;
    // Per name: its letters, where each stands inside the word, and where each goes in the vertical column.
    type Word = { glyphs: HTMLElement[]; dx: number[]; dy: number[]; key: string };
    const words: Word[] = links.map((link) => ({ glyphs: Array.from(link.querySelectorAll<HTMLElement>(".rail-g")), dx: [], dy: [], key: "" }));

    const wide = window.matchMedia("(min-width: 1360px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    let vh = window.innerHeight;
    let scrollable = 1;
    let tops: number[] = STOPS.map(() => 1e9);
    let shown: number[] = STOPS.map(() => 0);
    let raf = 0;
    let last = 0;
    let ex = 0;
    let exTarget = 0;
    let lastActive = -1;
    let lastPct = -1;
    let lastU = -1;
    let lastEx = -1;
    let lastY = -1;
    let vel = 0;
    let lastBlur = -1;
    let dirty = true;

    const measure = () => {
      vh = window.innerHeight;
      scrollable = Math.max(1, document.documentElement.scrollHeight - vh);
      tops = STOPS.map((stop) => {
        const el = document.getElementById(stop.id);
        return el ? el.getBoundingClientRect().top + window.scrollY : 1e9;
      });
      links.forEach((link, index) => {
        const word = words[index];
        if (!word) return;
        const width = link.offsetWidth;
        let run = 0;
        word.glyphs.forEach((glyph, j) => {
          const w = glyph.offsetWidth;
          const first = word.glyphs[0]?.offsetWidth ?? w;
          word.dx[j] = width + FOLD_X - (glyph.offsetLeft + w / 2);
          word.dy[j] = -(run + w / 2 - first / 2);
          run += w;
        });
        word.key = "";
      });
      // Where each name sits on the stretched ruler: at its section's percentage, pushed apart so the names never touch.
      const ue = (vh - TOP - FOOT) / 100;
      const gap = ROW / ue;
      shown = tops.map((top) => clamp((top / scrollable) * 100, 0, 100));
      for (let i = 1; i < shown.length; i += 1) shown[i] = Math.max(shown[i], shown[i - 1] + gap);
      const end = shown.length - 1;
      if (shown[end] > 100) {
        shown[end] = 100;
        for (let i = end - 1; i >= 0; i -= 1) shown[i] = Math.min(shown[i], shown[i + 1] - gap);
      }
      dirty = true;
      schedule();
    };

    const frame = (now: number) => {
      raf = 0;
      if (!wide.matches) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      let moving = false;
      if (ex !== exTarget) {
        ex = still.matches ? exTarget : ex + (exTarget - ex) * (1 - Math.exp(-dt * 11));
        if (Math.abs(ex - exTarget) < 0.002) ex = exTarget;
        moving = ex !== exTarget;
        dirty = true;
      }
      const y = window.scrollY;
      const speed = lastY < 0 ? 0 : Math.abs(y - lastY) / (dt * 1000);
      vel += (speed - vel) * (1 - Math.exp(-dt * 9));
      if (vel < 0.02) vel = 0;
      if (y === lastY && !dirty && vel === 0 && lastBlur === 0) return;
      lastY = y;
      dirty = false;
      // Motion blur on the tape: none at rest, up to a couple of pixels when the page is flying past.
      const blur = still.matches ? 0 : clamp(vel / 5000, 0, 1) * 2.2;
      if (Math.abs(blur - lastBlur) > 0.05 || (blur === 0 && lastBlur !== 0)) {
        lastBlur = blur < 0.05 ? 0 : blur;
        tape.style.filter = lastBlur === 0 ? "" : `blur(${lastBlur.toFixed(2)}px)`;
      }

      const progress = clamp(y / scrollable);
      const ueFull = (vh - TOP - FOOT) / 100;
      const u = lerp(U_REST, ueFull, ex);
      const restY = lerp(vh * 0.2, vh * 0.56, progress);
      const needleY = lerp(restY, TOP + progress * 100 * ueFull, ex);
      tape.style.transform = `translate3d(0, ${(needleY - progress * 100 * u).toFixed(2)}px, 0)`;
      needle.style.transform = `translate3d(0, ${needleY.toFixed(2)}px, 0)`;
      if (Math.abs(u - lastU) > 0.01) {
        lastU = u;
        tape.style.setProperty("--u", `${u.toFixed(3)}px`);
      }
      if (Math.abs(ex - lastEx) > 0.001) {
        lastEx = ex;
        rail.style.setProperty("--ex", ex.toFixed(3));
      }
      const pct = Math.round(progress * 100);
      if (pct !== lastPct && readout) {
        lastPct = pct;
        readout.textContent = String(pct);
      }

      // The section whose top has passed the reading line is the current one.
      let active = 0;
      tops.forEach((top, index) => { if (top - y <= vh * 0.4) active = index; });
      const n = STOPS.length;
      links.forEach((link, index) => {
        // 0 while the section is still below the fold, 1 once its top reaches the reading line.
        const top = tops[index] ?? 1e9;
        const arrive = still.matches ? (top - y <= vh * 0.4 ? 1 : 0) : clamp((vh * 1.1 - (top - y)) / (vh * 0.7));
        // Phases: wait, break into letters and swing onto the ruler, climb as a column, settle back into a word.
        const climb = ease(clamp((arrive - 0.3) / 0.55));
        const fold = still.matches ? 0 : arrive <= 0.12 ? 0 : arrive < 0.36 ? ease((arrive - 0.12) / 0.24) : arrive < 0.78 ? 1 : 1 - ease((arrive - 0.78) / 0.22);
        const f = fold * (1 - ex);
        const stackY = vh - FOOT - (n - 1 - index) * ROW;
        const parkY = TOP + index * ROW;
        const overviewY = TOP + (shown[index] ?? 0) * ueFull - ROW / 2;
        link.style.transform = `translate3d(0, ${lerp(lerp(stackY, parkY, climb), overviewY, ex).toFixed(2)}px, 0)`;
        const state = index === active ? "active" : arrive > 0.98 ? "passed" : "ahead";
        if (link.dataset.state !== state) link.dataset.state = state;
        const word = words[index];
        if (!word) return;
        const key = `${Math.round(f * 500)}`;
        if (key === word.key) return;
        word.key = key;
        const count = word.glyphs.length;
        word.glyphs.forEach((glyph, j) => {
          const fj = ease(clamp(f * 1.6 - (j / Math.max(1, count)) * 0.6));
          if (fj === 0) { glyph.style.transform = ""; return; }
          const arc = Math.sin(Math.PI * fj) * (-18 - (j % 3) * 7);
          glyph.style.transform = `translate3d(${((word.dx[j] ?? 0) * fj).toFixed(2)}px, ${((word.dy[j] ?? 0) * fj + arc).toFixed(2)}px, 0) rotate(${(-90 * fj).toFixed(1)}deg)`;
        });
        // A name in flight smears a little, most of all halfway through.
        const flight = still.matches ? 0 : Math.sin(Math.PI * clamp(arrive)) * 1.6 * (1 - ex);
        link.style.filter = flight > 0.08 ? `blur(${flight.toFixed(2)}px)` : "";
      });
      if (active !== lastActive) {
        lastActive = active;
        links.forEach((link, index) => {
          if (index === active) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      }
      if (moving || vel > 0 || lastBlur > 0) schedule();
    };

    function schedule() {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    const onScroll = () => schedule();
    const onResize = () => measure();
    const open = () => { exTarget = 1; schedule(); };
    const close = () => { exTarget = 0; schedule(); };

    measure();
    const settle = window.setTimeout(measure, 600);
    void document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("load", measure);
    wide.addEventListener("change", measure);
    rail.querySelector(".rail-hit")?.addEventListener("pointerenter", open);
    links.forEach((link) => { link.addEventListener("pointerenter", open); link.addEventListener("focus", open); link.addEventListener("blur", close); });
    rail.addEventListener("pointerleave", close);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("load", measure);
      wide.removeEventListener("change", measure);
      rail.querySelector(".rail-hit")?.removeEventListener("pointerenter", open);
      links.forEach((link) => { link.removeEventListener("pointerenter", open); link.removeEventListener("focus", open); link.removeEventListener("blur", close); });
      rail.removeEventListener("pointerleave", close);
    };
  }, []);

  return (
    <nav ref={railRef} className="rail" aria-label="Page progress">
      <div className="rail-bg" aria-hidden="true" />
      <div className="rail-view" aria-hidden="true">
        <div className="rail-tape">
          {TICKS.map((n) => (
            <i key={n} className="rail-tick" data-k={n % 10 === 0 ? "major" : n % 5 === 0 ? "mid" : "minor"} style={{ "--n": n } as CSSProperties}>
              {n % 10 === 0 ? <span>{n}</span> : null}
            </i>
          ))}
        </div>
      </div>
      <div className="rail-needle" aria-hidden="true">
        <i />
        <b><span data-pct="">0</span><small>/100</small></b>
      </div>
      <div className="rail-hit" aria-hidden="true" />
      <ol className="rail-labels">
        {STOPS.map((stop) => (
          <li key={stop.id}>
            <a className="rail-label" href={`#${stop.id}`} aria-label={stop.label} data-state="ahead">
              {Array.from(stop.label).map((ch, index) => <span key={index} className="rail-g" aria-hidden="true">{ch}</span>)}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
