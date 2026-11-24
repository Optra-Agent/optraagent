/**
 * Owner-facing Live Agent controls: read status, propose a grant, revoke a grant, and stop.
 *
 * Deliberately not exposed: recording venue, audit or owner-authorization evidence, activating a grant, and resuming
 * the agent. The only evidence write is a short-lived jurisdiction proof resolved by the server from the current
 * authenticated owner's request. Stopping and revoking are always available to the authenticated owner.
 */
import { z } from "zod";
import type { AppDatabase } from "../db/client";
import { SessionSchema, type Session } from "../domain/contracts";
import {
  getLiveAgentControl,
  liveAgentLeasePresent,
  getLiveAgentGrant,
  listLiveAgentRequests,
  proposeLiveAgentGrant,
  revokeLiveAgentGrant,
  stopLiveAgent,
  recordLiveAgentJurisdictionEvidence,
  waitForLiveAgentLeaseRelease,
  type LiveAgentGrantRecord,
} from "./callput-live-agent-store";
import { autonomyBlockers } from "./callput-live-agent-guard";
import type { DelegationFinding } from "./callput-account-capability";
import type { CallPutAccountGates } from "./callput-account-gates";
import { liveAgentGrants } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import { loadLiveGateReport } from "../live/gate-loader";
import { readGateEnv, type GateReport } from "../live/gates";
import { resolveCountry } from "../live/geo";

export type LiveAgentHandlerOptions = {
  db: AppDatabase;
  readSession: (request: Request) => Promise<Session | Response>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  /** Read-only venue evidence about delegated sessions. Failure must never break the status page. */
  readVenueDelegation?: () => Promise<{ fetchedAt: string; findings: DelegationFinding[] }>;
  /** Live read of the CallPut account factory gates for the signed-in owner. Failure must never break the status page. */
  readAccountGates?: (owner: string, tradingAddress?: string) => Promise<CallPutAccountGates>;
  /** Bounded drain window for stop/revoke; exposed to tests, not to requests. */
  stopDrainTimeoutMs?: number;
  /** Test seam for the trusted server-side jurisdiction provider. */
  fetchImpl?: typeof fetch;
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failure = (code: "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR" | "JURISDICTION_BLOCKED" | "JURISDICTION_UNAVAILABLE" | "POLICY_NOT_CONFIGURED", message: string, status: number): Response =>
  json({ error: { code, message, retryable: status >= 500 } }, status);

async function readBody(request: Request): Promise<unknown | Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 8_192) return failure("VALIDATION_ERROR", "Request body exceeds 8 KiB.", 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return failure("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }
}

const PublicGrant = (grant: LiveAgentGrantRecord) => ({
  id: grant.id,
  agentId: grant.agentId,
  tradingAddress: grant.tradingAddress,
  route: grant.route,
  status: grant.status,
  expiresAt: new Date(grant.expiresAtMs).toISOString(),
  policy: grant.policy,
  missingEvidence: autonomyBlockers(grant.evidence).map((b) => b.id),
});

export function createLiveAgentHandlers(options: LiveAgentHandlerOptions) {
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;

  async function owner(request: Request, method: "GET" | "POST"): Promise<{ ownerId: string; address: string } | Response> {
    if (request.method !== method) return new Response(null, { status: 405, headers: { allow: method, "cache-control": "no-store" } });
    const value = await options.readSession(request);
    if (value instanceof Response) return value;
    const parsed = SessionSchema.safeParse(value);
    if (!parsed.success) return failure("INTERNAL_ERROR", "Unable to validate the current wallet session.", 500);
    const id = z.uuid().safeParse(parsed.data.user.id);
    if (!id.success) return failure("INTERNAL_ERROR", "The authenticated wallet owner ID is invalid.", 500);
    return { ownerId: id.data, address: parsed.data.user.address };
  }

  return {
    async status(request: Request): Promise<Response> {
      const who = await owner(request, "GET");
      if (who instanceof Response) return who;
      try {
        const evaluatedAt = now();
        const [control, leasePresent] = await Promise.all([
          getLiveAgentControl(options.db, who.ownerId),
          liveAgentLeasePresent(options.db, who.ownerId, evaluatedAt),
        ]);
        const rows = await options.db.select().from(liveAgentGrants).where(eq(liveAgentGrants.ownerId, who.ownerId)).orderBy(desc(liveAgentGrants.createdAt)).limit(25);
        const grants = (await Promise.all(rows.map((row) => getLiveAgentGrant(options.db, who.ownerId, row.id)))).filter((g): g is LiveAgentGrantRecord => g !== null);
        const requests = (await listLiveAgentRequests(options.db, who.ownerId))
          .sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 50)
          .map((r) => ({ id: r.id, state: r.state, collateralRaw: r.collateralRaw, transactionHash: r.transactionHash, requestKey: r.requestKey, createdAt: new Date(r.createdAtMs).toISOString() }));
        const gateGrant = grants.find((grant) => grant.status === "active" && grant.expiresAtMs > evaluatedAt.getTime())
          ?? grants.find((grant) => grant.status === "proposed")
          ?? null;
        let venueDelegation: { status: "ok"; fetchedAt: string; findings: DelegationFinding[] } | { status: "unavailable" } | { status: "not-configured" } = { status: "not-configured" };
        if (options.readVenueDelegation) {
          try {
            venueDelegation = { status: "ok", ...(await options.readVenueDelegation()) };
          } catch {
            venueDelegation = { status: "unavailable" };
          }
        }
        let accountGateFacts: CallPutAccountGates | null = null;
        let accountGates: ({ status: "ok" } & CallPutAccountGates) | { status: "unavailable" } | { status: "not-configured" } = { status: "not-configured" };
        if (options.readAccountGates) {
          try {
            accountGateFacts = await options.readAccountGates(who.address, gateGrant?.tradingAddress);
            accountGates = { status: "ok", ...accountGateFacts };
          } catch {
            accountGates = { status: "unavailable" };
          }
        }
        const gateReport: GateReport = await loadLiveGateReport({
          db: options.db,
          ownerId: who.ownerId,
          walletAddress: who.address,
          // A scheduler tick cannot use the cron caller's location or a saved acknowledgement country.
          country: null,
          geoSource: null,
          evaluationContext: "scheduled-worker",
          accountGates: accountGateFacts,
          ownerStopActive: control.stopped,
          now: evaluatedAt,
          env,
          ...(gateGrant ? { grantId: gateGrant.id, agentRef: gateGrant.agentId } : {}),
        });
        const liveTradingSwitchOn = env.LIVE_TRADING_ENABLED === "true";
        const killSwitchActive = env.LIVE_AGENT_KILL_SWITCH === "true";
        return json({
          liveTradingEnabled: liveTradingSwitchOn && !killSwitchActive,
          liveTradingSwitchOn,
          killSwitchActive,
          activationGatesPass: gateReport.allPass,
          gateReport,
          accountGates,
          submissionRoute: "not-configured",
          venueDelegation,
          control: { ...control, leasePresent },
          grants: grants.map(PublicGrant),
          requests,
        });
      } catch {
        return failure("INTERNAL_ERROR", "Unable to load Live Agent status.", 500);
      }
    },

    async refreshJurisdiction(request: Request): Promise<Response> {
      const who = await owner(request, "POST");
      if (who instanceof Response) return who;
      const raw = await readBody(request);
      if (raw instanceof Response) return raw;
      const body = z.object({ grantId: z.uuid() }).strict().safeParse(raw);
      if (!body.success) return failure("VALIDATION_ERROR", "A valid grant id is required to bind the location proof.", 400);
      const evaluatedAt = now();
      const operator = readGateEnv(env);
      if (!operator.jurisdictionPolicyApprovalRef) return failure("POLICY_NOT_CONFIGURED", "A counsel-approved jurisdiction policy reference is not configured.", 409);
      try {
        const grant = await getLiveAgentGrant(options.db, who.ownerId, body.data.grantId);
        if (!grant || grant.status === "revoked" || grant.expiresAtMs <= evaluatedAt.getTime()
          || grant.ownerAddress.toLowerCase() !== who.address.toLowerCase()) {
          return failure("NOT_FOUND", "An eligible grant for this wallet was not found.", 404);
        }
        const geo = await resolveCountry(request.headers, env, options.fetchImpl, evaluatedAt.getTime());
        if (!geo.country || !geo.source) return failure("JURISDICTION_UNAVAILABLE", "The configured trusted source could not determine a current country; no proof was stored.", 409);
        if (operator.blockedCountries.includes(geo.country)) return failure("JURISDICTION_BLOCKED", `Live execution is unavailable in ${geo.country}; no proof was stored.`, 403);
        const updated = await recordLiveAgentJurisdictionEvidence(options.db, who.ownerId, grant.id, {
          country: geo.country,
          source: geo.source,
          policyRef: operator.jurisdictionPolicyApprovalRef,
        }, evaluatedAt);
        if (!updated) return failure("NOT_FOUND", "The grant changed before the location proof could be stored.", 404);
        const proof = updated.evidence.jurisdictionProof;
        if (!proof) return failure("INTERNAL_ERROR", "The jurisdiction proof was not persisted.", 500);
        return json({ country: proof.country, source: proof.source, observedAt: proof.observedAt, expiresAt: proof.expiresAt, policyRef: proof.policyRef });
      } catch {
        return failure("INTERNAL_ERROR", "Unable to refresh owner jurisdiction evidence.", 500);
      }
    },

    async stop(request: Request): Promise<Response> {
      const who = await owner(request, "POST");
      if (who instanceof Response) return who;
      try {
        await stopLiveAgent(options.db, who.ownerId, "Stopped by the owner.", now());
        const quiesced = await waitForLiveAgentLeaseRelease(options.db, who.ownerId, options.stopDrainTimeoutMs ?? 3_000, now);
        return json({ stopped: true, quiesced, leasePresent: !quiesced }, quiesced ? 200 : 202);
      } catch {
        return failure("INTERNAL_ERROR", "Unable to record the stop.", 500);
      }
    },

    async propose(request: Request): Promise<Response> {
      const who = await owner(request, "POST");
      if (who instanceof Response) return who;
      const raw = await readBody(request);
      if (raw instanceof Response) return raw;
      const body = z.object({
        agentId: z.string().min(1).max(64),
        route: z.enum(["direct-wallet", "callput-account"]),
        tradingAddress: z.string(),
        expiresAtMs: z.number().int(),
        policy: z.unknown(),
      }).strict().safeParse(raw);
      if (!body.success) return failure("VALIDATION_ERROR", "Grant proposal is malformed.", 400);
      try {
        const grant = await proposeLiveAgentGrant(options.db, who.ownerId, {
          ownerAddress: who.address,
          tradingAddress: body.data.tradingAddress,
          agentId: body.data.agentId,
          route: body.data.route,
          expiresAtMs: body.data.expiresAtMs,
          policy: body.data.policy as never,
        }, now());
        return json({ grant: PublicGrant(grant), note: "Proposed only. It cannot trade until venue, on-chain, audit, owner and revocation evidence is recorded and the grant is activated outside this API." }, 201);
      } catch (error) {
        if (error instanceof z.ZodError || (error instanceof Error && /Grant (expiry|lifetime)/.test(error.message))) {
          return failure("VALIDATION_ERROR", error instanceof z.ZodError ? "Grant policy exceeds a hard limit or is malformed." : error.message, 400);
        }
        return failure("INTERNAL_ERROR", "Unable to store the grant proposal.", 500);
      }
    },

    async revoke(request: Request, grantId: string): Promise<Response> {
      const who = await owner(request, "POST");
      if (who instanceof Response) return who;
      if (!z.uuid().safeParse(grantId).success) return failure("VALIDATION_ERROR", "Grant id is invalid.", 400);
      try {
        const ok = await revokeLiveAgentGrant(options.db, who.ownerId, grantId, now());
        if (!ok) return failure("NOT_FOUND", "Grant not found.", 404);
        const quiesced = await waitForLiveAgentLeaseRelease(options.db, who.ownerId, options.stopDrainTimeoutMs ?? 3_000, now);
        return json({ revoked: true, stopped: true, quiesced, leasePresent: !quiesced }, quiesced ? 200 : 202);
      } catch {
        return failure("INTERNAL_ERROR", "Unable to revoke the grant.", 500);
      }
    },
  };
}

