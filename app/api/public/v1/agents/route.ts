import { createPublicHandlers } from "../../../../../lib/public/handlers";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return createPublicHandlers().agents();
}
