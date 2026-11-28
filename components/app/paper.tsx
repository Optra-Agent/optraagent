import Link from "next/link";
import { Database } from "lucide-react";
import type { AgentDecision, PaperOrder, PaperPosition } from "../../lib/domain/contracts";
import { formatUsd, formatUtc, shortHash, signedTone, titleCase } from "./format";
import { actionTone, Chip, DecisionTrace, decisionOutcome } from "./ui";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PositionGrid({ positions }: { positions: PaperPosition[] }) {
  if (positions.length === 0) return <p className="empty-line">No paper positions.</p>;
  return (
    <div className="position-grid">
      {positions.map((position) => (
        <Card className="position-card" key={position.id}>
          <div className="position-head">
            <strong>{position.side === "short" ? "SHORT" : "LONG"} {position.symbol} {position.optionType.toUpperCase()} · {formatUsd(position.strikeUsd)}</strong>
            <Chip tone={position.status === "open" ? "azure" : "neutral"}>{position.status}</Chip>
          </div>
          <dl className="kv kv-tight">
            <div><dt>Quantity</dt><dd className="mono">{position.quantity} model unit(s)</dd></div>
            <div><dt>Entry premium</dt><dd className="mono">{formatUsd(position.averageEntryUsd, 4)}</dd></div>
            <div><dt>Mark</dt><dd className="mono">{formatUsd(position.markPriceUsd, 4)}</dd></div>
            <div><dt>Unrealized P/L</dt><dd className={`mono pnl pnl-${signedTone(position.unrealizedPnlUsd)}`}>{formatUsd(position.unrealizedPnlUsd, 4)}</dd></div>
            {position.status === "closed" ? <div><dt>Realized P/L</dt><dd className={`mono pnl pnl-${signedTone(position.realizedPnlUsd)}`}>{formatUsd(position.realizedPnlUsd, 4)}</dd></div> : null}
            {position.side === "short" && Number(position.collateralUsd ?? 0) > 0 ? <div><dt>Collateral locked</dt><dd className="mono">{formatUsd(String(position.collateralUsd))}</dd></div> : null}
            <div><dt>Expiry</dt><dd className="mono">{formatUtc(position.expiryAt)}</dd></div>
          </dl>
          <p className="position-foot">Modeled premium · Black–Scholes · IV {position.impliedVolatility}{position.side === "short" ? " · premium received" : ""}</p>
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

export type TapeDecision = AgentDecision & { agentName?: string | undefined; underlyingSymbol?: string | undefined; templateId?: string | undefined };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** What data the evaluation read, taken from the persisted decision itself: the candle, the history hash and window. */
export function decisionProvenance(decision: AgentDecision): { candleEndAt: string | null; historyHash: string | null; historyCandles: number | null; x402Provider: string | null; x402Regime: string | null } {
  const context = record(decision.marketContext);
  const observation = record(context?.observation);
  const window = record(context?.historyWindow);
  const x402Resource = record(context?.x402Resource);
  const history = Array.isArray(context?.history) ? context.history.length : null;
  const candles = typeof window?.candles === "number" ? window.candles : history;
  return {
    candleEndAt: typeof observation?.endAt === "string" ? observation.endAt : null,
    historyHash: typeof context?.historyDataHash === "string" ? context.historyDataHash : null,
    historyCandles: candles,
    x402Provider: typeof x402Resource?.providerId === "string" ? x402Resource.providerId : null,
    x402Regime: typeof x402Resource?.regime === "string" ? x402Resource.regime : null,
  };
}

/** The Tape as a timeline: one node per persisted decision, newest first, with the evidence a click away. */
export function TapeList({ decisions, emptyText = "No persisted decisions." }: { decisions: TapeDecision[]; emptyText?: string }) {
  if (decisions.length === 0) return <p className="empty-line">{emptyText}</p>;
  return (
    <ol className="tape-list tape-timeline">
      {decisions.map((decision) => {
        const counts = tally(decision);
        const outcome = decisionOutcome(decision);
        const provenance = decisionProvenance(decision);
        return (
          <li className="tape-row" key={decision.id} data-action={outcome}>
            <article>
              <div className="tape-row-head">
                <Chip tone={actionTone(outcome)}>{outcome}</Chip>
                {decision.agentName ? (
                  <span className="tape-agent"><Link href={`/house/${encodeURIComponent(decision.agentId)}`}>{decision.agentName}</Link>{decision.templateId ? <span className="tape-strategy"> · {titleCase(decision.templateId)}{decision.underlyingSymbol ? ` · ${decision.underlyingSymbol}` : ""}</span> : null}</span>
                ) : null}
                <time className="mono" dateTime={decision.createdAt} title="Close of the hourly candle that was evaluated">{formatUtc(decision.createdAt)}</time>
                {counts.pass + counts.block > 0 ? (
                  <span className="tape-tally mono" aria-label={`${counts.pass} hooks passed, ${counts.block} blocked`}>
                    <span className="tally-pass">{counts.pass} pass</span>
                    {counts.block > 0 ? <span className="tally-block">{counts.block} block</span> : null}
                  </span>
                ) : null}
              </div>
              <p className="tape-reason">{decision.reason}</p>
              <p className="tape-source mono">
                <Database aria-hidden />Source {decision.snapshotSource}
                {provenance.historyHash ? <><span aria-hidden="true"> · </span><span title={provenance.historyHash}>History {shortHash(provenance.historyHash, 14, 6)}{provenance.historyCandles ? ` (${provenance.historyCandles} candles)` : ""}</span></> : null}
                {provenance.x402Provider ? <><span aria-hidden="true"> · </span><span>x402 {provenance.x402Provider}{provenance.x402Regime ? ` (${provenance.x402Regime})` : ""}</span></> : null}
                <span aria-hidden="true"> · </span>Recipe {shortHash(decision.recipeHash, 14, 6)}
              </p>
              <DecisionTrace decision={decision} />
            </article>
          </li>
        );
      })}
    </ol>
  );
}
