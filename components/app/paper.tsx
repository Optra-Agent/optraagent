import type { AgentDecision, PaperOrder, PaperPosition } from "../../lib/domain/contracts";
import { formatUsd, formatUtc, shortHash, signedTone } from "./format";
import { actionTone, Chip, DecisionTrace } from "./ui";

export function PositionGrid({ positions }: { positions: PaperPosition[] }) {
  if (positions.length === 0) return <p className="empty-line">No paper positions.</p>;
  return (
    <div className="position-grid">
      {positions.map((position) => (
        <article className="position-card" key={position.id}>
          <div className="position-head">
            <strong>{position.symbol} {position.optionType.toUpperCase()} · {formatUsd(position.strikeUsd)}</strong>
            <Chip tone={position.status === "open" ? "azure" : "neutral"}>{position.status}</Chip>
          </div>
          <dl className="kv kv-tight">
            <div><dt>Quantity</dt><dd className="mono">{position.quantity} model unit(s)</dd></div>
            <div><dt>Entry premium</dt><dd className="mono">{formatUsd(position.averageEntryUsd, 4)}</dd></div>
            <div><dt>Mark</dt><dd className="mono">{formatUsd(position.markPriceUsd, 4)}</dd></div>
            <div><dt>Unrealized P/L</dt><dd className={`mono pnl pnl-${signedTone(position.unrealizedPnlUsd)}`}>{formatUsd(position.unrealizedPnlUsd, 4)}</dd></div>
            {position.status === "closed" ? <div><dt>Realized P/L</dt><dd className={`mono pnl pnl-${signedTone(position.realizedPnlUsd)}`}>{formatUsd(position.realizedPnlUsd, 4)}</dd></div> : null}
            <div><dt>Expiry</dt><dd className="mono">{formatUtc(position.expiryAt)}</dd></div>
          </dl>
          <p className="position-foot">Modeled premium · Black–Scholes · IV {position.impliedVolatility}</p>
        </article>
      ))}
    </div>
  );
}

export function OrdersTable({ orders }: { orders: PaperOrder[] }) {
  if (orders.length === 0) return <p className="empty-line">No paper orders.</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption className="sr-only">Modeled paper orders</caption>
        <thead>
          <tr><th scope="col">Order</th><th scope="col">Strike</th><th scope="col">Expiry</th><th scope="col">Model premium</th><th scope="col">Paper fill</th><th scope="col">Slippage</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <th scope="row">{order.side.toUpperCase()} {order.quantity} {order.symbol} {order.optionType.toUpperCase()}<span className="cell-sub">IV {order.impliedVolatility} · venue fees excluded</span></th>
              <td className="mono">{formatUsd(order.strikeUsd)}</td>
              <td className="mono">{formatUtc(order.expiryAt)}</td>
              <td className="mono">{formatUsd(order.modelPremiumUsd, 4)}</td>
              <td className="mono">{formatUsd(order.priceUsd, 4)}</td>
              <td className="mono">{order.slippageBps} bp</td>
              <td>{order.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TapeList({ decisions }: { decisions: AgentDecision[] }) {
  if (decisions.length === 0) return <p className="empty-line">No persisted decisions.</p>;
  return (
    <div className="tape-list">
      {decisions.map((decision) => (
        <article className="tape-row" key={decision.id}>
          <div className="tape-row-head">
            <Chip tone={actionTone(decision.action)}>{decision.action}</Chip>
            <time className="mono" dateTime={decision.createdAt}>{formatUtc(decision.createdAt)}</time>
          </div>
          <p className="tape-reason">{decision.reason}</p>
          <p className="tape-source mono">Source {decision.snapshotSource} · Recipe {shortHash(decision.recipeHash, 14, 6)}</p>
          <DecisionTrace decision={decision} />
        </article>
      ))}
    </div>
  );
}
