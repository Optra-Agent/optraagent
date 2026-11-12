import { createHookHandlers } from "../../../../lib/hooks/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return createHookHandlers().validate(request);
}
