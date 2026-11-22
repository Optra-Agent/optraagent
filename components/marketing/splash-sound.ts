/**
 * The sound of the opening, made in the browser with Web Audio. There is no audio file: every note here is an oscillator or filtered noise,
 * so it costs nothing to download and it stays in step with the opening's own timeline (the same milliseconds Splash.tsx uses).
 *
 *   0 to 25 %    dust in a dark room: a faint breath of air
 *   25 to 50 %   the swell as the particles collapse
 *   50 %         the agent pops in; its eyes blink twice, and each blink rings a small "ting"
 *   50 to 75 %   the cast arrives, one soft note each, up a pentatonic scale
 *   75 to 100 %  the routes start to run: a quiet pad, then a closing chord
 *   hand-over    a whoosh while the agent glides to the hero, a soft landing, and one blip for every branch that grows out of it
 *
 * Browsers refuse to make sound before the visitor has interacted with the page. So this tries to start on its own, and if it is refused it
 * starts at the first key, tap or click and picks up from wherever the timeline is. The opening never depends on it.
 */

const LEVEL = 0.95; // overall loudness, 0 to 1.
const BOOST = 2.1; // multiplies every note and the air, so the whole piece comes up together. A compressor keeps the loudest parts from clipping.
const STORAGE = "optra:sound";
const SEEN = "optra:splash-sound-seen";

/** The agent's two blinks, from the splash-eyes keyframes (61% and 87% of 1900ms, after a 240ms delay), counted from when the agent pops in at 2300ms. */
const BLINKS = [2300 + 240 + 0.61 * 1900, 2300 + 240 + 0.87 * 1900];
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]; // C D E G A C D E
const CAST_AT = 3000;
const CAST_GAP = 95;
const LIFT_AT = 4800;
const BRANCHES = 8;

type Gate = { ctx: AudioContext; out: GainNode; noise: AudioBuffer };

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function soundWanted(): boolean {
  return read(STORAGE) !== "off";
}

export function rememberSound(on: boolean): void {
  try { window.localStorage.setItem(STORAGE, on ? "on" : "off"); } catch { /* private mode: the choice just lasts this page */ }
}

export class SplashSound {
  private gate: Gate | null = null;
  private started = false;
  private muted: boolean;
  private quiet: boolean;
  private disposed = false;
  onrun: (() => void) | null = null;

  constructor(private elapsed: () => number) {
    this.muted = !soundWanted();
    let seen = false;
    try { seen = window.sessionStorage.getItem(SEEN) === "1"; window.sessionStorage.setItem(SEEN, "1"); } catch { /* ignore */ }
    // The first opening of a visit plays in full; a reload is gentler, since it comes round again and again.
    this.quiet = seen;
  }

  /** Make the audio context. Returns false when this browser has no Web Audio. */
  open(): boolean {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return false;
    const ctx = new Context();
    const out = ctx.createGain();
    out.gain.value = this.muted ? 0 : LEVEL * (this.quiet ? 0.7 : 1);
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 9000;
    // A gentle compressor so the thump and the closing chord cannot jump out, now that the piece is louder.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -16;
    limit.knee.value = 12;
    limit.ratio.value = 5;
    limit.attack.value = 0.003;
    limit.release.value = 0.2;
    out.connect(soften).connect(limit).connect(ctx.destination);
    // One second of white noise, reused by every airy part.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    this.gate = { ctx, out, noise };
    ctx.onstatechange = () => { if (ctx.state === "running") this.run(); };
    if (ctx.state === "running") this.run();
    return true;
  }

  /** Ask the browser to let sound start. Safe to call again from a key press or a tap. */
  wake(): void {
    const ctx = this.gate?.ctx;
    if (!ctx || this.disposed || ctx.state === "running") return;
    void ctx.resume().catch(() => undefined);
  }

  get audible(): boolean {
    return Boolean(this.gate) && this.gate?.ctx.state === "running" && !this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const gate = this.gate;
    if (!gate) return;
    gate.out.gain.cancelScheduledValues(gate.ctx.currentTime);
    gate.out.gain.setTargetAtTime(muted ? 0 : LEVEL * (this.quiet ? 0.7 : 1), gate.ctx.currentTime, 0.08);
    if (!muted) this.wake();
  }

  /** Called once the context is running: lay out everything still to come on the audio clock. */
  private run(): void {
    if (this.started || this.disposed || !this.gate) return;
    this.started = true;
    this.onrun?.();
    const from = this.elapsed();
    if (from < LIFT_AT) this.plan(from);
  }

  private plan(from: number): void {
    const gate = this.gate;
    if (!gate) return;
    const at = (ms: number) => gate.ctx.currentTime + 0.03 + Math.max(0, ms - from) / 1000;
    const live = (ms: number) => ms >= from - 20;

    // 0 to 50 %: a breath of air that opens up into a swell as the particles gather.
    this.air(at(Math.max(0, from)), 2350 - Math.max(0, from), 0.05, 500, 2600, 0.12);
    this.tone("sine", 110, 330, at(Math.max(900, from)), (2350 - Math.max(900, from)) / 1000, 0.07, 0.35);

    if (live(2300)) {
      // The agent pops in: a soft low thump and a small bright note on top of it.
      this.tone("sine", 140, 52, at(2300), 0.34, 0.5, 0.01);
      this.tone("triangle", 659.25, 659.25, at(2300), 0.5, 0.08, 0.005);
    }
    // The eyes blink, and each blink rings.
    BLINKS.forEach((ms, index) => {
      if (!live(ms)) return;
      this.ting(at(ms), index === 0 ? 1760 : 2093);
    });

    // 50 to 75 %: the cast arrives, one note each.
    SCALE.forEach((hz, index) => {
      const ms = CAST_AT + 120 + index * CAST_GAP;
      if (live(ms)) this.tone("triangle", hz, hz, at(ms), 0.55, 0.07, 0.008);
    });
    // 75 to 100 %: the routes start to run, as a pad that swells to the end.
    const padFrom = Math.max(CAST_AT + 300, from);
    this.tone("sine", 220, 220, at(padFrom), (LIFT_AT - padFrom) / 1000 + 0.1, 0.05, 0.9);
    this.tone("sine", 330, 330, at(padFrom), (LIFT_AT - padFrom) / 1000 + 0.1, 0.035, 1.1);
  }

  /** The opening is over and the agent is on its way to the hero. */
  handoff(docked: boolean, dock: number, skipped: boolean): void {
    const gate = this.gate;
    if (!gate || gate.ctx.state !== "running" || this.disposed) return;
    const now = gate.ctx.currentTime + 0.02;
    if (skipped) {
      // Let go quickly rather than cut: the opening was waved away.
      gate.out.gain.cancelScheduledValues(gate.ctx.currentTime);
      gate.out.gain.setTargetAtTime(0, gate.ctx.currentTime, 0.12);
      return;
    }
    [261.63, 392, 523.25, 659.25].forEach((hz, index) => this.tone("sine", hz, hz, now + index * 0.012, 1.7, 0.055, 0.06));
    this.air(now, dock + 100, 0.1, 500, 3400, 0.18);
    if (docked) {
      this.tone("sine", 150, 58, now + dock / 1000, 0.32, 0.32, 0.01);
      // One blip for each branch that grows out of the agent, climbing the scale.
      for (let index = 0; index < BRANCHES; index += 1) {
        const hz = SCALE[index] ?? 1318.51;
        this.tone("sine", hz * 2, hz * 2, now + (dock + 260 + (index + 1) * 85) / 1000, 0.26, 0.045, 0.004);
      }
    }
  }

  /** A short, bright ring: two partials that die away quickly. */
  private ting(when: number, hz: number): void {
    this.tone("sine", hz, hz, when, 0.5, 0.11, 0.002);
    this.tone("sine", hz * 2.76, hz * 2.76, when, 0.22, 0.03, 0.002);
  }

  private tone(type: OscillatorType, from: number, to: number, when: number, length: number, peak: number, attack: number): void {
    const gate = this.gate;
    if (!gate) return;
    const { ctx, out } = gate;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, from), when);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + length);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak * BOOST, when + Math.max(0.002, attack));
    env.gain.exponentialRampToValueAtTime(0.0001, when + length);
    osc.connect(env).connect(out);
    osc.start(when);
    osc.stop(when + length + 0.05);
  }

  /** Filtered noise that sweeps from one centre frequency to another and swells then fades. */
  private air(when: number, length: number, peak: number, lowHz: number, highHz: number, bandQ: number): void {
    const gate = this.gate;
    if (!gate || length <= 0) return;
    const { ctx, out, noise } = gate;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.6 + bandQ * 4;
    filter.frequency.setValueAtTime(lowHz, when);
    filter.frequency.exponentialRampToValueAtTime(highHz, when + length / 1000);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak * BOOST, when + (length / 1000) * 0.85);
    env.gain.exponentialRampToValueAtTime(0.0001, when + length / 1000);
    source.connect(filter).connect(env).connect(out);
    source.start(when);
    source.stop(when + length / 1000 + 0.05);
  }

  dispose(): void {
    this.disposed = true;
    const gate = this.gate;
    this.gate = null;
    if (!gate) return;
    gate.out.gain.cancelScheduledValues(gate.ctx.currentTime);
    gate.out.gain.setTargetAtTime(0, gate.ctx.currentTime, 0.05);
    window.setTimeout(() => { void gate.ctx.close().catch(() => undefined); }, 1800);
  }
}
