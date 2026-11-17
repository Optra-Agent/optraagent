import type { Metadata } from "next";
import { PublicTapeResponseSchema, PublicVerificationSchema } from "../../lib/domain/contracts";
import { createPublicHandlers } from "../../lib/public/handlers";
import { getLandingFacts } from "../../components/marketing/data";
import { getGraphData } from "../../components/marketing/graph-data";
import { getApiDocs, getRiskRails } from "../../components/marketing/section-data";
import { scenarioFromDecision } from "../../components/marketing/graph-flow";
import { ProtectiveFloor } from "../../components/marketing/ProtectiveFloor";
import { SignatureStage } from "../../components/marketing/SignatureStage";
import { StageRail } from "../../components/marketing/StageRail";
import { AgentShowcase, Faq, FinalCta, Hero, HeroPreview, HouseAgents, Proof, Story } from "../../components/marketing/sections";

export const metadata: Metadata = {
  title: { absolute: "Optra Agent | No-Code Options Trading Agents" },
  description:
    "Build custom options agents with modular rules. Backtest strategies, control risk, and understand every decision. Paper trading today, with every decision recorded on Optra Tape.",
};

export default async function LandingPage() {
  const facts = getLandingFacts();
  // The ledger renders the server's own claims, read through the same handler the public API uses.
  const verification = PublicVerificationSchema.parse(await createPublicHandlers().verify().then((response) => response.json()));
  const publicHandlers = createPublicHandlers();
  const read = async (response: Promise<Response>) => (await response).json() as Promise<unknown>;
  const docs = getApiDocs({ templates: await read(publicHandlers.templates()), verify: verification, agents: await read(publicHandlers.agents()), tape: await read(publicHandlers.tape()) });
  const graph = getGraphData();
  // When the public Tape has a record, the graph can replay it. Today the public Tape is empty, so only the labeled illustrative examples show.
  const tape = PublicTapeResponseSchema.parse(await createPublicHandlers().tape().then((response) => response.json()));
  const latest = tape.decisions[0];
  const recorded = latest ? scenarioFromDecision(latest) : null;
  return (
    <>
      <SignatureStage />
      <StageRail />
      <Hero facts={facts} />
      <ProtectiveFloor />
      <HeroPreview facts={facts} />
      <HouseAgents facts={facts} graph={graph} recorded={recorded} />
      <AgentShowcase facts={facts} graph={graph} />
      <Story rails={getRiskRails()} />
      <Proof verification={verification} docs={docs} />
      <Faq facts={facts} />
      <FinalCta />
    </>
  );
}
