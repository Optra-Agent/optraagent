import type { Metadata } from "next";
import { PublicTapeResponseSchema, PublicVerificationSchema } from "../../lib/domain/contracts";
import { createPublicHandlers } from "../../lib/public/handlers";
import { getLandingFacts } from "../../components/marketing/data";
import { getGraphData } from "../../components/marketing/graph-data";
import { getApiSample, getExplorerData, getForgeDemo, getRiskRails } from "../../components/marketing/section-data";
import { scenarioFromDecision } from "../../components/marketing/graph-flow";
import { Developers, DualMode, Faq, FinalCta, Forge, Hero, Hooks, HouseAgents, HowItWorks, LabSection, Sessions, Status, TapeSection } from "../../components/marketing/sections";

export const metadata: Metadata = {
  title: { absolute: "Optra Agent | Let agents trade the strike." },
  description:
    "Rule-driven options agents on Robinhood Chain. Choose a House Agent or build custom rules, backtest with modeled premiums, run on paper, and inspect every decision on Optra Tape.",
};

export default async function LandingPage() {
  const facts = getLandingFacts();
  // The ledger renders the server's own claims, read through the same handler the public API uses.
  const verification = PublicVerificationSchema.parse(await createPublicHandlers().verify().then((response) => response.json()));
  const graph = getGraphData();
  // When the public Tape has a record, the graph can replay it. Today the public Tape is empty, so only the labeled illustrative examples show.
  const tape = PublicTapeResponseSchema.parse(await createPublicHandlers().tape().then((response) => response.json()));
  const latest = tape.decisions[0];
  const recorded = latest ? scenarioFromDecision(latest) : null;
  return (
    <>
      <Hero facts={facts} />
      <HouseAgents facts={facts} graph={graph} recorded={recorded} />
      <Forge facts={facts} forge={getForgeDemo()} />
      <Hooks facts={facts} explorer={getExplorerData()} />
      <HowItWorks />
      <TapeSection graph={graph} />
      <LabSection facts={facts} />
      <Sessions rails={getRiskRails()} />
      <DualMode />
      <Developers sample={getApiSample()} />
      <Status verification={verification} />
      <Faq facts={facts} />
      <FinalCta />
    </>
  );
}
