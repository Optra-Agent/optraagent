"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { macd, rsi, sma } from "@/lib/market/indicators";
import type { ChartCandle, ChartInterval } from "@/lib/market/crius-candles";
import { cn } from "@/lib/utils";

const UP = "#2bd47d";
const DOWN = "#ff5d73";
const MA20 = "#ffb020";
const MA50 = "#8ab4ff";
const AXIS = "#868c97";
const GRID = "rgba(255,255,255,0.07)";
const PAD_R = 66;
const PAD_T = 10;
const AXIS_H = 24;
const MIN_BARS = 12;
const RIGHT_ROOM = 3;
const INITIAL_BARS = 90;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (value: number) => String(value).padStart(2, "0");
function axisTime(ms: number, interval: ChartInterval): string {
  const d = new Date(ms);
  return interval === "1d" ? `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}` : `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}
function fullTime(ms: number, interval: ChartInterval): string {
  const d = new Date(ms);
  const day = `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return interval === "1d" ? `${day} UTC` : `${day} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}
const price = (value: number) => (value >= 1000 ? value.toFixed(1) : value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(3) : value.toFixed(5));
function volume(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

type Pane = "rsi" | "macd";
/** The view is stored as "how many candles, how far behind the newest, anchored to which candle", so a refresh that appends a candle never resets zoom or pan. */
type ViewState = { visible: number; back: number; anchorT: number | null };

/**
 * Candlestick chart for already-validated provider candles. It draws exactly what it is given: no smoothing, no gap
 * filling and no padding to a candle count. Candles are spaced by index, so periods with no trades are skipped rather than
 * invented; every axis label and tooltip uses the real UTC bucket start. Indicators are computed from these closes only.
 * Interaction: drag to pan, Ctrl/Cmd + wheel (or a click first, then wheel) to zoom, +/- and arrows from the keyboard,
 * double press to return to the latest candles. Pan/zoom adapted from the BOURSE terminal chart; its data is not used.
 */
export function MarketChart({ candles, interval, label, timeframes, baseHeight = 440 }: { candles: readonly ChartCandle[]; interval: ChartInterval; label: string; timeframes?: ReactNode; baseHeight?: number }) {
  const N = candles.length;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [showVolume, setShowVolume] = useState(true);
  const [showMa, setShowMa] = useState(false);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // View math. `count` is slots including a little empty room to the right of the newest candle.
  const [vs, setVs] = useState<ViewState>({ visible: Math.min(N, INITIAL_BARS), back: 0, anchorT: null });
  const view = useMemo(() => {
    const visible = Math.min(N, Math.max(Math.min(MIN_BARS, N), vs.visible));
    const maxBack = Math.max(0, N - visible);
    let back = vs.back;
    if (back > 0 && vs.anchorT !== null) {
      const anchorIndex = candles.findIndex((candle) => candle.t === vs.anchorT);
      if (anchorIndex >= 0) back += N - 1 - anchorIndex;
    }
    back = Math.min(maxBack, Math.max(0, back));
    return { start: maxBack - back, count: visible + RIGHT_ROOM };
  }, [vs, candles, N]);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const setView = useCallback((next: { start: number; count: number }) => {
    const slots = Math.min(N + RIGHT_ROOM, Math.max(Math.min(MIN_BARS, N) + RIGHT_ROOM, next.count));
    const maxStart = N + RIGHT_ROOM - slots;
    const start = Math.min(maxStart, Math.max(0, next.start));
    const back = maxStart - start;
    setVs({ visible: slots - RIGHT_ROOM, back: back < 0.5 ? 0 : back, anchorT: candles[N - 1]?.t ?? null });
  }, [N, candles]);
  const latest = useCallback(() => setVs({ visible: Math.min(N, INITIAL_BARS), back: 0, anchorT: null }), [N]);

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const active = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(260, Math.floor(entry.contentRect.width))); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const closes = useMemo(() => candles.map((candle) => candle.c), [candles]);
  const ma20 = useMemo(() => sma(closes, 20), [closes]);
  const ma50 = useMemo(() => sma(closes, 50), [closes]);
  const rsiSeries = useMemo(() => rsi(closes, 14), [closes]);
  const macdSeries = useMemo(() => macd(closes, 12, 26, 9), [closes]);

  // Layout: price pane, optional volume pane, optional indicator panes, time axis. Panes add height instead of squeezing the price pane.
  const priceHeight = width < 520 ? Math.min(baseHeight, 340) : baseHeight;
  const volH = showVolume ? Math.round(priceHeight * 0.17) : 0;
  const paneH = 84;
  const height = priceHeight + panes.length * (paneH + 6);
  const mainH = priceHeight - PAD_T - AXIS_H - volH - (showVolume ? 6 : 0);
  const plotW = width - PAD_R;
  const step = plotW / view.count;
  const xOf = (index: number) => (index - view.start + 0.5) * step;
  const i0 = Math.max(0, Math.floor(view.start));
  const i1 = Math.min(N - 1, Math.ceil(view.start + view.count));

  // Price range of what is on screen only (overlays only widen it when shown), so candles fill the pane.
  let lo = Infinity; let hi = -Infinity; let vMax = 0;
  for (let index = i0; index <= i1; index += 1) {
    const candle = candles[index]!;
    lo = Math.min(lo, candle.l); hi = Math.max(hi, candle.h); vMax = Math.max(vMax, candle.v);
    if (showMa) for (const series of [ma20, ma50]) { const value = series[index]; if (value != null) { lo = Math.min(lo, value); hi = Math.max(hi, value); } }
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const pad = ((hi - lo) || hi * 0.01 || 1) * 0.05;
  const domLo = lo - pad; const domHi = hi + pad;
  const y = (value: number) => PAD_T + (1 - (value - domLo) / (domHi - domLo)) * mainH;
  const priceAt = (py: number) => domLo + (1 - (py - PAD_T) / mainH) * (domHi - domLo);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((fraction) => domLo + (domHi - domLo) * fraction);
  const volTop = PAD_T + mainH + 6;
  const paneTop = (index: number) => volTop + volH + (showVolume ? 6 : 0) + index * (paneH + 6);
  const bottom = height - AXIS_H;

  const hoverIndex = hover ? Math.min(i1, Math.max(i0, Math.round(view.start + hover.x / step - 0.5))) : null;
  const shown = candles[hoverIndex ?? N - 1];
  const last = candles[N - 1];
  const lastUp = last ? last.c >= last.o : true;
  const lastY = last ? Math.min(PAD_T + mainH, Math.max(PAD_T, y(last.c))) : 0;
  const barW = Math.max(2, Math.min(14, step * 0.68));
  const xTickCount = Math.max(2, Math.min(7, Math.floor(plotW / 120)));
  const xTicks = Array.from({ length: xTickCount }, (_, k) => Math.round(view.start + (view.count * (k + 0.5)) / xTickCount - 0.5)).filter((index) => index >= 0 && index < N);

  const zoomAt = useCallback((factor: number, px: number) => {
    const v = viewRef.current;
    const anchor = v.start + px / (plotW / v.count);
    const count = v.count * factor;
    setView({ start: anchor - px / (plotW / Math.min(N + RIGHT_ROOM, Math.max(Math.min(MIN_BARS, N) + RIGHT_ROOM, count))), count });
  }, [N, plotW, setView]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const px = Math.min(plotW, Math.max(0, event.clientX - rect.left));
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2) {
        event.preventDefault();
        const v = viewRef.current;
        setView({ start: v.start + event.deltaX / (plotW / v.count), count: v.count });
        return;
      }
      if (!(event.ctrlKey || event.metaKey || active.current)) return;
      event.preventDefault();
      zoomAt(Math.exp(event.deltaY * (event.ctrlKey ? 0.012 : 0.0018)), px);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plotW, setView, zoomAt]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const now = performance.now();
    const tap = lastTap.current;
    if (now - tap.t < 320 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 12) {
      lastTap.current = { t: 0, x: 0, y: 0 }; drag.current = null; setDragging(false); latest(); return;
    }
    lastTap.current = { t: now, x: event.clientX, y: event.clientY };
    active.current = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: viewRef.current.start };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left; const py = event.clientY - rect.top;
    if (drag.current) {
      setView({ start: drag.current.start - (event.clientX - drag.current.x) / (plotW / viewRef.current.count), count: viewRef.current.count });
      return;
    }
    setHover(px >= 0 && px <= plotW && py >= PAD_T && py <= bottom ? { x: px, y: py } : null);
  };
  const endDrag = () => { drag.current = null; setDragging(false); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const v = viewRef.current; const big = event.shiftKey ? 20 : 5;
    if (event.key === "ArrowLeft") setView({ start: v.start - big, count: v.count });
    else if (event.key === "ArrowRight") setView({ start: v.start + big, count: v.count });
    else if (event.key === "+" || event.key === "=") zoomAt(0.8, plotW / 2);
    else if (event.key === "-") zoomAt(1.25, plotW / 2);
    else if (event.key === "Home") setView({ start: 0, count: v.count });
    else if (event.key === "End" || event.key === "0" || event.key === "Escape") latest();
    else return;
    event.preventDefault();
  };
  const togglePane = (pane: Pane) => setPanes((current) => (current.includes(pane) ? current.filter((item) => item !== pane) : [...current, pane]));
  const indicatorCount = Number(showVolume) + Number(showMa) + panes.length;

  /** Polyline over the visible candles for a series that is null until enough real closes exist. */
  const plot = (series: ReadonlyArray<number | null>, toY: (value: number) => number) => {
    const points: string[] = [];
    for (let index = i0; index <= i1; index += 1) { const value = series[index]; if (value != null) points.push(`${xOf(index).toFixed(1)},${toY(value).toFixed(1)}`); }
    return points.length > 1 ? points.join(" ") : null;
  };
  const polyline = (series: Array<number | null>) => plot(series, y);
  const linePts = mode === "line" ? polyline(closes) : null;
  const ma20Pts = showMa ? polyline(ma20) : null;
  const ma50Pts = showMa ? polyline(ma50) : null;

  // RSI / MACD panes
  const macdVisible = macdSeries.slice(i0, i1 + 1).filter((point): point is NonNullable<typeof point> => point !== null);
  const macdExtent = Math.max(1e-9, ...macdVisible.flatMap((point) => [Math.abs(point.macd), Math.abs(point.signal ?? 0), Math.abs(point.histogram ?? 0)]));
  const rsiCount = rsiSeries.filter((value) => value !== null).length;

  return (
    <div className="mc">
      <div className="mc-bar">
        <div className="mc-ind" ref={menu}>
          <button type="button" className="mc-ind-btn" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            Indicators <span className="mc-badge" aria-label={`${indicatorCount} active`}>{indicatorCount}</span>
          </button>
          {menuOpen ? (
            <div className="mc-menu" role="group" aria-label="Indicators">
              <button type="button" aria-pressed={showVolume} onClick={() => setShowVolume((v) => !v)}>Volume</button>
              <button type="button" aria-pressed={showMa} onClick={() => setShowMa((v) => !v)}>SMA 20/50</button>
              <button type="button" aria-pressed={panes.includes("rsi")} onClick={() => togglePane("rsi")}>RSI 14</button>
              <button type="button" aria-pressed={panes.includes("macd")} onClick={() => togglePane("macd")}>MACD</button>
            </div>
          ) : null}
        </div>
        <div className="oc-exp" role="group" aria-label="Chart type">
          {(["line", "candles"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "candles" ? "Candles" : "Line"}</button>)}
        </div>
        {timeframes}
        <div className="oc-exp mc-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1.3, plotW / 2)}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAt(0.77, plotW / 2)}>+</button>
          <button type="button" onClick={latest}>Latest</button>
        </div>
      </div>

      <div className="cc-readout mono" aria-hidden="true">
        {shown ? (
          <>
            <span>{fullTime(shown.t, interval)}{shown.forming ? " · forming" : ""}</span>
            <span>O {price(shown.o)}</span><span>H {price(shown.h)}</span><span>L {price(shown.l)}</span>
            <span data-dir={shown.c >= shown.o ? "up" : "down"}>C {price(shown.c)}</span>
            <span>Vol {volume(shown.v)}</span><span>{shown.n} trades</span>
          </>
        ) : null}
      </div>

      <div
        ref={wrap}
        role="group"
        aria-label={`${label}. Drag to pan, Ctrl or Cmd and wheel to zoom, arrow keys to move, plus and minus to zoom.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { setHover(null); active.current = false; }}
        onBlur={() => { active.current = false; }}
        className={cn("mc-wrap", dragging && "mc-drag")}
        style={{ touchAction: "pan-y" }}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="mc-svg">
          <defs><clipPath id="mc-clip"><rect x="0" y="0" width={plotW} height={height} /></clipPath></defs>
          {xTicks.map((index) => <line key={`g${index}`} x1={xOf(index)} x2={xOf(index)} y1={PAD_T} y2={bottom} stroke={GRID} strokeDasharray="2 4" />)}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={0} x2={plotW} y1={y(tick)} y2={y(tick)} stroke={GRID} />
              <text x={plotW + 8} y={y(tick) + 3.5} fill={AXIS} fontSize="10.5" className="mono">{price(tick)}</text>
            </g>
          ))}
          {xTicks.map((index) => <text key={index} x={xOf(index)} y={height - 7} textAnchor="middle" fill={AXIS} fontSize="10.5" className="mono">{axisTime(candles[index]!.t, interval)}</text>)}

          <g clipPath="url(#mc-clip)">
            {mode === "candles" ? candles.slice(i0, i1 + 1).map((candle, offset) => {
              const index = i0 + offset; const color = candle.c >= candle.o ? UP : DOWN;
              const top = y(Math.max(candle.o, candle.c)); const bot = y(Math.min(candle.o, candle.c));
              return (
                <g key={candle.t} className="mc-candle" data-dir={candle.c >= candle.o ? "up" : "down"}>
                  <line x1={xOf(index)} x2={xOf(index)} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth={1.2} />
                  <rect x={xOf(index) - barW / 2} y={top} width={barW} height={Math.max(1.5, bot - top)} fill={color} />
                </g>
              );
            }) : linePts ? <polyline points={linePts} fill="none" stroke={lastUp ? UP : DOWN} strokeWidth={1.8} strokeLinejoin="round" /> : null}
            {ma20Pts ? <polyline points={ma20Pts} fill="none" stroke={MA20} strokeWidth={1.1} opacity={0.8} /> : null}
            {ma50Pts ? <polyline points={ma50Pts} fill="none" stroke={MA50} strokeWidth={1.1} opacity={0.8} /> : null}
            <line x1={0} x2={plotW} y1={lastY} y2={lastY} stroke={lastUp ? UP : DOWN} strokeDasharray="1 3" opacity={0.85} />

            {showVolume ? candles.slice(i0, i1 + 1).map((candle, offset) => {
              const hgt = Math.max(1, (candle.v / (vMax || 1)) * (volH - 4));
              return <rect key={`v${candle.t}`} className="mc-vol" x={xOf(i0 + offset) - barW / 2} y={volTop + volH - hgt} width={barW} height={hgt} fill={candle.c >= candle.o ? UP : DOWN} opacity={0.4} />;
            }) : null}

            {panes.map((pane, slot) => {
              const top = paneTop(slot);
              if (pane === "rsi") {
                const points = plot(rsiSeries, (value) => top + (1 - value / 100) * paneH);
                return (
                  <g key="rsi">
                    {[30, 70].map((level) => <line key={level} x1={0} x2={plotW} y1={top + (1 - level / 100) * paneH} y2={top + (1 - level / 100) * paneH} stroke={GRID} strokeDasharray="3 3" />)}
                    {points ? <polyline points={points} fill="none" stroke="#c792ea" strokeWidth={1.4} /> : null}
                  </g>
                );
              }
              const yM = (value: number) => top + paneH / 2 - (value / macdExtent) * (paneH / 2 - 3);
              const points = (select: (point: NonNullable<(typeof macdSeries)[number]>) => number | null) => plot(macdSeries.map((point) => (point ? select(point) : null)), yM);
              const macdLine = points((point) => point.macd); const signalLine = points((point) => point.signal);
              return (
                <g key="macd">
                  <line x1={0} x2={plotW} y1={yM(0)} y2={yM(0)} stroke={GRID} />
                  {macdSeries.slice(i0, i1 + 1).map((point, offset) => (point?.histogram != null
                    ? <rect key={offset} x={xOf(i0 + offset) - barW / 2} y={Math.min(yM(0), yM(point.histogram))} width={barW} height={Math.max(1, Math.abs(yM(point.histogram) - yM(0)))} fill={point.histogram >= 0 ? UP : DOWN} opacity={0.5} /> : null))}
                  {macdLine ? <polyline points={macdLine} fill="none" stroke={MA50} strokeWidth={1.3} /> : null}
                  {signalLine ? <polyline points={signalLine} fill="none" stroke={MA20} strokeWidth={1.3} /> : null}
                </g>
              );
            })}

            {hover && hoverIndex !== null && !dragging ? (
              <>
                <line x1={xOf(hoverIndex)} x2={xOf(hoverIndex)} y1={PAD_T} y2={bottom} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
                {hover.y <= PAD_T + mainH ? <line x1={0} x2={plotW} y1={hover.y} y2={hover.y} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" /> : null}
              </>
            ) : null}
          </g>

          {showVolume ? <text x={4} y={volTop + 10} fill={AXIS} fontSize="10" className="mono">Volume (USD) · max {volume(vMax)}</text> : null}
          {panes.map((pane, slot) => (
            <text key={pane} x={4} y={paneTop(slot) + 10} fill={AXIS} fontSize="10" className="mono">
              {pane === "rsi" ? (rsiCount === 0 ? `RSI 14 · needs 15 candles, ${N} available` : `RSI 14 · ${rsiSeries[hoverIndex ?? N - 1]?.toFixed(1) ?? "—"}`)
                : (macdSeries.every((point) => !point?.signal) ? `MACD 12/26/9 · needs 34 candles, ${N} available` : `MACD 12/26/9 · ${macdSeries[hoverIndex ?? N - 1]?.macd.toFixed(3) ?? "—"}`)}
            </text>
          ))}

          {last ? (
            <g transform={`translate(0 ${lastY})`} className="mc-last">
              <rect x={plotW + 2} y={-9} width={PAD_R - 4} height={18} rx={4} fill={lastUp ? UP : DOWN} />
              <text x={plotW + 2 + (PAD_R - 4) / 2} y={3.5} textAnchor="middle" fontSize="10.5" fontWeight={700} fill="#0b0c0e" className="mono">{price(last.c)}</text>
            </g>
          ) : null}
          {hover && hoverIndex !== null && !dragging ? (
            <>
              {hover.y <= PAD_T + mainH ? (
                <g transform={`translate(0 ${hover.y})`}>
                  <rect x={plotW + 2} y={-9} width={PAD_R - 4} height={18} rx={4} fill="#f3f4f6" opacity={0.92} />
                  <text x={plotW + 2 + (PAD_R - 4) / 2} y={3.5} textAnchor="middle" fontSize="10.5" fontWeight={600} fill="#0b0c0e" className="mono">{price(priceAt(hover.y))}</text>
                </g>
              ) : null}
              <g transform={`translate(${Math.min(plotW - 40, Math.max(40, xOf(hoverIndex)))} ${height - 12})`}>
                <rect x={-40} y={-9} width={80} height={18} rx={4} fill="#f3f4f6" opacity={0.92} />
                <text x={0} y={3.5} textAnchor="middle" fontSize="10" fontWeight={600} fill="#0b0c0e" className="mono">{axisTime(candles[hoverIndex]!.t, interval)}</text>
              </g>
            </>
          ) : null}
        </svg>
      </div>
      <p className="md-note">Drag to pan. Ctrl or Cmd with the wheel zooms around the cursor; click the chart first to zoom with a plain wheel. Double-click for the latest candles. Times are UTC bucket starts.</p>
    </div>
  );
}
