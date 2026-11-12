import { Info } from "lucide-react";
import type { BacktestMetrics } from "../../../lib/domain/contracts";
import { formatUsd, formatUtc, signedTone } from "../format";

const signed = (value: string) => `${Number(value) > 0 ? "+" : ""}${value}%`;
const points = (value: string) => `${Number(value) > 0 ? "+" : ""}${value} pp`;

/**
 * Strategy against its two same-window benchmarks, drawn only from the server's `metrics.benchmarks`.
 * Nothing is computed or reconstructed here. Older runs without the field show an unavailable state.
 */
export function BenchmarkComparison({ metrics }: { metrics: BacktestMetrics }) {
  const bench = metrics.benchmarks;
  if (!bench) {
    return (
      <section className="bench bench-missing" aria-label="Benchmark comparison">
        <p className="bench-title"><Info aria-hidden />Benchmark comparison unavailable</p>
        <p>This run was saved before benchmarks were recorded, so there is nothing to compare it with. Run a new backtest to see the comparison.</p>
      </section>
    );
  }

  const rows = [
    { key: "strategy", label: "Protective Put (modeled)", value: metrics.totalReturnPct, note: "Modeled option premiums" },
    { key: "holding", label: `Buy and hold ${bench.underlying.symbol}`, value: bench.underlying.returnPct, note: "Price only" },
    { key: "cash", label: "Flat USD cash", value: bench.cash.returnPct, note: "No yield" },
  ];
  const span = Math.max(1, ...rows.map((row) => Math.abs(Number(row.value))));

  return (
    <section className="bench" aria-label="Benchmark comparison">
      <div className="bench-head">
        <h3>Compared with the same window</h3>
        <span className="bench-window mono">{bench.window.decisionSamples} decision candles · {formatUtc(bench.window.startAt)} to {formatUtc(bench.window.endAt)}</span>
      </div>
      <ul className="bench-bars">
        {rows.map((row) => {
          const value = Number(row.value);
          const width = `${(Math.abs(value) / span) * 50}%`;
          return (
            <li key={row.key} className="bench-row" data-key={row.key}>
              <div className="bench-label"><span>{row.label}</span><small>{row.note}</small></div>
              <div className="bench-track" role="img" aria-label={`${row.label}: ${signed(row.value)}`}>
                <i className="bench-axis" />
                <i className={`bench-fill bench-${value >= 0 ? "pos" : "neg"}`} style={value >= 0 ? { left: "50%", width } : { right: "50%", width }} />
              </div>
              <b className={`mono pnl pnl-${signedTone(row.value)}`}>{signed(row.value)}</b>
            </li>
          );
        })}
      </ul>
      <dl className="bench-diff">
        <div><dt>Versus holding</dt><dd className={`mono pnl pnl-${signedTone(bench.vsHoldingPct)}`}>{points(bench.vsHoldingPct)}</dd></div>
        <div><dt>Versus flat USD</dt><dd className={`mono pnl pnl-${signedTone(bench.vsCashPct)}`}>{points(bench.vsCashPct)}</dd></div>
        <div><dt>Holding, start to end</dt><dd className="mono">{formatUsd(bench.underlying.startingValueUsd)} to {formatUsd(bench.underlying.endingValueUsd)}</dd></div>
        <div><dt>Cash, start to end</dt><dd className="mono">{formatUsd(bench.cash.startingValueUsd)} to {formatUsd(bench.cash.endingValueUsd)}</dd></div>
      </dl>
      <ul className="bench-notes">
        <li>Buy and hold is price only. It excludes dividends, fees and slippage.</li>
        <li>Flat USD cash is an accounting baseline with zero yield. It is not a measured USDG return, because no USDG price path is modeled.</li>
        <li>The strategy return uses modeled Black–Scholes premiums with 50 bp slippage and no venue fees. It is a model result, not a forecast.</li>
      </ul>
    </section>
  );
}
