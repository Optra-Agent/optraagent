import type { Metadata } from "next";
import { HouseAgentDetail } from "../../../../components/app/agents/HouseAgentDetail";

export const metadata: Metadata = { title: "House Agent" };

export default async function HouseAgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <HouseAgentDetail agentId={agentId} />;
}
