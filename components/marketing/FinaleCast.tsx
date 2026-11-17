"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { AgentCharacter, type GuestCharacterId } from "./characters";

/**
 * The company on the closing stage: six bodies the hero does not use, standing on the floor line behind the curtain.
 * They are decoration. They do not stand for products, results or rule stages, so they carry no labels.
 * Each one blinks on its own beat, and on a pointer device their eyes follow the cursor.
 */
type Guest = { id: GuestCharacterId; /** Centre, in percent of the stage width. */ x: number; /** Height of the feet above the floor line, in percent of the stage height. */ y: number; /** Width in percent of the stage width. */ s: number; tilt: number };

const GUESTS: Guest[] = [
  { id: "drop", x: 10.5, y: 0, s: 13, tilt: -5 },
  { id: "door", x: 23, y: 0, s: 11, tilt: 4 },
  { id: "visor", x: 16, y: 36, s: 9, tilt: -3 },
  { id: "dome", x: 77.5, y: 0, s: 13.5, tilt: 3 },
  { id: "slant", x: 90.5, y: 0, s: 10.5, tilt: -6 },
  { id: "plus", x: 84.5, y: 37, s: 9, tilt: 5 },
];

export function FinaleCast() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    let at: { x: number; y: number } | null = null;
    const apply = () => {
      raf = 0;
      if (!at) return;
      const box = root.getBoundingClientRect();
      const clamp = (value: number) => Math.min(1, Math.max(-1, value));
      root.style.setProperty("--gx", clamp((at.x - (box.left + box.width / 2)) / (box.width / 2)).toFixed(2));
      root.style.setProperty("--gy", clamp((at.y - (box.top + box.height / 2)) / (box.height / 2)).toFixed(2));
    };
    const move = (event: PointerEvent) => {
      at = { x: event.clientX, y: event.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <div ref={ref} className="fin-cast" aria-hidden="true">
      {GUESTS.map((guest, index) => (
        <span key={guest.id} className="fin-b" data-guest={guest.id} style={{ "--x": `${guest.x}%`, "--y": `${guest.y}%`, "--s": guest.s, "--tilt": `${guest.tilt}deg`, "--i": index } as CSSProperties}>
          <span className="fin-pop">
            <span className="fin-char"><AgentCharacter id={guest.id} size={120} /></span>
          </span>
        </span>
      ))}
    </div>
  );
}
