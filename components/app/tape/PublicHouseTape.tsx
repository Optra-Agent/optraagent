"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiErrorSchema, PublicTapeResponseSchema } from "../../../lib/domain/contracts";
import type { PublicSchedulerStatus, PublicTapeResponse } from "../../../lib/domain/contracts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { errorText, formatUtc, titleCase } from "../format";
import { TapeList } from "../paper";
import { Chip, Panel, Skeleton, StateBlock, decisionOutcome } from "../ui";
import type { DecisionOutcome } from "../ui";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tape: PublicTapeResponse };
type Filter = "all" | DecisionOutcome;

const CLOSED_REASON: Record<NonNullable<PublicSchedulerStatus["marketClosedReason"]>, string> = {
  weekend: "the weekend",
  holiday: "a US market holiday",
  before_open: "before the 09:30 ET open",
  after_close: "after the regular-session close",
};

function SchedulerNote({ scheduler, empty }: { scheduler: PublicSchedulerStatus; empty: boolean }) {
  const pass = scheduler.heartbeat?.lastPass ?? null;
  return (
    <div className="tape-status" data-testid="scheduler-status">
      <p>
        <strong>{scheduler.marketOpen ? "US market open" : "US market closed"}</strong>
        {scheduler.marketClosedReason ? ` (${CLOSED_REASON[scheduler.marketClosedReason]})` : ""}.{" "}
        {scheduler.marketOpen
          ? "Each House Agent evaluates every finalized hourly candle that closes inside the regular session."
          : empty ? "No decision is recorded while the market is closed, so an empty Tape is expected right now. Agents never evaluate outside the regular session." : "Agents evaluate only candles that close inside the regular session."}
      </p>
      {scheduler.nextEvaluationNotBeforeAt && scheduler.nextEligibleCandleEndAt ? (
        <p>
          Next evaluation: the candle closing <time className="mono" dateTime={scheduler.nextEligibleCandleEndAt}>{formatUtc(scheduler.nextEligibleCandleEndAt)}</time>, recorded by the first {scheduler.intervalMinutes}-minute scheduler pass after <time className="mono" dateTime={scheduler.nextEvaluationNotBeforeAt}>{formatUtc(scheduler.nextEvaluationNotBeforeAt)}</time> ({scheduler.finalizationGraceMinutes} minutes of finalization grace).
        </p>
      ) : null}
      <p>
        {scheduler.heartbeat
          ? pass && scheduler.heartbeat.lastPassAt
            ? <>Scheduler on this server: last pass <time className="mono" dateTime={scheduler.heartbeat.lastPassAt}>{formatUtc(scheduler.heartbeat.lastPassAt)}</time>, {pass.agentsConsidered} agents considered, {pass.evaluated} evaluated, {pass.dataErrors} recorded as error, {pass.failures} failures. Resets on a restart; the Tape below is the persisted record.</>
            : <>Scheduler on this server started <time className="mono" dateTime={scheduler.heartbeat.startedAt}>{formatUtc(scheduler.heartbeat.startedAt)}</time>; its first pass is pending. The Tape below is the persisted record.</>
          : "Scheduler heartbeat is not reported by this server instance. The Tape below is the persisted record."}
      </p>
    </div>
  );
}

/** OPTRA's own House Agents' persisted decisions, read from the public Tape API. Never a user's private agent. */
export function PublicHouseTape() {
  const [state, setState] = useState<Load>({ status: "loading" });
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/v1/tape?limit=100", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsed = ApiErrorSchema.safeParse(body);
          throw new Error(parsed.success ? parsed.data.error.message : "The public Tape is temporarily unavailable.");
        }
        return PublicTapeResponseSchema.parse(body);
      })
      .then((tape) => setState({ status: "ready", tape }))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: errorText(reason, "The public Tape is temporarily unavailable.") }); });
    return () => controller.abort();
  }, [refreshCount]);

  const decisions = useMemo(() => (state.status === "ready" ? state.tape.decisions : []), [state]);
  const counts = useMemo(() => {
    const tally = { open: 0, hold: 0, close: 0, skip: 0, error: 0 };
    for (const decision of decisions) tally[decisionOutcome(decision)] += 1;
    return tally;
  }, [decisions]);
  const visible = filter === "all" ? decisions : decisions.filter((decision) => decisionOutcome(decision) === filter);

  return (
    <Panel className="public-tape" aria-label="OPTRA House Agents Decision Tape">
      <div className="panel-head">
        <div><p className="eyebrow">BY OPTRA · APPEND-ONLY · PAPER</p><h2>House Agents Decision Tape</h2></div>
        <div className="flex items-center gap-2">
          <Chip>Paper</Chip>
          <Button variant="outline" type="button" disabled={state.status === "loading"} onClick={() => { setState({ status: "loading" }); setRefreshCount((count) => count + 1); }}>Refresh</Button>
        </div>
      </div>
      <p className="panel-lede">Every decision the OPTRA House Agents have persisted: the hourly candle it read, the rule trace, the outcome and the data provenance. Premiums are modeled and no order is a venue fill. These are OPTRA-owned agents, not community adoption.</p>
      {state.status === "loading" ? <div role="status"><Skeleton lines={4} /><span className="sr-only">Loading the public Tape…</span></div> : null}
      {state.status === "error" ? <StateBlock kind="error" title="Public Tape could not be loaded"><p>{state.message}</p></StateBlock> : null}
      {state.status === "ready" ? (
        <>
          {state.tape.scheduler ? <SchedulerNote scheduler={state.tape.scheduler} empty={decisions.length === 0} /> : null}
          <dl className="metric-row tape-summary" aria-label="Public Tape summary">
            <div className="metric"><dt>Decisions shown</dt><dd className="mono">{decisions.length}</dd></div>
            <div className="metric"><dt>Opened</dt><dd className="mono">{counts.open}</dd></div>
            <div className="metric"><dt>Held or skipped</dt><dd className="mono">{counts.hold + counts.skip}</dd></div>
            <div className="metric"><dt>Closed</dt><dd className="mono">{counts.close}</dd></div>
            <div className="metric"><dt>Errors</dt><dd className="mono">{counts.error}</dd></div>
          </dl>
          {decisions.length > 0 ? (
            <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="mb-4">
              <TabsList aria-label="Filter public decisions by outcome" className="h-auto flex-wrap justify-start gap-1 bg-secondary p-1">
                {(["all", "open", "hold", "close", "skip", "error"] as const).map((outcome) => (
                  <TabsTrigger key={outcome} value={outcome} className="h-9 px-3 text-sm data-[state=active]:bg-accent data-[state=active]:text-foreground">
                    {outcome === "all" ? "All" : titleCase(outcome)}
                    <span className="mono ml-1.5 text-xs text-muted-foreground">{outcome === "all" ? decisions.length : counts[outcome]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          <TapeList decisions={visible} emptyText={decisions.length === 0 ? "No decisions have been persisted yet." : `No ${filter} decisions in the latest ${decisions.length}.`} />
        </>
      ) : null}
    </Panel>
  );
}
