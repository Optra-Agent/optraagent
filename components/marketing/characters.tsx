import type { CSSProperties } from "react";

/**
 * The cast. The four House Agents and the six rule stages are small characters. Each has its own body shape and colour
 * and its own eyes: one or two, big or small, round or tall. The eyes are painted, not drawn: a loose zig-zag stroke with a rough edge,
 * so they read as brush marks rather than clean circles. They blink every few seconds, each on its own beat, and look toward the pointer.
 * Everything is plain SVG paths, so it can be sampled (splash particles), embedded in another SVG (the agent graph) or drawn alone.
 */

export type AgentCharacterId = "protective_put" | "covered_call" | "cash_secured_put" | "earnings_straddle";
export type StageCharacterId = "gate" | "strike" | "size" | "pulse" | "expiry" | "breaker";
/** Six more bodies for the closing scene. They are not products or rule stages, only company for the three House Agents and the five stages. */
export type GuestCharacterId = "drop" | "door" | "visor" | "dome" | "slant" | "plus";
export type CharacterId = AgentCharacterId | StageCharacterId | GuestCharacterId;

type Eye = { x: number; y: number; r: number; /** Vertical radius when the eye is taller or flatter than it is wide. */ ry?: number; seed: number };
type Spec = {
  shape: "square" | "triangle" | "hexagon" | "diamond" | "pentagon" | "circle" | "pill" | "octagon" | "drop" | "arch" | "trapezoid" | "dome" | "slant" | "plus";
  fill: string;
  /** Inner outline; the stroke width below rounds its corners. */
  d: string;
  round: number;
  eyes: Eye[];
  blink: number;
  delay: number;
  look: number;
  label: string;
};

const INK = "#0a0b0e";

const poly = (points: [number, number][]) => `M${points.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
const ngon = (sides: number, radius: number, start = -90) => poly(Array.from({ length: sides }, (_, index) => {
  const angle = ((start + (index * 360) / sides) * Math.PI) / 180;
  return [Number((Math.cos(angle) * radius).toFixed(2)), Number((Math.sin(angle) * radius).toFixed(2))] as [number, number];
}));

/* Body: a path drawn with a thick round-joined, round-capped stroke of the same colour, which rounds every corner by half the stroke width. */
export const CHARACTERS: Record<CharacterId, Spec> = {
  protective_put: {
    shape: "square", fill: "#6db4ff", d: poly([[-30, -30], [30, -30], [30, 30], [-30, 30]]), round: 56,
    eyes: [{ x: -21, y: -3, r: 14, seed: 3 }, { x: 21, y: -3, r: 12, seed: 8 }],
    blink: 5.4, delay: 1.1, look: 9, label: "Square agent with two painted eyes",
  },
  covered_call: {
    shape: "triangle", fill: "#f0674a", d: poly([[0, -33], [39, 31], [-39, 31]]), round: 36,
    eyes: [{ x: 0, y: 9, r: 18, seed: 5 }],
    blink: 6.6, delay: 2.3, look: 11, label: "Triangle agent with one big painted eye",
  },
  cash_secured_put: {
    shape: "hexagon", fill: "#6fe0b5", d: ngon(6, 34), round: 44,
    eyes: [{ x: -18, y: -3, r: 15, seed: 11 }, { x: 21, y: 4, r: 7.5, seed: 2 }],
    blink: 7.2, delay: 0.4, look: 8, label: "Hexagon agent with one big and one small painted eye",
  },
  earnings_straddle: {
    shape: "diamond", fill: "#f3c25b", d: poly([[0, -36], [36, 0], [0, 36], [-36, 0]]), round: 40,
    eyes: [{ x: -15, y: 3, r: 8, seed: 6 }, { x: 15, y: 3, r: 8, seed: 13 }],
    blink: 4.9, delay: 3.1, look: 10, label: "Diamond agent with two small painted eyes",
  },
  // The six rule stages. Same family, other shapes and colours, so the network reads as a cast and not as one repeated icon.
  gate: {
    shape: "pentagon", fill: "#8b8cf5", d: ngon(5, 33), round: 42,
    eyes: [{ x: -15, y: 2, r: 8, ry: 13, seed: 17 }, { x: 15, y: 2, r: 8, ry: 13, seed: 19 }],
    blink: 5.9, delay: 0.8, look: 9.5, label: "Pentagon agent with two tall painted eyes",
  },
  strike: {
    shape: "circle", fill: "#a8d65a", d: "M0 0 L0.01 0", round: 116,
    eyes: [{ x: 0, y: -2, r: 15, seed: 23 }],
    blink: 6.2, delay: 1.7, look: 12, label: "Round agent with one painted eye",
  },
  size: {
    shape: "pill", fill: "#f0a24a", d: "M-22 0 L22 0", round: 72,
    eyes: [{ x: -20, y: -2, r: 12, seed: 29 }, { x: 18, y: 2, r: 7, seed: 31 }],
    blink: 7.6, delay: 2.9, look: 8.5, label: "Wide agent with one big and one small painted eye",
  },
  pulse: {
    shape: "pill", fill: "#e86fb0", d: "M0 -22 L0 22", round: 72,
    eyes: [{ x: -11, y: -10, r: 7.5, seed: 37 }, { x: 11, y: -10, r: 7.5, seed: 41 }],
    blink: 4.6, delay: 0.2, look: 10.5, label: "Tall agent with two small painted eyes",
  },
  expiry: {
    shape: "hexagon", fill: "#46c7c0", d: ngon(6, 34, 0), round: 44,
    eyes: [{ x: -14, y: 0, r: 10, seed: 43 }, { x: 14, y: 0, r: 10, ry: 6, seed: 47 }],
    blink: 6.9, delay: 3.4, look: 9, label: "Hexagon agent with two painted eyes of different heights",
  },
  breaker: {
    shape: "octagon", fill: "#ff6a47", d: ngon(8, 30, -67.5), round: 44,
    eyes: [{ x: -16, y: -2, r: 10, ry: 7, seed: 53 }, { x: 16, y: -2, r: 10, ry: 7, seed: 59 }],
    blink: 8.1, delay: 1.4, look: 7.5, label: "Octagon agent with two flat painted eyes",
  },
  // Guests of the closing scene: shapes none of the ten above use.
  drop: {
    shape: "drop", fill: "#d3ee6a", d: "M0 -38 C 12 -22 28 -8 28 10 A28 28 0 0 1 -28 10 C -28 -8 -12 -22 0 -38 Z", round: 26,
    eyes: [{ x: -9, y: 12, r: 13, seed: 61 }, { x: 14, y: 16, r: 7, seed: 67 }],
    blink: 6.1, delay: 0.9, look: 9, label: "Teardrop agent with one big and one small painted eye",
  },
  door: {
    shape: "arch", fill: "#ece6d6", d: "M-30 28 L-30 -4 A30 30 0 0 1 30 -4 L30 28 Z", round: 54,
    eyes: [{ x: -19, y: -6, r: 13, seed: 71 }, { x: 19, y: -6, r: 13, seed: 73 }],
    blink: 7.4, delay: 2.1, look: 8, label: "Arched agent with two big painted eyes",
  },
  visor: {
    shape: "trapezoid", fill: "#b79cff", d: poly([[-22, -24], [22, -24], [34, 26], [-34, 26]]), round: 50,
    eyes: [{ x: 0, y: 0, r: 25, ry: 9, seed: 79 }],
    blink: 5.2, delay: 1.6, look: 11, label: "Trapezoid agent with one wide, flat painted eye",
  },
  dome: {
    shape: "dome", fill: "#7fd8f0", d: "M-34 20 A34 34 0 0 1 34 20 Z", round: 42,
    eyes: [{ x: 0, y: -6, r: 18, seed: 83 }],
    blink: 6.7, delay: 0.3, look: 10, label: "Dome agent with one big painted eye",
  },
  slant: {
    shape: "slant", fill: "#ff8fa0", d: poly([[-18, -24], [38, -24], [18, 24], [-38, 24]]), round: 44,
    eyes: [{ x: -8, y: -1, r: 8, ry: 13, seed: 89 }, { x: 18, y: -1, r: 8, seed: 97 }],
    blink: 5.7, delay: 2.7, look: 9.5, label: "Slanted agent with two painted eyes, one tall and one round",
  },
  plus: {
    shape: "plus", fill: "#ff9a5c", d: poly([[-12, -30], [12, -30], [12, -12], [30, -12], [30, 12], [12, 12], [12, 30], [-12, 30], [-12, 12], [-30, 12], [-30, -12], [-12, -12]]), round: 40,
    eyes: [{ x: -11, y: 0, r: 9, seed: 101 }, { x: 12, y: -2, r: 6, seed: 103 }],
    blink: 8.3, delay: 1.2, look: 7.5, label: "Cross-shaped agent with two painted eyes of different sizes",
  },
};

export const GUEST_IDS: GuestCharacterId[] = ["drop", "door", "visor", "dome", "slant", "plus"];
export const CHARACTER_IDS = (Object.keys(CHARACTERS) as CharacterId[]).filter((id) => !GUEST_IDS.includes(id as GuestCharacterId));
export const characterColor = (id: string): string => (id in CHARACTERS ? CHARACTERS[id as CharacterId].fill : "#4aa8ff");

/** A small deterministic generator so the server and the browser draw the same brush marks. */
function rng(seed: number) {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const sweepsFor = (eye: Eye) => Math.max(6, Math.round((eye.ry ?? eye.r) / 1.8));

/** One painted eye: a loose zig-zag that sweeps the shape from top to bottom with a ragged edge. */
export function scribblePath(eye: Eye): string {
  const next = rng(eye.seed);
  const ry = eye.ry ?? eye.r;
  const sweeps = sweepsFor(eye);
  const jitter = Math.max(eye.r, ry) * 0.14;
  const points: string[] = [];
  for (let row = 0; row < sweeps; row += 1) {
    const t = row / (sweeps - 1);
    const y = eye.y - ry + 2 * ry * t;
    const half = eye.r * Math.sqrt(Math.max(0, 1 - ((y - eye.y) / ry) ** 2)) * (0.92 + next() * 0.14);
    const left = eye.x - half + (next() - 0.5) * jitter;
    const right = eye.x + half + (next() - 0.5) * jitter;
    const [a, b] = row % 2 === 0 ? [left, right] : [right, left];
    points.push(`${row === 0 ? "M" : "L"}${a.toFixed(1)} ${(y + (next() - 0.5) * jitter).toFixed(1)} L${b.toFixed(1)} ${(y + (next() - 0.5) * jitter).toFixed(1)}`);
  }
  return points.join(" ");
}

export function scribbleWidth(eye: Eye): number {
  const ry = eye.ry ?? eye.r;
  return Number((((2 * ry) / (sweepsFor(eye) - 1)) * 1.9).toFixed(2));
}

type BodyProps = { id: CharacterId; live?: boolean };

/** The character as an SVG group centred on 0,0 (about 120 units across). Use it inside any SVG. Every character blinks. */
export function CharacterBody({ id, live = true }: BodyProps) {
  const spec = CHARACTERS[id];
  return (
    <g
      className="ch"
      data-shape={spec.shape}
      data-live={live ? "1" : "0"}
      style={{ "--blink": `${spec.blink}s`, "--blink-delay": `${spec.delay}s`, "--look": `${spec.look}s` } as CSSProperties}
    >
      <path className="ch-body" d={spec.d} fill={spec.fill} stroke={spec.fill} strokeWidth={spec.round} strokeLinejoin="round" strokeLinecap="round" />
      <g className="ch-gaze">
        <g className="ch-eyes">
          {spec.eyes.map((eye) => (
            <g className="ch-eye" key={`${eye.x}:${eye.y}`}>
              <ellipse cx={eye.x} cy={eye.y} rx={eye.r * 0.72} ry={(eye.ry ?? eye.r) * 0.72} fill={INK} />
              <path d={scribblePath(eye)} fill="none" stroke={INK} strokeWidth={scribbleWidth(eye)} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </g>
      </g>
    </g>
  );
}

type CharacterProps = BodyProps & { size?: number; className?: string; title?: string };

/** The character on its own. Decorative unless a title is given. */
export function AgentCharacter({ id, size = 96, live, className, title }: CharacterProps) {
  return (
    <svg className={className ? `ch-svg ${className}` : "ch-svg"} viewBox="-64 -64 128 128" width={size} height={size} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <CharacterBody id={id} live={live} />
    </svg>
  );
}

/** Drawing data for canvas use (the splash samples these into particles). */
export function characterDrawing(id: CharacterId) {
  const spec = CHARACTERS[id];
  return { body: spec.d, round: spec.round, fill: spec.fill, ink: INK, eyes: spec.eyes.map((eye) => ({ ...eye, ry: eye.ry ?? eye.r, path: scribblePath(eye), width: scribbleWidth(eye) })) };
}
