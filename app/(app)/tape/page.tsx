import { TapeScreen } from "../../../components/app/tape/TapeScreen";

export default async function TapePage({ searchParams }: { searchParams: Promise<{ agentId?: string | string[] }> }) {
  const params = await searchParams;
  const agentId = Array.isArray(params.agentId) ? params.agentId[0] ?? "" : params.agentId ?? "";
  return <TapeScreen agentId={agentId} />;
}
