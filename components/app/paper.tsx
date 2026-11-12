import { Database } from "lucide-react";
import type { AgentDecision, PaperOrder, PaperPosition } from "../../lib/domain/contracts";
import { formatUsd, formatUtc, shortHash, signedTone } from "./format";
import { actionTone, Chip, DecisionTrace } from "./ui";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PositionGrid({ positions }: { positions: PaperPosition[] }) {
  if (positions.length === 0) return <p className="empty-line">No paper positions.</p>;
  return (
    <div className="position-grid">
      {positions.map((position) => (
        <Card className="position-card" key={position.id}>
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
        </Card>
      ))}
    </div>
  );
}

export function OrdersTable({ orders }: { orders: PaperOrder[] }) {
  if (orders.length === 0) return <p className="empty-line">No paper orders.</p>;
  return (
    <Table>
      <TableCaption className="sr-only">Modeled paper orders</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Order</TableHead><TableHead>Strike</TableHead><TableHead>Expiry</TableHead><TableHead>Model premium</TableHead><TableHead>Paper fill</TableHead><TableHead>Slippage</TableHead><TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id}>
            <TableCell className="min-w-52 font-medium whitespace-normal">
              {order.side.toUpperCase()} {order.quantity} {order.symbol} {order.optionType.toUpperCase()}
              <span className="cell-sub">IV {order.impliedVolatility} · venue fees excluded</span>
            </TableCell>
            <TableCell className="mono">{formatUsd(order.strikeUsd)}</TableCell>
            <TableCell className="mono">{formatUtc(order.expiryAt)}</TableCell>
            <TableCell className="mono">{formatUsd(order.modelPremiumUsd, 4)}</TableCell>
            <TableCell className="mono">{formatUsd(order.priceUsd, 4)}</TableCell>
            <TableCell className="mono">{order.slippageBps} bp</TableCell>
            <TableCell>{order.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function tally(decision: AgentDecision) {
  let pass = 0;
  let block = 0;
  for (const result of decision.hookResults) {
    if (result.status === "block" || result.status === "fail" || result.status === "error") block += 1;
    else if (result.status === "pass" || result.status === "select" || result.status === "size" || result.status === "action") pass += 1;
  }
  return { pass, block };
}

/** The Tape as a timeline: one node per persisted decision, newest first, with the evidence a click away. */
export function TapeList({ decisions }: { decisions: AgentDecision[] }) {
  if (decisions.length === 0) return <p className="empty-line">No persisted decisions.</p>;
  return (
    <ol className="tape-list tape-timeline">
      {decisions.map((decision) => {
        const counts = tally(decision);
        return (
          <li className="tape-row" key={decision.id} data-action={decision.action}>
            <article>
              <div className="tape-row-head">
                <Chip tone={actionTone(decision.action)}>{decision.action}</Chip>
                <time className="mono" dateTime={decision.createdAt}>{formatUtc(decision.createdAt)}</time>
                {counts.pass + counts.block > 0 ? (
                  <span className="tape-tally mono" aria-label={`${counts.pass} hooks passed, ${counts.block} blocked`}>
                    <span className="tally-pass">{counts.pass} pass</span>
                    {counts.block > 0 ? <span className="tally-block">{counts.block} block</span> : null}
                  </span>
                ) : null}
              </div>
              <p className="tape-reason">{decision.reason}</p>
              <p className="tape-source mono"><Database aria-hidden />Source {decision.snapshotSource}<span aria-hidden="true"> · </span>Recipe {shortHash(decision.recipeHash, 14, 6)}</p>
              <DecisionTrace decision={decision} />
            </article>
          </li>
        );
      })}
    </ol>
  );
}
