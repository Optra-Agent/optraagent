/**
 * Database-backed inputs for the live gates. Reads only; the one write is the owner's own G7 acknowledgement.
 */
import { and, count, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { agents, liveAgentGrants, liveRiskAcknowledgements, paperAccounts, paperDecisions } from "../../db/schema";
import type { AppDatabase } from "../db/client";
import type { AutonomyEvidence } from "../venue/callput-live-agent-guard";
import { getLiveAgentControl, getLiveAgentGrant, type LiveAgentGrantRecord } from "../venue/callput-live-agent-store";
import { evaluateLiveGates, MIN_EXPIRY_CYCLES, MIN_PAPER_DAYS, readGateEnv, RISK_ACK_STATEMENTS, RISK_ACK_VERSION, type GateInput, type GateReport, type PaperCandidate } from "./gates";
import { CALLPUT_VENUE_CHECKLIST } from "./venue-checklist";

const numberOf = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Prefers a candidate meeting every G6 condition, then the strongest supporting history. */
const better = (a: GateInput["paper"], b: GateInput["paper"], now: Date): boolean => {
  if (b.launchedAt === null) return true;
  if (a.launchedAt === null) return false;
  const fullyEligible = (candidate: GateInput["paper"]) => candidate.launchedAt !== null
    && Math.floor((now.getTime() - candidate.launchedAt.getTime()) / 86_400_000) >= MIN_PAPER_DAYS
    && candidate.expiryCycles >= MIN_EXPIRY_CYCLES
    && candidate.evaluatedDecisions > 0;
  if (fullyEligible(a) !== fullyEligible(b)) return fullyEligible(a);
  if ((a.expiryCycles >= MIN_EXPIRY_CYCLES) !== (b.expiryCycles >= MIN_EXPIRY_CYCLES)) return a.expiryCycles >= MIN_EXPIRY_CYCLES;
  if ((a.evaluatedDecisions > 0) !== (b.evaluatedDecisions > 0)) return a.evaluatedDecisions > 0;
  return a.launchedAt.getTime() < b.launchedAt.getTime();
};

/**
 * Paper history for G6. Without a named agent the candidates are the owner's own agents AND the OPTRA House Agents,
 * because the House Agents are the ones PM section 13.3 says may go live and they are what the Agents page shows as
 * running. With a named agent (a UUID or a house key) only that agent counts. Dates come from `agents.launchedAt` and
 * settlements from the paper account counters; nothing here can be set by the owner.
 */
export async function loadPaperHistory(db: AppDatabase, ownerId: string, agentRef?: string, now = new Date()): Promise<GateInput["paper"]> {
  const isUuid = z.uuid().safeParse(agentRef).success;
  const where = agentRef
    ? isUuid
      ? or(
        and(eq(agents.id, agentRef), eq(agents.ownerId, ownerId), eq(agents.kind, "user")),
        and(eq(agents.id, agentRef), eq(agents.kind, "house")),
      )
      : and(eq(agents.houseKey, agentRef), eq(agents.kind, "house"))
    : or(and(eq(agents.ownerId, ownerId), eq(agents.kind, "user")), eq(agents.kind, "house"));
  const rows = await db.select({ id: agents.id, name: agents.name, kind: agents.kind, launchedAt: agents.launchedAt, meta: paperAccounts.meta })
    .from(agents).leftJoin(paperAccounts, eq(paperAccounts.agentId, agents.id)).where(where);
  const decisionCounts = rows.length === 0 ? [] : await db.select({ agentId: paperDecisions.agentId, evaluatedDecisions: count() })
    .from(paperDecisions).innerJoin(agents, eq(paperDecisions.agentId, agents.id))
    .where(and(
      inArray(agents.id, rows.map((row) => row.id)),
      sql`${paperDecisions.createdAt} >= ${agents.launchedAt}`,
      lte(paperDecisions.createdAt, now),
      sql`not (${paperDecisions.hookResults} @> '[{"status":"error"}]'::jsonb)`,
    ))
    .groupBy(paperDecisions.agentId);
  const evaluationsByAgent = new Map(decisionCounts.map((row) => [row.agentId, Number(row.evaluatedDecisions)]));
  const candidates: PaperCandidate[] = rows.map((row) => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return {
      label: row.name,
      kind: row.kind === "house" ? "house" : "user",
      launchedAt: row.launchedAt,
      expiryCycles: numberOf(meta.settledItm) + numberOf(meta.settledOtm),
      evaluatedDecisions: evaluationsByAgent.get(row.id) ?? 0,
    };
  });
  let best: GateInput["paper"] = { launchedAt: null, expiryCycles: 0, evaluatedDecisions: 0, agentLabel: null, candidates };
  for (const candidate of candidates) {
    if (!candidate.launchedAt) continue;
    const current = { ...candidate, agentLabel: candidate.label, candidates };
    if (better(current, best, now)) best = current;
  }
  return best;
}

export async function loadAcknowledgement(db: AppDatabase, ownerId: string): Promise<GateInput["acknowledgement"]> {
  const [row] = await db.select().from(liveRiskAcknowledgements).where(eq(liveRiskAcknowledgements.ownerId, ownerId)).limit(1);
  return row ? { version: row.version, acceptedAt: row.acceptedAt, statementIds: row.statementIds } : null;
}

export async function saveAcknowledgement(db: AppDatabase, ownerId: string, statementIds: readonly string[], country: string | null, now: Date): Promise<void> {
  const values = { ownerId, version: RISK_ACK_VERSION, statementIds: [...statementIds], country, acceptedAt: now };
  await db.insert(liveRiskAcknowledgements).values(values).onConflictDoUpdate({ target: liveRiskAcknowledgements.ownerId, set: { version: values.version, statementIds: values.statementIds, country, acceptedAt: now } });
}

export const isCompleteAcknowledgement = (statementIds: readonly string[]) => RISK_ACK_STATEMENTS.every((statement) => statementIds.includes(statement.id));

async function activeGrant(db: AppDatabase, ownerId: string, nowMs: number, grantId?: string): Promise<LiveAgentGrantRecord | null> {
  const rows = await db.select({ id: liveAgentGrants.id, status: liveAgentGrants.status }).from(liveAgentGrants).where(grantId ? and(eq(liveAgentGrants.ownerId, ownerId), eq(liveAgentGrants.id, grantId)) : and(eq(liveAgentGrants.ownerId, ownerId), eq(liveAgentGrants.status, "active"))).limit(1);
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  const grant = await getLiveAgentGrant(db, ownerId, row.id);
  return grant && grant.status === "active" && grant.expiresAtMs > nowMs ? grant : null;
}

export type LoadGatesOptions = {
  db: AppDatabase;
  ownerId: string;
  /** Connected wallet address, if known. The worker passes the grant's owner address. */
  walletAddress: string | null;
  /** From a trusted source on the current request. A saved acknowledgement country is not runtime evidence. */
  country: string | null;
  now: Date;
  env: Record<string, string | undefined>;
  grantId?: string;
  agentRef?: string;
  /** How `country` was obtained, for the evidence line. */
  geoSource?: GateInput["geoSource"];
  /** Reuse the owner's status read when the caller already has it. Missing remains stopped by default. */
  ownerStopActive?: boolean;
  /** Distinguishes current owner-request evidence from the worker, which cannot use the cron caller's location. */
  evaluationContext?: GateInput["evaluationContext"];
  /** Live CallPut account-factory read for this wallet, when the caller has one. */
  accountGates?: GateInput["accountGates"];
};

/** Loads every gate input and evaluates G1–G7. Any read failure propagates; callers must treat that as "not allowed". */
export async function loadLiveGateReport(options: LoadGatesOptions): Promise<GateReport> {
  const { db, ownerId, now, env } = options;
  const operator = readGateEnv(env);
  const grant = await activeGrant(db, ownerId, now.getTime(), options.grantId);
  const candidateGrant = grant ?? (options.grantId ? await getLiveAgentGrant(db, ownerId, options.grantId) : null);
  const jurisdictionGrant = candidateGrant
    && (candidateGrant.status === "active" || candidateGrant.status === "proposed")
    && candidateGrant.expiresAtMs > now.getTime()
    ? candidateGrant
    : null;
  const evidence: AutonomyEvidence | null = grant?.evidence ?? null;
  const [paper, acknowledgement, control] = await Promise.all([
    loadPaperHistory(db, ownerId, options.agentRef ?? grant?.agentId, now),
    loadAcknowledgement(db, ownerId),
    options.ownerStopActive === undefined
      ? getLiveAgentControl(db, ownerId)
      : Promise.resolve({ stopped: options.ownerStopActive, reason: null }),
  ]);
  return evaluateLiveGates({
    now,
    venue: { rows: CALLPUT_VENUE_CHECKLIST, ownerSignoffRef: operator.ownerSignoffRef },
    custody: { activeGrant: grant !== null, route: grant?.route ?? null, tradingAddress: grant?.tradingAddress ?? null, evidence },
    globalSwitchOn: operator.globalSwitchOn,
    ownerStopActive: control.stopped,
    wallet: { address: options.walletAddress ?? grant?.ownerAddress ?? null, allowlist: operator.allowlist },
    country: options.country,
    geoSource: options.geoSource ?? null,
    evaluationContext: options.evaluationContext,
    ownerJurisdictionEvidence: jurisdictionGrant?.evidence.jurisdictionProof ?? null,
    accountGates: options.accountGates ?? null,
    blockedCountries: operator.blockedCountries,
    jurisdictionPolicyApprovalRef: operator.jurisdictionPolicyApprovalRef,
    paper,
    acknowledgement,
  });
}
