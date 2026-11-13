"use client";

import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A short scroll story. On wide, tall screens the `.ps-pin` block is `position: sticky`; the track is only as long as
 * the pin plus (count - 1) beats, so it releases naturally. Scroll progress through the track picks the active step,
 * and scrolling back up reverses it. There is no scroll hijacking and no snapping: the page always scrolls normally.
 *
 * - `go(i)` (a click or key press on a step) scrolls to that step's place in the track and activates it. For a short
 *   moment scroll progress is ignored so the two never fight.
 * - Below 1000px, on short screens, with no JavaScript, or when the browser cannot stick, the pin is a normal block
 *   and the steps act as tabs. Without JavaScript every view is shown, stacked.
 * - `views` are stacked in one grid cell so the stage keeps the height of its tallest view and nothing jumps.
 */
export type PinnedStoryApi = { go: (index: number) => void; views: ReactNode };

type Props = {
  id: string;
  count: number;
  step: number;
  /** Called when scroll or `go` changes the step. Not called for steps the parent set itself. */
  onStep: (index: number, source: "scroll" | "go") => void;
  views?: ReactNode[];
  variant?: "split" | "stack";
  /** Scroll distance per extra step, as a CSS length. Keep it short: this is understanding, not scroll length. */
  beat?: string;
  className?: string;
  children: (api: PinnedStoryApi) => ReactNode;
};

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PinnedStory({ id, count, step, onStep, views, variant = "split", beat = "38vh", className, children }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);
  const current = useRef(step);
  const onStepRef = useRef(onStep);
  useEffect(() => { current.current = step; onStepRef.current = onStep; });

  const sticky = () => {
    const pin = pinRef.current;
    return Boolean(pin) && getComputedStyle(pin as Element).position === "sticky";
  };
  const geometry = () => {
    const track = trackRef.current;
    const pin = pinRef.current;
    if (!track || !pin) return null;
    const top = parseFloat(getComputedStyle(pin).top) || 0;
    const range = Math.max(1, track.offsetHeight - pin.offsetHeight);
    return { top, range, trackTop: track.getBoundingClientRect().top };
  };

  const sync = useCallback(() => {
    if (performance.now() < lockUntil.current || !sticky()) return;
    const geo = geometry();
    if (!geo) return;
    const progress = Math.min(1, Math.max(0, (geo.top - geo.trackTop) / geo.range));
    const next = Math.min(count - 1, Math.floor(progress * count));
    if (next !== current.current) {
      current.current = next;
      onStepRef.current(next, "scroll");
    }
  }, [count]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; sync(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sync]);

  const go = useCallback((index: number) => {
    const next = Math.min(count - 1, Math.max(0, index));
    current.current = next;
    onStepRef.current(next, "go");
    if (!sticky()) return;
    const geo = geometry();
    if (!geo) return;
    const absoluteTrackTop = geo.trackTop + window.scrollY;
    const target = absoluteTrackTop - geo.top + ((next + 0.5) / count) * geo.range;
    const calm = reduced();
    lockUntil.current = performance.now() + (calm ? 120 : 900);
    window.scrollTo({ top: target, behavior: calm ? "auto" : "smooth" });
    window.setTimeout(sync, calm ? 140 : 950);
  }, [count, sync]);

  const stage = views ? (
    <div className="ps-views">
      {views.map((view, index) => (
        <section
          key={index}
          id={`${id}-view-${index}`}
          className="ps-view"
          data-state={index === step ? "active" : index < step ? "past" : "future"}
          aria-hidden={index === step ? undefined : true}
          inert={index === step ? undefined : true}
        >
          {view}
        </section>
      ))}
    </div>
  ) : null;

  return (
    <div ref={trackRef} className={cn("ps", className)} data-variant={variant} data-step={step} style={{ "--n": count, "--beat": beat } as CSSProperties}>
      <div ref={pinRef} className="ps-pin">
        {/* eslint-disable-next-line react-hooks/refs -- `go` only touches refs inside event handlers, never while rendering */}
        {children({ go, views: stage })}
      </div>
    </div>
  );
}
