import type { Metadata } from "next";
import { AgentListScreen } from "../../../components/app/agents/AgentListScreen";
import type { HouseTemplateId } from "../../../components/app/agents/house-meta";

export const metadata: Metadata = { title: "Agents" };

const TEMPLATES: readonly HouseTemplateId[] = ["protective_put", "covered_call", "cash_secured_put", "earnings_straddle"];

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ template?: string | string[] }> }) {
  const params = await searchParams;
  const requested = Array.isArray(params.template) ? params.template[0] : params.template;
  const initialTemplate = TEMPLATES.find((id) => id === requested) ?? "protective_put";
  return <AgentListScreen initialTemplate={initialTemplate} />;
}
