/**
 * In-memory heartbeat of the in-process paper scheduler, kept on `globalThis` so the public Tape route can report it.
 * It describes this server instance only and resets on a restart or redeploy; the decisions themselves are persisted
 * in PostgreSQL and are the evidence of evaluation, not this heartbeat.
 */
export type SchedulerPassSummary = {
  status: "complete" | "partial" | "failed";
  agentsConsidered: number;
  evaluated: number;
  opened: number;
  skipped: number;
  duplicates: number;
  deferred: number;
  dataErrors: number;
  failures: number;
};

export type SchedulerHeartbeat = {
  startedAt: string;
  lastPassAt: string | null;
  lastPassDurationMs: number | null;
  lastPass: SchedulerPassSummary | null;
};

type HeartbeatGlobal = typeof globalThis & { __optraPaperHeartbeat?: SchedulerHeartbeat };

export function recordSchedulerStart(now: Date = new Date()): void {
  (globalThis as HeartbeatGlobal).__optraPaperHeartbeat = { startedAt: now.toISOString(), lastPassAt: null, lastPassDurationMs: null, lastPass: null };
}

export function recordSchedulerPass(summary: SchedulerPassSummary, startedAtMs: number, finishedAt: Date = new Date()): void {
  const scope = globalThis as HeartbeatGlobal;
  const current = scope.__optraPaperHeartbeat ?? { startedAt: new Date(startedAtMs).toISOString(), lastPassAt: null, lastPassDurationMs: null, lastPass: null };
  scope.__optraPaperHeartbeat = { ...current, lastPassAt: finishedAt.toISOString(), lastPassDurationMs: Math.max(0, finishedAt.getTime() - startedAtMs), lastPass: summary };
}

export function readSchedulerHeartbeat(): SchedulerHeartbeat | null {
  return (globalThis as HeartbeatGlobal).__optraPaperHeartbeat ?? null;
}

/** Narrow an HTTP summary body from the scheduler into the heartbeat shape; anything unexpected is a failed pass. */
export function toPassSummary(status: number, body: unknown): SchedulerPassSummary {
  const record = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const count = (key: string) => (typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] as number : 0);
  const reported = record.status === "complete" || record.status === "partial" ? record.status : null;
  return {
    status: reported ?? (status >= 500 || status === 0 ? "failed" : "complete"),
    agentsConsidered: count("agentsConsidered"), evaluated: count("evaluated"), opened: count("opened"), skipped: count("skipped"),
    duplicates: count("duplicates"), deferred: count("deferred"), dataErrors: count("dataErrors"), failures: count("failures"),
  };
}
