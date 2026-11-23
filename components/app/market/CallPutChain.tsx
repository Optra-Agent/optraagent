"use client";

import { useMemo, useState } from "react";
import { Chip } from "../ui";
import { formatUtc } from "../format";
import type { CallPutRobinhoodMarketData } from "@/lib/venue/callput-robinhood-readonly";

const QUOTE_FRESH_MS = 60_000;
const num = (value: number, digits = 2) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const expiryLabel = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Real CallPut instruments for one underlying, exactly as the venue feed lists them. These are indicative marks, not
 * fills. Trading them happens in the CallPut order panel below this table, with the owner's wallet confirming.
 */
export function CallPutChain({ symbol, market, loadedAt, ageMs, onRefresh, refreshing }: { symbol: string; market: CallPutRobinhoodMarketData; loadedAt: string; ageMs: number; onRefresh: () => void; refreshing: boolean }) {
  const options = useMemo(() => market.options.filter((option) => option.underlyingSymbol === symbol && option.marketAvailable), [market, symbol]);
  const expiries = useMemo(() => [...new Set(options.map((option) => option.expiryTimestamp))].sort((a, b) => a - b), [options]);
  const [chosen, setChosen] = useState<number | null>(null);
  const expiry = chosen !== null && expiries.includes(chosen) ? chosen : expiries[0];
  const rows = useMemo(() => {
    const byStrike = new Map<number, { strike: number; call?: (typeof options)[number]; put?: (typeof options)[number] }>();
    for (const option of options.filter((item) => item.expiryTimestamp === expiry)) {
      const row = byStrike.get(option.strikePriceRaw) ?? { strike: option.strikePriceRaw };
      row[option.side] = option;
      byStrike.set(option.strikePriceRaw, row);
    }
    return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  }, [options, expiry]);
  const spot = market.spotIndexRaw[symbol];
  const stale = ageMs > QUOTE_FRESH_MS;

  if (expiries.length === 0 || expiry === undefined) return <p className="mk-why" role="status">CallPut lists no open {symbol} contracts right now. Nothing can be traded until the venue publishes instruments.</p>;
  return (
    <div className="oc">
      <div className="oc-bar">
        <div className="oc-exp" role="group" aria-label="Expiry">
          {expiries.map((value) => <button type="button" key={value} aria-pressed={value === expiry} onClick={() => setChosen(value)}>{expiryLabel(value)}</button>)}
        </div>
        <p className="mk-source mono">
          {spot ? <>Venue spot {num(spot)} · </> : null}{options.length} contracts · feed <time dateTime={market.lastUpdatedAt}>{formatUtc(market.lastUpdatedAt)}</time>
          {" "}<Chip tone={stale ? "ember" : "azure"}>{stale ? "Marks may be stale" : "Marks current"}</Chip>
        </p>
        <button type="button" className="oc-refresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh marks"}</button>
      </div>
      <div className="oc-scroll">
        <table className="oc-table" aria-label={`${symbol} CallPut options expiring ${expiryLabel(expiry)}`}>
          <thead><tr><th colSpan={3}>Calls</th><th rowSpan={2}>Strike</th><th colSpan={3}>Puts</th></tr><tr><th>Mark</th><th>IV</th><th>Δ</th><th>Mark</th><th>IV</th><th>Δ</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.strike} data-itm={spot && row.strike < spot ? "call" : "put"}>
                <td className="mono">{row.call ? num(row.call.markPriceRaw) : "—"}</td><td className="mono">{row.call ? `${num(row.call.markIvRaw * 100, 0)}%` : "—"}</td><td className="mono">{row.call ? num(row.call.delta) : "—"}</td>
                <th scope="row" className="mono">{num(row.strike, row.strike % 1 ? 2 : 0)}</th>
                <td className="mono">{row.put ? num(row.put.markPriceRaw) : "—"}</td><td className="mono">{row.put ? `${num(row.put.markIvRaw * 100, 0)}%` : "—"}</td><td className="mono">{row.put ? num(row.put.delta) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mk-note">Marks are CallPut indicative USD prices per underlying unit, loaded <time dateTime={loadedAt}>{formatUtc(loadedAt)}</time>. A transaction hash is not a fill: a position exists only after the CallPut keeper executes the request and the option tokens reach your wallet.</p>
    </div>
  );
}
