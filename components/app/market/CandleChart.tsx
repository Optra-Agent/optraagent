"use client";

import { useMemo, useState } from "react";
import type { ChartCandle } from "@/lib/market/crius-candles";

const W = 720; const H = 340; const PAD = { l: 8, r: 64, t: 12, b: 28 };

function priceText(value: number): string {
  return value >= 1000 ? value.toFixed(0) : value >= 100 ? value.toFixed(2) : value.toFixed(3);
}
function timeText(ms: number, daily: boolean): string {
  const date = new Date(ms);
  const day = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return daily ? day : `${day} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Candlestick chart for already-validated candles. It draws exactly what it is given: no smoothing, no gap filling.
 * `demo` only changes the on-chart marking so simulated candles can never be mistaken for market data.
 */
export function CandleChart({ candles, interval, demo = false, label }: { candles: readonly ChartCandle[]; interval: string; demo?: boolean; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const geometry = useMemo(() => {
    const lo = Math.min(...candles.map((candle) => candle.l)); const hi = Math.max(...candles.map((candle) => candle.h));
    const span = hi - lo || hi * 0.01 || 1;
    const min = lo - span * 0.06; const max = hi + span * 0.06;
    const plotW = W - PAD.l - PAD.r; const plotH = H - PAD.t - PAD.b;
    const slot = plotW / candles.length;
    const y = (price: number) => PAD.t + (1 - (price - min) / (max - min)) * plotH;
    const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
    return { slot, y, ticks, plotW, plotH };
  }, [candles]);
  const daily = interval === "1d";
  const active = hover === null ? candles[candles.length - 1] : candles[hover];
  const labelEvery = Math.max(1, Math.floor(candles.length / 5));

  function track(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * W - PAD.l;
    setHover(Math.min(candles.length - 1, Math.max(0, Math.floor(x / geometry.slot))));
  }

  return (
    <figure className="cc" data-demo={demo ? "1" : "0"}>
      <figcaption className="cc-readout mono" aria-live="off">
        {active ? (
          <>
            <span>{timeText(active.t, daily)} UTC{active.forming ? " · forming" : ""}</span>
            <span>O {priceText(active.o)}</span><span>H {priceText(active.h)}</span><span>L {priceText(active.l)}</span>
            <span data-dir={active.c >= active.o ? "up" : "down"}>C {priceText(active.c)}</span>
            {!demo ? <span>{active.n} trades</span> : null}
          </>
        ) : null}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="cc-svg" onPointerMove={track} onPointerDown={track} onPointerLeave={() => setHover(null)}>
        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geometry.y(tick)} y2={geometry.y(tick)} className="cc-grid" />
            <text x={W - PAD.r + 6} y={geometry.y(tick) + 4} className="cc-axis">{priceText(tick)}</text>
          </g>
        ))}
        {candles.map((candle, index) => {
          const x = PAD.l + index * geometry.slot + geometry.slot / 2;
          const up = candle.c >= candle.o;
          const top = geometry.y(Math.max(candle.o, candle.c)); const bottom = geometry.y(Math.min(candle.o, candle.c));
          const bodyW = Math.max(1.5, geometry.slot * 0.7);
          return (
            <g key={candle.t} className="cc-candle" data-dir={up ? "up" : "down"} data-active={hover === index ? "1" : "0"}>
              <line x1={x} x2={x} y1={geometry.y(candle.h)} y2={geometry.y(candle.l)} />
              <rect x={x - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bottom - top)} />
              {index % labelEvery === labelEvery - 1 ? <text x={x} y={H - 8} className="cc-axis" textAnchor="middle">{timeText(candle.t, daily)}</text> : null}
            </g>
          );
        })}
        {hover !== null ? <line x1={PAD.l + hover * geometry.slot + geometry.slot / 2} x2={PAD.l + hover * geometry.slot + geometry.slot / 2} y1={PAD.t} y2={H - PAD.b} className="cc-cross" /> : null}
        {demo ? <text x={PAD.l + geometry.plotW / 2} y={PAD.t + geometry.plotH / 2} textAnchor="middle" className="cc-watermark">DEMO · SIMULATED</text> : null}
      </svg>
    </figure>
  );
}
