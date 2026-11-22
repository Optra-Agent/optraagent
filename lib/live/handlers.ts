/**
 * Owner-facing "Enable live" endpoints: read G1–G7 with remediation, and record the G7 risk acknowledgement.
 * Neither endpoint can turn live trading on. G3 is an operator setting; the owner can only satisfy G7.
 */
import { z } from "zod";
import type { AppDatabase } from "../db/client";
import { SessionSchema, type Session } from "../domain/contracts";
import { isCompleteAcknowledgement, loadLiveGateReport, saveAcknowledgement } from "./gate-loader";
import { resolveCountry } from "./geo";
import type { CallPutAccountGates } from "../venue/callput-account-gates";
import { BETA_CAPS, DEFAULT_BLOCKED_COUNTRIES, MIN_EXPIRY_CYCLES, MIN_PAPER_DAYS, readGateEnv, RISK_ACK_STATEMENTS, RISK_ACK_VERSION } from "./gates";
import { CALLPUT_VENUE_CHECKLIST, summarizeVenueChecklist } from "./venue-checklist";

export type LiveGateHandlerOptions = {
  db: AppDatabase;
  readSession: (request: Request) => Promise<Session | Response>;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  /** Live CallPut account-factory read for the signed-in wallet. A failure leaves the evidence out; it never passes a gate. */
  readAccountGates?: (owner: string) => Promise<CallPutAccountGates>;
  /** Test seam for the server-side IP lookup. */
  fetchImpl?: typeof fetch;
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failure = (code: string, message: string, status: number): Response => json({ error: { code, message, retryable: status >= 500 } }, status);

export function createLiveGateHandlers(options: LiveGateHandlerOptions) {
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
        const geo = await resolveCountry(request.headers, env, options.fetchImpl);
        const accountGates = options.readAccountGates ? await options.readAccountGates(who.address).catch(() => null) : null;
        const report = await loadLiveGateReport({ db: options.db, ownerId: who.ownerId, walletAddress: who.address, country: geo.country, geoSource: geo.source, accountGates, now: now(), env });
        return json({
          allPass: report.allPass,
          evaluatedAt: report.evaluatedAt,
          gates: report.gates,
          // The button is derived from the same report the worker uses; there is no second opinion.
          canEnableLive: report.allPass,
          venue: { checkedAt: "2026-11-22", summary: summarizeVenueChecklist(), rows: CALLPUT_VENUE_CHECKLIST },
          caps: BETA_CAPS,
          requirements: { paperDays: MIN_PAPER_DAYS, expiryCycles: MIN_EXPIRY_CYCLES, blockedCountries: readGateEnv(env).blockedCountries ?? DEFAULT_BLOCKED_COUNTRIES },
          acknowledgement: { version: RISK_ACK_VERSION, statements: RISK_ACK_STATEMENTS },
        });
      } catch {
        return failure("INTERNAL_ERROR", "Unable to evaluate the live gates.", 500);
      }
    },

    async acknowledge(request: Request): Promise<Response> {
      const who = await owner(request, "POST");
      if (who instanceof Response) return who;
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 2_048) return failure("VALIDATION_ERROR", "Request body exceeds 2 KiB.", 413);
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { return failure("VALIDATION_ERROR", "Request body must be valid JSON.", 400); }
      const body = z.object({ version: z.string(), statementIds: z.array(z.string()).max(10) }).strict().safeParse(raw);
      if (!body.success) return failure("VALIDATION_ERROR", "Acknowledgement is malformed.", 400);
      if (body.data.version !== RISK_ACK_VERSION) return failure("VALIDATION_ERROR", "The risk wording has changed. Reload and read it again.", 409);
      if (!isCompleteAcknowledgement(body.data.statementIds)) return failure("VALIDATION_ERROR", "Every risk statement must be acknowledged.", 400);
      const country = (await resolveCountry(request.headers, env, options.fetchImpl)).country;
      if (country && readGateEnv(env).blockedCountries.includes(country)) return failure("JURISDICTION_BLOCKED", `Live trading is not available in ${country}.`, 403);
      try {
        await saveAcknowledgement(options.db, who.ownerId, body.data.statementIds, country, now());
        return json({ acknowledged: true, version: RISK_ACK_VERSION });
      } catch {
        return failure("INTERNAL_ERROR", "Unable to record the acknowledgement.", 500);
      }
    },
  };
}
