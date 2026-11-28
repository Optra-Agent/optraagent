import { z } from "zod";
import { lookupWalletSession } from "../../../../../lib/auth/session-lookup";
import { getDatabase } from "../../../../../lib/db/client";
import { parseUsdgToAtomic } from "../../../../../lib/economics/atomic";
import { DrizzleEconomicRepository } from "../../../../../lib/economics/drizzle-repository";
import { EconomicMandateSchema } from "../../../../../lib/economics/types";
import { ApiErrorSchema } from "../../../../../lib/domain/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AgentIdSchema = z.uuid();

const EconomicsActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("fund"),
    amountUsdg: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
    reason: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  z.object({
    action: z.literal("update_mandate"),
    mandate: EconomicMandateSchema,
    reason: z.string().trim().min(1).max(200).optional(),
  }).strict(),
]);

function err(code: "UNAUTHORIZED" | "NOT_FOUND" | "VALIDATION_ERROR" | "INTERNAL_ERROR", message: string, status: number) {
  return Response.json(ApiErrorSchema.parse({ error: { code, message, retryable: status >= 500 } }), {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const session = await lookupWalletSession(request);
  if (session instanceof Response) return session;
  const { agentId: rawId } = await context.params;
  const agentId = AgentIdSchema.safeParse(rawId);
  if (!agentId.success) return err("NOT_FOUND", "Agent not found.", 404);

  const db = await getDatabase();
  const repo = new DrizzleEconomicRepository(db);
  const ownerRow = await repo.getAgentOwnerId(agentId.data);
  if (!ownerRow || ownerRow.ownerId !== session.user.id) {
    return err("NOT_FOUND", "Agent not found.", 404);
  }

  const [account, providers, payments, tapeEvents, globalControls] = await Promise.all([
    repo.getOrCreateEconomicAccount(agentId.data, ownerRow.ownerId, { isHouseAgent: ownerRow.kind === "house" }),
    repo.listServiceProviders(),
    repo.listPaymentHistory(agentId.data, 50),
    repo.listEconomicTapeEvents(agentId.data, 100),
    repo.getGlobalControls(),
  ]);

  return Response.json(
    { account, providers, payments, tapeEvents, globalControls },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const session = await lookupWalletSession(request);
  if (session instanceof Response) return session;
  const { agentId: rawId } = await context.params;
  const agentId = AgentIdSchema.safeParse(rawId);
  if (!agentId.success) return err("NOT_FOUND", "Agent not found.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("VALIDATION_ERROR", "Invalid JSON body.", 400);
  }

  const parsed = EconomicsActionSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid economics request.", 400);
  }

  const db = await getDatabase();
  const repo = new DrizzleEconomicRepository(db);
  const ownerRow = await repo.getAgentOwnerId(agentId.data);
  if (!ownerRow || ownerRow.ownerId !== session.user.id) {
    return err("NOT_FOUND", "Agent not found.", 404);
  }

  await repo.getOrCreateEconomicAccount(agentId.data, ownerRow.ownerId, { isHouseAgent: ownerRow.kind === "house" });

  if (parsed.data.action === "fund") {
    const amountAtomic = parseUsdgToAtomic(parsed.data.amountUsdg);
    if (BigInt(amountAtomic) <= 0n) return err("VALIDATION_ERROR", "Funding amount must be positive.", 400);
    const updated = await repo.fundServiceBudget(
      session.user.id,
      agentId.data,
      amountAtomic,
      parsed.data.reason ?? `Funded ${parsed.data.amountUsdg} USDG to isolated Service Budget.`,
    );
    return Response.json({ account: updated }, { headers: { "cache-control": "no-store" } });
  }

  const updated = await repo.updateEconomicMandate(
    session.user.id,
    agentId.data,
    parsed.data.mandate,
    parsed.data.reason ?? "Updated Economic Mandate from Economics Desk.",
  );
  return Response.json({ account: updated }, { headers: { "cache-control": "no-store" } });
}
