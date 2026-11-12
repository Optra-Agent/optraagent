import { createHookHandlers } from "../../../lib/hooks/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return createHookHandlers().list();
}
