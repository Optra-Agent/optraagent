/**
 * Owner-facing Live Agent controls: read status, propose a grant, revoke a grant, and stop.
 *
 * Deliberately not exposed: recording evidence, activating a grant, and resuming the agent. Those require facts only
 * the venue, an auditor and the owner can supply, and they are performed outside the public API. Stopping and
 * revoking are always available to the authenticated owner and need no evidence.
 */
import { z } from "zod";
import type { AppDatabase } from "../db/client";
import { SessionSchema, type Session } from "../domain/contracts";
import {
  getLiveAgentControl,
  getLiveAgentGrant,
  listLiveAgentRequests,
  proposeLiveAgentGrant,
  revokeLiveAgentGrant,
  stopLiveAgent,
  type LiveAgentGrantRecord,
} from "./callput-live-agent-store";
import { autonomyBlockers } from "./callput-live-agent-guard";
import type { DelegationFinding } from "./callput-account-capability";
import type { CallPutAccountGates } from "./callput-account-gates";
import { liveAgentGrants } from "../../db/schema";
import { desc, eq } from "drizzle-orm";

export type LiveAgentHandlerOptions = {
  db: AppDatabase;
  readSession: (request: Request) => Promise<Session | Response>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  /** Read-only venue evidence about delegated sessions. Failure must never break the status page. */
  readVenueDelegation?: () => Promise<{ fetchedAt: string; findings: DelegationFinding[] }>;
  /** Live read of the CallPut account factory gates for the signed-in owner. Failure must never break the status page. */
  readAccountGates?: (owner: string) => Promise<CallPutAccountGates>;
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failure = (code: "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR", message: string, status: number): Response =>
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
        const control = await getLiveAgentControl(options.db, who.ownerId);
        const rows = await options.db.select().from(liveAgentGrants).where(eq(liveAgentGrants.ownerId, who.ownerId)).orderBy(desc(liveAgentGrants.createdAt)).limit(25);
        const grants = (await Promise.all(rows.map((row) => getLiveAgentGrant(options.db, who.ownerId, row.id)))).filter((g): g is LiveAgentGrantRecord => g !== null);
        const requests = (await listLiveAgentRequests(options.db, who.ownerId))
          .sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 50)
          .map((r) => ({ id: r.id, state: r.state, collateralRaw: r.collateralRaw, transactionHash: r.transactionHash, requestKey: r.requestKey, createdAt: new Date(r.createdAtMs).toISOString() }));
        let venueDelegation: { status: "ok"; fetchedAt: string; findings: DelegationFinding[] } | { status: "unavailable" } | { status: "not-configured" } = { status: "not-configured" };
        if (options.readVenueDelegation) {
          try {
            venueDelegation = { status: "ok", ...(await options.readVenueDelegation()) };
          } catch {
            venueDelegation = { status: "unavailable" };
          }
        }
        let accountGates: ({ status: "ok" } & CallPutAccountGates) | { status: "unavailable" } | { status: "not-configured" } = { status: "not-configured" };
        if (options.readAccountGates) {
          try {
            accountGates = { status: "ok", ...(await options.readAccountGates(who.address)) };
          } catch {
            accountGates = { status: "unavailable" };
          }
        }
        return json({
          liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
          accountGates,
          submissionRoute: "not-configured",
          venueDelegation,
          control,
          grants: grants.map(PublicGrant),
          requests,
        });
      } catch {
        return failure("INTERNAL_ERROR", "Unable to load Live Agent status.", 500);
      }
    },

    async stop(request: Request): Promise<Response> {
      const who = await owner(request, "POST");
      if (who instanceof Response) return who;
      try {
        await stopLiveAgent(options.db, who.ownerId, "Stopped by the owner.", now());
        return json({ stopped: true });
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
        return ok ? json({ revoked: true, stopped: true }) : failure("NOT_FOUND", "Grant not found.", 404);
      } catch {
        return failure("INTERNAL_ERROR", "Unable to revoke the grant.", 500);
      }
    },
  };
}

