"use client";

import { useMemo, useState } from "react";
import { Chip } from "../ui";
import { formatUtc } from "../format";
import type { CallPutRobinhoodMarketData, CallPutRobinhoodOptionMark } from "@/lib/venue/callput-robinhood-readonly";

const QUOTE_FRESH_MS = 60_000;
export type LegRole = "long" | "short";
const num = (value: number, digits = 2) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const expiryLabel = (seconds: number) => `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * Real CallPut instruments for one underlying, exactly as the venue feed lists them (indicative marks, not fills).
 * Clicking a mark picks that instrument as the long or short leg of the order form below; nothing is prepared or signed here.
 */
export function CallPutChain({ symbol, market, loadedAt, ageMs, onRefresh, refreshing, longId, shortId, role, onRole, onPick }: {
  symbol: string; market: CallPutRobinhoodMarketData; loadedAt: string; ageMs: number; onRefresh: () => void; refreshing: boolean;
  longId: string; shortId: string; role: LegRole; onRole: (role: LegRole) => void; onPick: (option: CallPutRobinhoodOptionMark, role: LegRole) => void;
}) {
  const options = useMemo(() => market.options.filter((option) => option.underlyingSymbol === symbol && option.marketAvailable), [market, symbol]);
  const expiries = useMemo(() => [...new Set(options.map((option) => option.expiryTimestamp))].sort((a, b) => a - b), [options]);
  const selectedExpiry = options.find((option) => option.optionId === longId || option.optionId === shortId)?.expiryTimestamp;
  const [chosen, setChosen] = useState<number | null>(null);
  const expiry = chosen !== null && expiries.includes(chosen) ? chosen : (selectedExpiry ?? expiries[0]);
  const rows = useMemo(() => {
    const byStrike = new Map<number, { strike: number; call?: CallPutRobinhoodOptionMark; put?: CallPutRobinhoodOptionMark }>();
    for (const option of options.filter((item) => item.expiryTimestamp === expiry)) {
      const row = byStrike.get(option.strikePriceRaw) ?? { strike: option.strikePriceRaw };
      row[option.side] = option;
      byStrike.set(option.strikePriceRaw, row);
    }
    return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  }, [options, expiry]);
  const spot = market.spotIndexRaw[symbol];
  const stale = ageMs > QUOTE_FRESH_MS;

  if (expiries.length === 0 || expiry === undefined) return <p className="mk-why" role="status">CallPut lists no open {symbol} contracts right now, so there is nothing to trade. Check back when the venue publishes instruments.</p>;

  const cell = (option: CallPutRobinhoodOptionMark | undefined) => {
    if (!option) return <td className="mono">—</td>;
    const asLong = option.optionId === longId; const asShort = option.optionId === shortId;
    return (
      <td>
        <button type="button" className="oc-pick mono" data-leg={asLong ? "long" : asShort ? "short" : "none"} aria-pressed={asLong || asShort}
          aria-label={`${role === "long" ? "Pick as long leg" : "Pick as short leg"}: ${option.instrument}, mark ${num(option.markPriceRaw)}, delta ${num(option.delta)}, IV ${num(option.markIvRaw * 100, 0)} percent`}
          onClick={() => onPick(option, role)}>
          {num(option.markPriceRaw)}{asLong ? <i>L</i> : asShort ? <i>S</i> : null}
        </button>
        <span className="oc-sub mono">Δ {num(option.delta)} · IV {num(option.markIvRaw * 100, 0)}%</span>
      </td>
    );
  };

  return (
    <div className="oc">
      <div className="oc-bar">
        <div className="oc-exp" role="group" aria-label="Expiry">
          {expiries.map((value) => <button type="button" key={value} aria-pressed={value === expiry} onClick={() => setChosen(value)}>{expiryLabel(value).slice(0, 10)}</button>)}
        </div>
        <div className="oc-exp" role="group" aria-label="Leg to pick">
          <button type="button" aria-pressed={role === "long"} onClick={() => onRole("long")}>Pick long leg</button>
          <button type="button" aria-pressed={role === "short"} onClick={() => onRole("short")}>Pick short leg</button>
        </div>
        <button type="button" className="oc-refresh" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh marks"}</button>
      </div>
      <p className="mk-source mono">
        Source CallPut venue feed · {options.length} live instruments · expiry {expiryLabel(expiry)}{spot ? ` · venue spot ${num(spot)}` : ""} · feed <time dateTime={market.lastUpdatedAt}>{formatUtc(market.lastUpdatedAt)}</time>{" "}
        <Chip tone={stale ? "ember" : "azure"}>{stale ? "Feed older than 60 s" : "Feed current"}</Chip>
      </p>
      <div className="oc-scroll">
        <table className="oc-table" aria-label={`${symbol} CallPut options expiring ${expiryLabel(expiry)}`}>
          <thead><tr><th>Calls · mark (USD)</th><th>Strike</th><th>Puts · mark (USD)</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.strike} data-moneyness={spot ? (row.strike < spot ? "call-itm" : "put-itm") : "unknown"}>
                {cell(row.call)}
                <th scope="row" className="mono">{num(row.strike, row.strike % 1 ? 2 : 0)}</th>
                {cell(row.put)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="md-note">Marks are CallPut&apos;s indicative USD prices per underlying unit, loaded <time dateTime={loadedAt}>{formatUtc(loadedAt)}</time>. They are venue option prices, not the stock price or the token price above. The direct-wallet route opens two-leg spreads: pick both legs with the same expiry and type, then prepare the order below.</p>
    </div>
  );
}
