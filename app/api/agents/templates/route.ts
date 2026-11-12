import { HouseAgentTemplateCatalogResponseSchema } from "../../../../lib/domain/contracts";
import { getHouseAgentTemplates } from "../../../../lib/hooks/catalog";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(HouseAgentTemplateCatalogResponseSchema.parse(getHouseAgentTemplates()), {
    headers: { "cache-control": "no-store" },
  });
}
