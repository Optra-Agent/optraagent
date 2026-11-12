import type { Metadata } from "next";
import { AgentListScreen } from "../../../components/app/agents/AgentListScreen";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentListScreen />;
}
