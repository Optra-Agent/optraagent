import type { Metadata } from "next";
import { LabScreen } from "../../../components/app/lab/LabScreen";

export const metadata: Metadata = { title: "Lab" };

export default async function LabPage({ searchParams }: { searchParams: Promise<{ agent?: string | string[] }> }) {
  const params = await searchParams;
  const agentId = Array.isArray(params.agent) ? params.agent[0] ?? "" : params.agent ?? "";
  return <LabScreen initialAgentId={agentId} />;
}
