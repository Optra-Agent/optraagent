import { sql } from "drizzle-orm";
import { getDatabase } from "../../../../lib/db/client";
import { getProductionReadinessIssues } from "../../../../lib/ops/release-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    const issues = getProductionReadinessIssues(process.env);
    if (issues.length > 0) {
      return Response.json({ status: "not_ready", issues }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }

  try {
    await (await getDatabase()).execute(sql`select 1`);
    return Response.json({ status: "ready", checks: { database: "ok" } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({
      status: "not_ready",
      issues: ["database_unavailable"],
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
