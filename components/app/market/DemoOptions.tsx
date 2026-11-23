"use client";

import { useMemo, useState } from "react";
import { Chip } from "../ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildDemoChain, buildDemoTicket, demoPayoffAt } from "@/lib/market/options-demo";
import type { DemoTicket } from "@/lib/market/options-demo";

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function Payoff({ ticket, spot }: { ticket: DemoTicket; spot: number }) {
  const points = Array.from({ length: 41 }, (_, index) => {
    const price = spot * (0.8 + (0.4 * index) / 40);
    return { price, pnl: demoPayoffAt(ticket, price) };
  });
  const lo = Math.min(...points.map((p) => p.pnl)); const hi = Math.max(...points.map((p) => p.pnl));
  const span = hi - lo || 1;
  const x = (index: number) => 8 + (index / 40) * 304; const y = (value: number) => 8 + (1 - (value - lo) / span) * 84;
  const zero = y(0);
  return (
    <svg viewBox="0 0 320 100" className="dm-payoff" role="img" aria-label={`Simulated profit and loss at expiry for the ${ticket.side}, from ${money(lo)} to ${money(hi)}`}>
      <line x1="8" x2="312" y1={zero} y2={zero} className="cc-grid" />
      <polyline points={points.map((p, i) => `${x(i)},${y(p.pnl)}`).join(" ")} fill="none" className="dm-line" />
    </svg>
  );
}

/**
 * Demo Mode for a stock CallPut does not list. The only real input is the underlying quote; every option price is modeled
 * with an assumed volatility, and a ticket is a local what-if. There is no wallet call, no transaction and no position.
 */
export function DemoOptions({ symbol, spotUsd }: { symbol: string; spotUsd: number | null }) {
  const [volPct, setVolPct] = useState("45");
  const [expiryIndex, setExpiryIndex] = useState(0);
  const [side, setSide] = useState<"call" | "put">("call");
  const [strike, setStrike] = useState<number | null>(null);
  const [units, setUnits] = useState("1");
  const [tickets, setTickets] = useState<DemoTicket[]>([]);
  const [nowMs] = useState(() => Date.now());

  const vol = Number(volPct) / 100;
  const volOk = Number.isFinite(vol) && vol >= 0.05 && vol <= 3;
  const chain = useMemo(() => (spotUsd && volOk ? buildDemoChain(spotUsd, vol, nowMs) : null), [spotUsd, vol, volOk, nowMs]);
  const expiry = chain?.[expiryIndex];
  const row = expiry?.rows.find((candidate) => candidate.strike === strike) ?? expiry?.rows[Math.floor((expiry?.rows.length ?? 1) / 2)];
  const unitsNum = Number(units);
  const unitsOk = /^\d+(?:\.\d{1,4})?$/.test(units.trim()) && unitsNum > 0 && unitsNum <= 10_000;
  const ticket = row && expiry && unitsOk ? buildDemoTicket(side, row, expiry.expiryAt, unitsNum) : null;

  return (
    <div className="dm">
      <div className="dm-banner" role="note">
        <Chip tone="ember">Demo mode · simulated</Chip>
        <p>CallPut does not list {symbol} options on Robinhood Chain, so there is nothing to sign. Prices below come from a Black–Scholes model with an assumed volatility, not from a venue. Demo tickets create no transaction, wallet request, balance, position or fill.</p>
      </div>
      {!spotUsd ? <p className="mk-why" role="status">A live underlying quote is needed to model the demo chain. Reload the quote above, then try again.</p> : (
        <>
          <div className="dm-controls">
            <div className="grid gap-1.5"><Label htmlFor="dm-vol">Assumed volatility (%)</Label><Input id="dm-vol" inputMode="decimal" value={volPct} onChange={(event) => setVolPct(event.target.value)} aria-invalid={!volOk} />{!volOk ? <p className="inline-error" role="alert">Enter 5 to 300.</p> : null}</div>
            <div className="oc-exp" role="group" aria-label="Demo expiry">{chain?.map((item, index) => <button type="button" key={item.expiryAt} aria-pressed={index === expiryIndex} onClick={() => setExpiryIndex(index)}>{item.label} · {item.days}d</button>)}</div>
          </div>
          {expiry ? (
            <div className="oc-scroll">
              <table className="oc-table" aria-label={`Modeled ${symbol} options expiring ${expiry.label}`}>
                <thead><tr><th colSpan={2}>Calls (modeled)</th><th rowSpan={2}>Strike</th><th colSpan={2}>Puts (modeled)</th></tr><tr><th>Premium</th><th>Δ</th><th>Premium</th><th>Δ</th></tr></thead>
                <tbody>
                  {expiry.rows.map((item) => (
                    <tr key={item.strike} data-picked={row?.strike === item.strike ? "1" : "0"}>
                      <td><button type="button" className="oc-pick mono" aria-pressed={row?.strike === item.strike && side === "call"} aria-label={`Select ${symbol} ${item.strike} call`} onClick={() => { setSide("call"); setStrike(item.strike); }}>{item.callPremium.toFixed(2)}</button></td>
                      <td className="mono">{item.callDelta.toFixed(2)}</td>
                      <th scope="row" className="mono">{item.strike}</th>
                      <td><button type="button" className="oc-pick mono" aria-pressed={row?.strike === item.strike && side === "put"} aria-label={`Select ${symbol} ${item.strike} put`} onClick={() => { setSide("put"); setStrike(item.strike); }}>{item.putPremium.toFixed(2)}</button></td>
                      <td className="mono">{item.putDelta.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="dm-ticket">
            <h3>Demo ticket · Buy {side}</h3>
            <div className="dm-ticket-grid">
              <div className="grid gap-1.5"><Label htmlFor="dm-units">Size (shares)</Label><Input id="dm-units" inputMode="decimal" value={units} onChange={(event) => setUnits(event.target.value)} aria-invalid={!unitsOk} />{!unitsOk ? <p className="inline-error" role="alert">Enter a size above 0 and up to 10,000.</p> : null}</div>
              {ticket ? (
                <dl className="kv kv-tight">
                  <div><dt>Strike · expiry</dt><dd className="mono">{ticket.strike} · {ticket.expiryAt.slice(0, 10)}</dd></div>
                  <div><dt>Modeled cost</dt><dd className="mono">{money(ticket.cost)}</dd></div>
                  <div><dt>Max loss</dt><dd className="mono">{money(ticket.maxLoss)}</dd></div>
                  <div><dt>Break-even</dt><dd className="mono">{money(ticket.breakeven)}</dd></div>
                </dl>
              ) : null}
            </div>
            {ticket && spotUsd ? <Payoff ticket={ticket} spot={spotUsd} /> : null}
            <div className="mk-actions">
              <button type="button" className="demo-btn" disabled={!ticket} onClick={() => ticket && setTickets((current) => [ticket, ...current].slice(0, 5))}>Add demo ticket</button>
              {tickets.length > 0 ? <button type="button" className="oc-refresh" onClick={() => setTickets([])}>Clear demo tickets</button> : null}
            </div>
            <p className="mk-why">No wallet is requested and nothing is sent. This button only records a what-if on this page.</p>
          </div>
          {tickets.length > 0 ? (
            <ol className="dm-list" aria-label="Demo tickets">
              {tickets.map((item, index) => (
                <li key={`${item.expiryAt}-${item.strike}-${item.side}-${index}`}>
                  <Chip tone="ember">Simulated</Chip>
                  <span className="mono">Buy {item.units} × {symbol} {item.strike} {item.side} · {item.expiryAt.slice(0, 10)}</span>
                  <span className="mono">cost {money(item.cost)} · max loss {money(item.maxLoss)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </div>
  );
}
