"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentCharacter } from "./characters";
import { FloorDiagram } from "./FloorDiagram";
import type { FloorView } from "./floor-scene";
import { floorStore, useFloor } from "./floor-store";
import { PREMIUM_RANGE, STRIKE_RANGE, floorReadout } from "./payoff";

const VIEWS: { id: FloorView; label: string; hint: string; caption: string }[] = [
  { id: "overview", label: "Whole payoff", hint: "Both rows, side by side", caption: "Hold 100 and add one long put: at expiry the value cannot fall below the strike minus the premium. Back row, the holding alone. Front row, the same holding with the put." },
  { id: "floor", label: "The floor", hint: "Where the put holds the value", caption: "The orange part is what the put supplies. Wherever the price ends below the floor, the put fills the column up to it." },
  { id: "cost", label: "The cost", hint: "The premium on every column", caption: "The clear caps are the premium. You pay it on every column, even when the price rises, and it is what the floor costs." },
];

const fill = (value: number, range: { min: number; max: number }) => ({ "--fill": `${((value - range.min) / (range.max - range.min)) * 100}%` }) as CSSProperties;
const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * The Protective Put, explained by an object you can change. Two assumptions drive it: the strike and the premium.
 * The numbers are arithmetic on those two inputs at expiry. They are not quotes, a backtest or a result.
 */
export function ProtectiveFloor() {
  const { params, view, gl } = useFloor();
  const readout = floorReadout(params);
  const caption = VIEWS.find((item) => item.id === view)?.caption ?? "";

  // Keep the accessible view controls scroll-synchronized even when the optional WebGL scene cannot initialize.
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const pin = document.querySelector<HTMLElement>(".fl-pin");
        const track = document.querySelector<HTMLElement>(".fl-track");
        const stage = document.querySelector<HTMLElement>(".fl-stage");
        if (!pin || !track || !stage || getComputedStyle(pin).position !== "sticky") return;

        const rect = stage.getBoundingClientRect();
        const visible = (Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / Math.max(1, Math.min(rect.height, window.innerHeight));
        if (visible <= 0.5) return;

        const progress = Math.max(0, Math.min(1, -track.getBoundingClientRect().top / Math.max(1, track.offsetHeight - window.innerHeight)));
        const next = progress < 0.34 ? "overview" : progress < 0.67 ? "floor" : "cost";
        if (floorStore.get().view !== next) floorStore.set({ view: next });
      });
    };

    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Pinned, a view button scrolls to its part of the track so the scroll and the buttons never disagree. Not pinned, it sets the view directly.
  const chooseView = (id: FloorView) => {
    const pin = document.querySelector<HTMLElement>(".fl-pin");
    const track = document.querySelector<HTMLElement>(".fl-track");
    if (pin && track && getComputedStyle(pin).position === "sticky") {
      const index = VIEWS.findIndex((item) => item.id === id);
      const span = track.offsetHeight - window.innerHeight;
      const top = track.getBoundingClientRect().top + window.scrollY + span * ((index + 0.5) / VIEWS.length);
      window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    floorStore.set({ view: id });
  };

  return (
    <section className="m-section fl" id="floor" aria-labelledby="floor-title">
      <div className="fl-track">
      <div className="fl-pin">
      <div className="m-wrap fl-grid">
        <div className="fl-stage" data-sig-slot="floor" data-gl={gl}>
          {gl === "off" ? <FloorDiagram params={params} className="fl-fallback" /> : null}
          <div className="fl-agent" aria-hidden="true">
            <span key={`${params.strike}-${params.premium}`} className="fl-agent-nod"><AgentCharacter id="protective_put" size={74} /></span>
            <p className="fl-agent-say"><b>I hold the floor at {fmt(readout.floor)}.</b><span>{readout.otm === 0 ? "My put starts paying at the entry price." : `My put starts paying ${readout.otm}% below entry.`} Above the floor, you keep the upside minus {fmt(params.premium)}.</span></p>
          </div>
          <p className="fl-drag" aria-hidden="true">Drag to turn</p>
        </div>

        <div className="fl-panel">
          <p className="m-eyebrow">THE PROTECTIVE FLOOR</p>
          <h2 id="floor-title">A put turns a falling price into a floor.</h2>
          <p className="fl-lede">
            Hold 100 of an underlying and add one long put below it. At expiry the position cannot be worth less than the strike minus the premium, whatever the price does. Move the two assumptions and watch the floor, and what it costs, change.
          </p>

          <div className="fl-controls">
            <div className="fl-control">
              <label htmlFor="fl-strike"><span className="fl-stagetag"><AgentCharacter id="strike" size={20} live={false} />Put strike<em>Strike stage</em></span><output htmlFor="fl-strike">{params.strike}<small> ({readout.otm === 0 ? "at the money" : `${readout.otm}% below entry`})</small></output></label>
              <input id="fl-strike" type="range" min={STRIKE_RANGE.min} max={STRIKE_RANGE.max} step={STRIKE_RANGE.step} value={params.strike} style={fill(params.strike, STRIKE_RANGE)} onChange={(event) => floorStore.set({ params: { ...params, strike: Number(event.target.value) } })} aria-valuetext={`Strike ${params.strike}, ${readout.otm} percent below entry`} />
            </div>
            <div className="fl-control">
              <label htmlFor="fl-premium"><span>Assumed premium</span><output htmlFor="fl-premium">{fmt(params.premium)}<small> per 100</small></output></label>
              <input id="fl-premium" type="range" min={PREMIUM_RANGE.min} max={PREMIUM_RANGE.max} step={PREMIUM_RANGE.step} value={params.premium} style={fill(params.premium, PREMIUM_RANGE)} onChange={(event) => floorStore.set({ params: { ...params, premium: Number(event.target.value) } })} aria-valuetext={`Premium ${fmt(params.premium)} per 100`} />
            </div>
          </div>

          <dl className="fl-readout" aria-live="polite">
            <div><dt>Floor at expiry</dt><dd className="mono">{fmt(readout.floor)}</dd></div>
            <div><dt>Largest loss vs entry</dt><dd className="mono">{fmt(readout.worstLoss)}<small> per 100</small></dd></div>
            <div><dt>Break-even price</dt><dd className="mono">{fmt(readout.breakeven)}</dd></div>
          </dl>

          <div className="fl-views" role="group" aria-label="Camera view of the Protective Floor">
            {VIEWS.map((item) => (
              <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => chooseView(item.id)}>
                <span>{item.label}</span><small>{item.hint}</small>
              </button>
            ))}
          </div>

          <p className="fl-step" aria-live="polite">{caption}</p>

          <ul className="fl-legend" aria-label="How to read the columns">
            <li data-k="kept"><i />What the holding keeps</li>
            <li data-k="put"><i />What the put supplies</li>
            <li data-k="cost"><i />Premium paid</li>
            <li data-k="hold"><i />Holding alone</li>
          </ul>

          <p className="fl-note">
            Modeled arithmetic at expiry, per 100 of entry value. Strike and premium are assumptions you set, not quotes. The paper agent prices its own premiums with Optra&apos;s model and does not model venue fees. This is not a backtest and not a recorded result.
          </p>
          <div className="m-actions fl-actions">
            <Link className={buttonVariants()} href="/agents#configure">Build this as a paper agent</Link>
            <a className={cn(buttonVariants({ variant: "outline" }))} href="#agents">Read the Protective Put rules</a>
          </div>
        </div>
      </div>
      </div>
      </div>
    </section>
  );
}
