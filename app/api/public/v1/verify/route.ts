import { createPublicHandlers } from "../../../../../lib/public/handlers";
import { getPublicHandlers } from "../../../../../lib/public/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return await (await getPublicHandlers()).verify();
  } catch {
    // Verify stays available when the database is not: the static claims are unaffected.
    return createPublicHandlers().verify();
  }
}
