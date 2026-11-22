/**
 * Database-backed inputs for the live gates. Reads only; the one write is the owner's own G7 acknowledgement.
 */
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { agents, liveAgentGrants, liveRiskAcknowledgements, paperAccounts } from "../../db/schema";
import type { AppDatabase } from "../db/client";
import type { AutonomyEvidence } from "../venue/callput-live-agent-guard";
import { getLiveAgentGrant, type LiveAgentGrantRecord } from "../venue/callput-live-agent-store";
import { evaluateLiveGates, readGateEnv, RISK_ACK_STATEMENTS, RISK_ACK_VERSION, type GateInput, type GateReport, type PaperCandidate } from "./gates";
import { CALLPUT_VENUE_CHECKLIST } from "./venue-checklist";

const numberOf = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Prefers an agent that has settled an expiry, then the one launched earliest. */
const better = (a: GateInput["paper"], b: GateInput["paper"]): boolean => {
  if (b.launchedAt === null) return true;
  if (a.launchedAt === null) return false;
  if ((a.expiryCycles >= 1) !== (b.expiryCycles >= 1)) return a.expiryCycles >= 1;
  return a.launchedAt.getTime() < b.launchedAt.getTime();
};

/**
 * Paper history for G6. Without a named agent the candidates are the owner's own agents AND the OPTRA House Agents,
 * because the House Agents are the ones PM section 13.3 says may go live and they are what the Agents page shows as
 * running. With a named agent (a UUID or a house key) only that agent counts. Dates come from `agents.launchedAt` and
 * settlements from the paper account counters; nothing here can be set by the owner.
 */
export async function loadPaperHistory(db: AppDatabase, ownerId: string, agentRef?: string): Promise<GateInput["paper"]> {
  const isUuid = z.uuid().safeParse(agentRef).success;
  const where = agentRef
    ? isUuid ? eq(agents.id, agentRef) : eq(agents.houseKey, agentRef)
    : or(and(eq(agents.ownerId, ownerId), eq(agents.kind, "user")), eq(agents.kind, "house"));
  const rows = await db.select({ name: agents.name, kind: agents.kind, launchedAt: agents.launchedAt, meta: paperAccounts.meta })
    .from(agents).leftJoin(paperAccounts, eq(paperAccounts.agentId, agents.id)).where(where);
  const candidates: PaperCandidate[] = rows.map((row) => {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return { label: row.name, kind: row.kind === "house" ? "house" : "user", launchedAt: row.launchedAt, expiryCycles: numberOf(meta.settledItm) + numberOf(meta.settledOtm) };
  });
  let best: GateInput["paper"] = { launchedAt: null, expiryCycles: 0, agentLabel: null, candidates };
  for (const candidate of candidates) {
    if (!candidate.launchedAt) continue;
    if (better({ ...candidate, agentLabel: candidate.label }, best)) best = { launchedAt: candidate.launchedAt, expiryCycles: candidate.expiryCycles, agentLabel: candidate.label, candidates };
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
  /** From the edge for the current request. The worker passes the country stored with the acknowledgement. */
  country: string | null;
  now: Date;
  env: Record<string, string | undefined>;
  grantId?: string;
  agentRef?: string;
  /** How `country` was obtained, for the evidence line. */
  geoSource?: GateInput["geoSource"];
  /** Live CallPut account-factory read for this wallet, when the caller has one. */
  accountGates?: GateInput["accountGates"];
};

/** Loads every gate input and evaluates G1–G7. Any read failure propagates; callers must treat that as "not allowed". */
export async function loadLiveGateReport(options: LoadGatesOptions): Promise<GateReport> {
  const { db, ownerId, now, env } = options;
  const operator = readGateEnv(env);
  const grant = await activeGrant(db, ownerId, now.getTime(), options.grantId);
  const evidence: AutonomyEvidence | null = grant?.evidence ?? null;
  const [paper, acknowledgement] = await Promise.all([loadPaperHistory(db, ownerId, options.agentRef ?? grant?.agentId), loadAcknowledgement(db, ownerId)]);
  return evaluateLiveGates({
    now,
    venue: { rows: CALLPUT_VENUE_CHECKLIST, ownerSignoffRef: operator.ownerSignoffRef },
    custody: { activeGrant: grant !== null, route: grant?.route ?? null, evidence },
    globalSwitchOn: operator.globalSwitchOn,
    wallet: { address: options.walletAddress ?? grant?.ownerAddress ?? null, allowlist: operator.allowlist },
    country: options.country,
    geoSource: options.geoSource ?? null,
    accountGates: options.accountGates ?? null,
    blockedCountries: operator.blockedCountries,
    paper,
    acknowledgement,
  });
}

/** Stored country for the worker, which has no HTTP request. Null when none was recorded. */
export async function loadAcknowledgedCountry(db: AppDatabase, ownerId: string): Promise<string | null> {
  const [row] = await db.select({ country: liveRiskAcknowledgements.country }).from(liveRiskAcknowledgements).where(eq(liveRiskAcknowledgements.ownerId, ownerId)).limit(1);
  return row?.country ?? null;
}
