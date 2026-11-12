import type { Metadata } from "next";
import { AgentDetailScreen } from "../../../../components/app/agents/AgentDetailScreen";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentDetailScreen agentId={agentId} />;
}
