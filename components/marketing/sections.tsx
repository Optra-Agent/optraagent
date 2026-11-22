import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { PublicVerification } from "../../lib/domain/contracts";
import { AgentGraph } from "./AgentGraph";
import { StoryScene } from "./StoryScene";
import type { ApiDoc, RiskRail } from "./section-data";
import { ProductPreview } from "./ProductPreview";
import type { GraphData } from "./graph-data";
import type { FlowScenario } from "./graph-flow";
import { HeroStage } from "./HeroStage";
import { AgentPhones } from "./AgentPhones";
import { AgentEnsemble } from "./AgentEnsemble";
import { FinaleCast } from "./FinaleCast";
import { LIVE_REQUIREMENTS } from "../app/live-requirements";
import { STAGE_ORDER, STAGE_QUESTION, getLandingFacts, stageLabel } from "./data";

type Facts = ReturnType<typeof getLandingFacts>;

/** Stagger index for `.reveal-stagger` children. */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

function SectionHead({ eyebrow, title, titleId, children, className }: { eyebrow: string; title: string; titleId?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("section-head reveal-lead", className)}>
      <p className="m-eyebrow">{eyebrow}</p>
      <h2 id={titleId}>{title}</h2>
      {children}
    </div>
  );
}

/* ───────────────────────────── Hero ───────────────────────────── */

export function Hero({ facts }: { facts: Facts }) {
  return (
    <section className="hero" id="intro" aria-labelledby="hero-title">
      <div className="m-wrap hero-grid">
        <div className="hero-copy">
          <p className="m-eyebrow">BUILD · DEPLOY · CONTROL</p>
          <h1 id="hero-title">No-Code Options Trading Agents.</h1>
          <p className="hero-sub">
            Build custom options agents with modular rules. Backtest strategies, control risk, and understand every decision.
          </p>
          <p className="hero-gloss">Hooked agents. Every strike explained.</p>
          <div className="hero-actions">
            <Link className={cn(buttonVariants({ size: "lg" }))} href="/agents">Launch an agent</Link>
            <a className={cn(buttonVariants({ variant: "outline", size: "lg" }))} href="#floor">See the protective floor</a>
          </div>
          <p className="hero-micro">No deposit needed. Options are synthetic and modeled from Robinhood Chain stock-token prices. Not shares, not investment advice.</p>
        </div>
        <div className="hero-slot">
          <AgentEnsemble stages={STAGE_ORDER.map((stage) => ({ id: stage, label: stageLabel(stage), line: STAGE_QUESTION[stage] }))} />
        </div>
      </div>
      <ul className="hero-proof m-wrap" aria-label="Current scope">
        <li>Every decision recorded on Optra Tape</li>
        <li>{facts.paperReadyTemplates.length} of {facts.templates.length} House Agents paper ready</li>
        <li>{facts.hookLive} of {facts.hookTotal} hooks implemented</li>
        <li>Modeled premiums. Venue fees not modeled</li>
      </ul>
    </section>
  );
}

/** The real app, read only, under the beam. It sits right after the hero so the first screen stays about one idea. */
export function HeroPreview({ facts }: { facts: Facts }) {
  return (
    <section className="hero-preview" id="app" aria-labelledby="app-title">
      <div className="pv-lead">
        <p className="m-eyebrow">INSIDE THE APP</p>
        <h2 id="app-title">The screens you will run.</h2>
        <p>Same sidebar, same journey, same House Agent cards. Read only here, live in the app.</p>
      </div>
      <HeroStage>
        <ProductPreview facts={facts} />
      </HeroStage>
      <p className="hero-caption">Interactive preview of the real app, read only. Nothing here connects a wallet or runs a backtest. Availability and counts come from the live hook and template catalog.</p>
    </section>
  );
}

/* ───────────────────────── House Agents: the Intelligence Graph ───────────────────────── */

export function HouseAgents({ facts, graph, recorded }: { facts: Facts; graph: GraphData; recorded: Partial<Record<GraphData["agents"][number]["id"], FlowScenario | null>> }) {
  return (
    <section className="m-section" id="agents" aria-labelledby="agents-title">
      <div className="m-wrap">
        <SectionHead titleId="agents-title" eyebrow="HOUSE AGENTS" title="Four House Agents. Watch one work.">
          <p>An Optra Agent is a recipe of rules, not a chatbot. The walkthrough below starts on its own: it grows one agent into its six hook stages and plays how a tick becomes a decision, then moves to the next. Select any agent to watch it, or any stage or hook to read the rule. Every agent runs on paper with modeled premiums.</p>
        </SectionHead>
        <AgentGraph data={graph} recorded={recorded} />
        <p className="graph-foot">{facts.hookLive} of {facts.hookTotal} hooks have evaluators, and the four House Agents use them. Hook text and recipe values are read from the same catalog the public API serves. The walkthrough is a presentation: it never signs, trades or activates anything.</p>
        <div className="m-actions">
          <Link className={buttonVariants()} href="/agents#configure">Create a paper agent</Link>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── The agent, in three screens ───────────────────────── */

export function AgentShowcase({ facts, graph }: { facts: Facts; graph: GraphData }) {
  return (
    <section className="m-section m-section-clean" id="studio" aria-labelledby="studio-title">
      <div className="m-wrap">
        <SectionHead titleId="studio-title" eyebrow="THE AGENT" title="Rules in. A reason out.">
          <p>An OPTRA agent is a recipe of rules you can read, a backtest you can check, and a decision log that explains every tick, even the ticks where it does nothing.</p>
        </SectionHead>
        <AgentPhones facts={facts} ticks={graph.ticks} />
      </div>
    </section>
  );
}

/* ─────────────────────────── Forge ─────────────────────────── */

/* ─────────────────────────── The story: rules to a reasoned decision ─────────────────────────── */

export function Story({ rails }: { rails: RiskRail[] }) {
  return (
    <section className="m-section" id="story" aria-labelledby="story-title">
      <div className="m-wrap">
        <SectionHead titleId="story-title" eyebrow="HOW IT WORKS" title="From rules to a reasoned decision.">
          <p>One agent, four steps. Build Protective Put from rules, backtest it, run it as a simulation, then read why it acted. Execution is simulated with virtual capital and modeled premiums.</p>
        </SectionHead>
        <StoryScene stages={STAGE_ORDER.map((stage) => ({ id: stage, label: stageLabel(stage), line: STAGE_QUESTION[stage] }))} rails={rails} />
      </div>
    </section>
  );
}

/* ─────────────────────────── Proof ─────────────────────────── */

/** Keep paper, manual venue actions, and autonomous execution as separate capabilities. */
function ExecutionModes() {
  const paper = ["Virtual capital", "Supported rule configuration", "Backtesting", "Agent launch", "Automated evaluation", "Explainable decisions in Optra Tape"];
  return (
    <div className="xm reveal-stagger" role="group" aria-label="Execution modes">
      <article className="xm-card" data-mode="paper" style={at(0)}>
        <header><h3>Paper Trading</h3><Chip tone="azure">Working today</Chip></header>
        <p>Run an agent against virtual capital with modeled premiums. The full path works end to end.</p>
        <ul>{paper.map((item) => <li key={item}>{item}</li>)}</ul>
        <Link className={cn(buttonVariants())} href="/agents">Launch an agent</Link>
      </article>
      <article className="xm-card" data-mode="live" style={at(1)}>
        <header><h3>Manual CallPut</h3><Chip tone="neutral">Wallet-signed</Chip></header>
        <p>Direct-wallet CallPut spread orders are quoted, reviewed and signed in your own wallet, one transaction at a time. Close and settle are available on the same terms, each with its own review and wallet confirmation. They passed 23 of 23 checks against the real contracts on a Mainnet fork. OPTRA has not yet verified a live open, close or settle.</p>
        <p><strong>Autonomous agents</strong> <Chip tone="ember">Unavailable</Chip></p>
        <p>OPTRA agents do not submit CallPut requests. No owner-specific automation grant or connected order worker exists.</p>
        <p>Before agent-initiated orders:</p>
        <ul>{LIVE_REQUIREMENTS.map((item) => <li key={item.title}>{item.title}</li>)}</ul>
        <Link className="xm-link" href="/verify">What autonomous trading still needs</Link>
      </article>
    </div>
  );
}

const CLAIM_TITLE: Record<string, string> = { market_data: "Market data", hook_catalog: "Hook catalog", house_agents: "House Agents", historical_backtest: "Historical backtest", live_execution: "Live execution", v4_claim_level: "Uniswap v4 claim level" };
const CLAIM_LABEL: Record<string, string> = { verified: "Verified", limited: "Limited", preview: "Preview", unavailable: "Unavailable", disabled: "Disabled" };

/** What is built and what is not, read from the server's own verification response. One real public call sits beside it. */
export function Proof({ verification, docs }: { verification: PublicVerification; docs: ApiDoc[] }) {
  const sample = docs.find((doc) => doc.id === "hooks") ?? docs[0];
  return (
    <section className="m-section" id="proof" aria-labelledby="proof-title">
      <div className="m-wrap">
        <SectionHead titleId="proof-title" eyebrow="PROOF" title="Built, not promised.">
          <p>Each claim below is read from the server&apos;s own verification response, with the path that proves it. Anything without evidence is labeled as roadmap.</p>
        </SectionHead>
        <div className="pf">
          <ul className="pf-claims" aria-label="Claims from the server">
            {verification.claims.map((claim) => (
              <li key={claim.id} data-status={claim.status}>
                <div className="pf-head"><b>{CLAIM_TITLE[claim.id] ?? claim.id.replaceAll("_", " ")}</b><Chip tone={claim.status === "verified" ? "azure" : claim.status === "limited" || claim.status === "preview" ? "neutral" : "ember"}>{CLAIM_LABEL[claim.status] ?? claim.status}</Chip></div>
                <p>{claim.statement}</p>
                <a className="mono" href={claim.evidencePath} target="_blank" rel="noreferrer">Evidence: {claim.evidencePath}</a>
              </li>
            ))}
          </ul>
          <aside className="pf-api" aria-label="Public API">
            <p className="pf-kicker mono">PUBLIC API · READ ONLY</p>
            <h3>Call it yourself. No key.</h3>
            <p>Five public endpoints return the same data this page shows. Trading routes stay private to the wallet that owns the agent. An MCP server and pay-per-call endpoints are planned, not built.</p>
            {sample ? <pre className="pf-code mono" aria-label={`Example request for ${sample.title}`}>{`curl -s "$OPTRA_URL${sample.path}"`}</pre> : null}
            <ul className="pf-endpoints mono">{docs.map((doc) => <li key={doc.id}><a href={doc.path} target="_blank" rel="noreferrer">GET {doc.path}</a></li>)}</ul>
            <Link className={buttonVariants({ variant: "outline" })} href="/verify">Open the Verify page</Link>
          </aside>
        </div>
        <ExecutionModes />
      </div>
    </section>
  );
}

/* ─────────────────────────── FAQ and final CTA ─────────────────────────── */

const faqStatic = [
  ["Is this real money?", "No. Everything runs on paper with virtual USDG. Live execution is disabled in this build, and no deposit is requested."],
  ["What are synthetic options?", "Calls and puts priced from Robinhood Chain stock-token prices. They are not shares, and they are not tokenized stock ownership."],
  ["What is a modeled premium?", "A theoretical Black–Scholes price, using 30-day realized volatility × 1.1. It is not a recorded option quote, a listed contract or a real fill, and venue fees are not included."],
  ["Why does a backtest need 1,441 candles?", "721 hourly candles warm up the volatility estimate and 720 candles are decisions. Gaps or a missing corporate-action check block the run instead of filling in data."],
  ["What does the AI do?", "Nothing yet. Rules decide, and AI composition is the next step. Today you pick rules by clicking in Forge."],
] as const;

export function Faq({ facts }: { facts: Facts }) {
  const faq = [
    ...faqStatic,
    ["Which hooks work today?", `${facts.hookLive} of ${facts.hookTotal}, all used by Protective Put. The other ${facts.hookCatalogOnly} are documented but locked until they have verified evaluators.`],
  ];
  return (
    <section className="m-section" id="faq" aria-labelledby="faq-title">
      <div className="m-wrap faq-split">
        <SectionHead titleId="faq-title" eyebrow="BEFORE YOU LAUNCH" title="Questions worth asking first." />
        <div className="faq-list reveal">
          {faq.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="m-final" aria-labelledby="final-title">
      <div className="fin-track">
        <div className="fin-pin">
          <span className="fin-light" aria-hidden="true" />
          <FinaleCast />
          <span className="fin-floor" aria-hidden="true" />
          <div className="m-wrap m-final-inner">
            <p className="m-eyebrow">START HERE</p>
            <h2 id="final-title">Launch your first agent.</h2>
            <p>Pick Protective Put, backtest it on past prices, launch it with virtual money, and read why it acted on the Tape. Nothing here needs a deposit or touches real money.</p>
            <div className="m-actions">
              <Link className={buttonVariants({ size: "lg" })} href="/agents">Launch an agent</Link>
              <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/verify">See what is verified</Link>
            </div>
            <p className="fin-note">Modeled premiums. Not investment advice.</p>
          </div>
          <span className="fin-curtain fin-curtain-l" aria-hidden="true" />
          <span className="fin-curtain fin-curtain-r" aria-hidden="true" />
          <span className="fin-valance" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
