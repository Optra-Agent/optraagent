import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agents } from "../../../../../db/schema";
import { getDatabase } from "../../../../../lib/db/client";
import { DrizzleEconomicRepository } from "../../../../../lib/economics/drizzle-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AgentIdSchema = z.uuid();

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }): Promise<Response> {
  const { agentId: rawId } = await context.params;
  const agentId = AgentIdSchema.safeParse(rawId);
  if (!agentId.success) {
    return Response.json({ error: { code: "NOT_FOUND", message: "House agent not found.", retryable: false } }, { status: 404 });
  }

  const db = await getDatabase();
  const [houseAgent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, kind: agents.kind, visibility: agents.visibility })
    .from(agents)
    .where(and(eq(agents.id, agentId.data), eq(agents.kind, "house"), eq(agents.visibility, "public")))
    .limit(1);

  if (!houseAgent) {
    return Response.json({ error: { code: "NOT_FOUND", message: "House agent not found.", retryable: false } }, { status: 404 });
  }

  const repo = new DrizzleEconomicRepository(db);
  const [account, providers, payments, tapeEvents, globalControls] = await Promise.all([
    repo.getOrCreateEconomicAccount(houseAgent.id, houseAgent.ownerId, { isHouseAgent: true }),
    repo.listServiceProviders(),
    repo.listPaymentHistory(houseAgent.id, 50),
    repo.listEconomicTapeEvents(houseAgent.id, 100),
    repo.getGlobalControls(),
  ]);

  return Response.json(
    { account, providers, payments, tapeEvents, globalControls },
    { headers: { "cache-control": "no-store" } },
  );
}
