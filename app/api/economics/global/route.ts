import { getDatabase } from "../../../../lib/db/client";
import { DrizzleEconomicRepository } from "../../../../lib/economics/drizzle-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = await getDatabase();
  const repo = new DrizzleEconomicRepository(db);
  const [globalControls, providers] = await Promise.all([
    repo.getGlobalControls(),
    repo.listServiceProviders(),
  ]);
  return Response.json({ globalControls, providers }, { headers: { "cache-control": "no-store" } });
}
