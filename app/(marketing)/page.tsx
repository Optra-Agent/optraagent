import type { Metadata } from "next";
import { PublicTapeResponseSchema, PublicVerificationSchema } from "../../lib/domain/contracts";
import { createPublicHandlers } from "../../lib/public/handlers";
import { getPublicHandlers } from "../../lib/public/runtime";
import { getLandingFacts } from "../../components/marketing/data";
import { getGraphData } from "../../components/marketing/graph-data";
import { getApiDocs, getRiskRails } from "../../components/marketing/section-data";
import { scenarioFromDecision } from "../../components/marketing/graph-flow";
import { ProtectiveFloor } from "../../components/marketing/ProtectiveFloor";
import { SignatureStage } from "../../components/marketing/SignatureStage";
import { StageRail } from "../../components/marketing/StageRail";
import { AgentShowcase, Faq, FinalCta, Hero, HeroPreview, HouseAgents, Proof, Story } from "../../components/marketing/sections";

// The ledger below reads the database-backed public records (running House Agents, Decision Tape). A statically
// prerendered page froze the build-time answer (0 agents, no decisions) behind a one-year CDN cache while Verify,
// which reads the same handlers in the browser, showed the live count. Render per request instead.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Optra Agent | No-Code Options Trading Agents" },
  description:
    "Build custom options agents with modular rules. Backtest strategies, control risk, and understand every decision. Paper trading today, with every decision recorded on Optra Tape.",
};

/**
 * The same database-backed handlers the public API routes use. `createPublicHandlers()` without a repository reports
 * zero running House Agents and an empty Tape by design (it exists for unit tests), which is exactly what the landing
 * page showed while Verify, served by the routes, showed the real count. Like the verify route, fall back to the static
 * claims only when the database cannot be opened.
 */
async function landingHandlers() {
  try {
    return await getPublicHandlers();
  } catch {
    return createPublicHandlers();
  }
}

export default async function LandingPage() {
  const facts = getLandingFacts();
  const publicHandlers = await landingHandlers();
  // The ledger renders the server's own claims, read through the same handler the public API uses.
  const verification = PublicVerificationSchema.parse(await publicHandlers.verify().then((response) => response.json()));
  const read = async (response: Promise<Response>) => (await response).json() as Promise<unknown>;
  const docs = getApiDocs({ templates: await read(publicHandlers.templates()), verify: verification, agents: await read(publicHandlers.agents()), tape: await read(publicHandlers.tape()) });
  const graph = getGraphData();
  // When the public Tape has a record, the graph can replay it. Today the public Tape is empty, so only the labeled illustrative examples show.
  const tape = PublicTapeResponseSchema.parse(await publicHandlers.tape().then((response) => response.json()));
  const recorded: Partial<Record<(typeof graph.agents)[number]["id"], ReturnType<typeof scenarioFromDecision>>> = {};
  for (const decision of tape.decisions) {
    if (decision.templateId && decision.templateId !== "custom" && !recorded[decision.templateId]) recorded[decision.templateId] = scenarioFromDecision(decision);
  }
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
