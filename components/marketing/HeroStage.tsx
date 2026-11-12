"use client";

import dynamic from "next/dynamic";
import { useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

// LaserFlow is a WebGL2 canvas. It is loaded client-side only, once, and only in the landing hero.
const LaserFlow = dynamic(() => import("../LaserFlow"), { ssr: false });

type LaserMode = "pending" | "webgl" | "fallback";
type LaserCaps = { mode: LaserMode; reduced: boolean; compact: boolean; coarse: boolean; lowPower: boolean };

let webgl2Supported: boolean | null = null;
function supportsWebgl2(): boolean {
  if (webgl2Supported !== null) return webgl2Supported;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2Supported = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2Supported = false;
  }
  return webgl2Supported;
}

const queries = ["(prefers-reduced-motion: reduce)", "(max-width: 767px)", "(pointer: coarse)"] as const;

function readCaps(): string {
  const [reduced, compact, coarse] = queries.map((query) => window.matchMedia(query).matches);
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const gl = supportsWebgl2() && !connection?.saveData;
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  return [gl ? "gl" : "flat", reduced ? "reduced" : "motion", compact ? "compact" : "wide", coarse ? "coarse" : "fine", lowPower ? "low" : "ok"].join(" ");
}

function subscribe(callback: () => void): () => void {
  const lists = queries.map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", callback));
  return () => lists.forEach((list) => list.removeEventListener("change", callback));
}

function useLaserCaps(): LaserCaps {
  const key = useSyncExternalStore(subscribe, readCaps, () => "pending");
  if (key === "pending") return { mode: "pending", reduced: false, compact: false, coarse: false, lowPower: false };
  const [gl, motion, size, pointer, power] = key.split(" ");
  return { mode: gl === "gl" ? "webgl" : "fallback", reduced: motion === "reduced", compact: size === "compact", coarse: pointer === "coarse", lowPower: power === "low" };
}

/**
 * The hero stage: a Protective Put recipe card with the Ember beam landing on its top edge.
 * Server-rendered children fill the card. Without WebGL2 (or with Save-Data) a static CSS beam takes over;
 * reduced motion renders a still LaserFlow frame; compact and touch screens render at 1x with no pointer lens.
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const caps = useLaserCaps();

  return (
    <div className="hero-stage" data-laser={caps.mode}>
      <div className="hero-laser" aria-hidden="true">
        <div className="hero-beam-fallback" />
        {caps.mode === "webgl" ? (
          <LaserFlow
            surfaceRef={cardRef}
            beamPosition={0.63}
            color="#ff5a1f"
            intensity={1.8}
            flare={1.25}
            spread={1.5}
            spill={1}
            fog={0.5}
            dust={1.6}
            beamWidth={0.55}
            revealRadius={220}
            revealOpacity={0.6}
            theme="dark"
            intro={!caps.reduced}
            mouseInteraction={!caps.coarse}
            paused={caps.reduced || (caps.compact && caps.lowPower)}
            dpr={caps.compact || caps.coarse ? 1 : undefined}
          />
        ) : null}
      </div>
      <div ref={cardRef} className="hero-card">{children}</div>
    </div>
  );
}
