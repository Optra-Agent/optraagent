import type { Metadata } from "next";
import { getLandingFacts } from "../../components/marketing/data";
import { Faq, FinalCta, Forge, Hero, HouseAgents, HowItWorks, Status, TapeSection } from "../../components/marketing/sections";

export const metadata: Metadata = {
  title: { absolute: "Optra Agent | Let agents trade the strike." },
  description:
    "AI options agents on Robinhood Chain. Choose a House Agent or build custom rules, backtest with modeled premiums, run on paper, and read every decision on Optra Tape.",
};

export default function LandingPage() {
  const facts = getLandingFacts();
  return (
    <>
      <Hero facts={facts} />
      <HouseAgents facts={facts} />
      <Forge facts={facts} />
      <HowItWorks />
      <TapeSection />
      <Status facts={facts} />
      <Faq facts={facts} />
      <FinalCta />
    </>
  );
}
