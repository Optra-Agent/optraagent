import { getPaperScheduler } from "../../../../lib/paper/runtime";
import { hasValidPaperSchedulerCredential } from "../../../../lib/paper/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret?.trim()) {
    return Response.json({
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Scheduled paper evaluation is not configured.", retryable: true },
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (!hasValidPaperSchedulerCredential(request, secret)) {
    return Response.json({
      error: { code: "UNAUTHORIZED", message: "A valid scheduler credential is required.", retryable: false },
    }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  try {
    return await (await getPaperScheduler()).run(request);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[DATABASE_URL]").slice(0, 240) : "Unknown scheduler initialization failure.";
    console.error(JSON.stringify({ event: "paper_scheduler.initialization_failed", message }));
    return Response.json({
      error: { code: "UPSTREAM_UNAVAILABLE", message: "Scheduled paper evaluation is temporarily unavailable.", retryable: true },
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
