import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { PublicVerification } from "../../lib/domain/contracts";
import { AgentGraph } from "./AgentGraph";
import { ForgeDemo } from "./ForgeDemo";
import { BreakerPanel, DevDocs, EvidenceCenter, SessionsTimeline } from "./story";
import { HowWalkthrough } from "./HowWalkthrough";
import { TapeTimeline } from "./TapeTimeline";
import type { ApiDoc, ForgeDemoData, HealthGuard, RiskRail } from "./section-data";
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
            <Link className={cn(buttonVariants({ size: "lg" }))} href="/agents">Launch a paper agent</Link>
            <a className={cn(buttonVariants({ variant: "outline", size: "lg" }))} href="#floor">See the protective floor</a>
          </div>
          <p className="hero-micro">Start on paper with virtual money and no deposit. The options are synthetic and modeled. Not shares, not investment advice.</p>
        </div>
        <div className="hero-slot">
          <AgentEnsemble stages={STAGE_ORDER.map((stage) => ({ id: stage, label: stageLabel(stage), line: STAGE_QUESTION[stage] }))} />
        </div>
      </div>
      <ul className="hero-proof m-wrap" aria-label="Current scope">
        <li>Paper only. Live trading disabled</li>
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
        <h2 id="app-title">The screens you will run on paper.</h2>
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

export function HouseAgents({ facts, graph, recorded }: { facts: Facts; graph: GraphData; recorded: FlowScenario | null }) {
  return (
    <section className="m-section" id="agents" aria-labelledby="agents-title">
      <div className="m-wrap">
        <SectionHead titleId="agents-title" eyebrow="HOUSE AGENTS" title="One House Agent runs on paper today. Three are next.">
          <p>An Optra Agent is a recipe of rules, not a chatbot. Select Protective Put to see its six hook stages, read each rule, and replay how one tick becomes a paper decision. The other three stay in Preview until their venue and data requirements are verified.</p>
        </SectionHead>
        <AgentGraph data={graph} recorded={recorded} />
        <p className="graph-foot">{facts.hookLive} of {facts.hookTotal} hooks have evaluators, all used by Protective Put. Hook text and recipe values are read from the same catalog the public API serves.</p>
        <div className="m-actions">
          <Link className={buttonVariants()} href="/agents#configure">Create a Protective Put draft</Link>
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

export function Forge({ facts, forge }: { facts: Facts; forge: ForgeDemoData }) {
  return (
    <section className="m-section m-section-raised" id="forge" aria-labelledby="forge-title">
      <div className="m-wrap">
        <SectionHead titleId="forge-title" eyebrow="OPTRA FORGE" title="Click rules together. The server checks every recipe.">
          <p>An agent is a recipe of rules. Forge validates it, gives it a canonical hash, and blocks anything it cannot run, before it can reach a backtest. Try removing a hook below to see what the validator says.</p>
        </SectionHead>
        <ForgeDemo data={forge} />
        <div className="hk-strip" role="group" aria-label="Hook library by stage">
          <p className="hk-strip-head"><b>{facts.hookTotal} hooks, six stages.</b> A Breaker guards every tick and can stop new entries.</p>
          <ul>
            {facts.byStage.map((stage) => (
              <li key={stage.stage} data-risk={stage.stage === "breaker" ? "1" : "0"}>
                <span className="hk-stage mono">{stage.stage}</span>
                <span className="hk-count"><b>{stage.live}</b> of {stage.total} run today</span>
              </li>
            ))}
          </ul>
        </div>
        <ul className="forge-points reveal-stagger">
          <li style={at(0)}><strong>{facts.hookLive} of {facts.hookTotal} hooks run today.</strong> The other {facts.hookCatalogOnly} are documented in the library and locked in Forge.</li>
          <li style={at(1)}><strong>AI composition: next.</strong> Rules decide. No AI provider is configured, so recipes are built by clicking.</li>
          <li style={at(2)}><strong>Inspired by Uniswap v4 hooks.</strong> Every hook runs in the offchain paper engine. None is deployed onchain.</li>
        </ul>
        <div className="m-actions">
          <Link className={buttonVariants()} href="/forge">Open Forge</Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/hooks">Browse all {facts.hookTotal} hooks</Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── How it works ─────────────────────────── */

export function HowItWorks() {
  return (
    <section className="m-section m-section-raised" id="how" aria-labelledby="how-title">
      <div className="m-wrap">
        <SectionHead titleId="how-title" eyebrow="HOW IT WORKS" title="From idea to paper position, in four steps.">
          <p>Each step unlocks the next. The Lab replays 1,441 verified hourly candles, 721 to warm up and 720 to decide, and nothing reaches a paper run without a complete backtest. There is no real-money path.</p>
        </SectionHead>
        <HowWalkthrough />
        <p className="how-note">Each step shows the screen it leads to. The pictures are illustrative: they carry no returns, balances or trades. Live trading is disabled and every run is paper.</p>
      </div>
    </section>
  );
}

/* ─────────────────────────── Optra Tape ─────────────────────────── */

export function TapeSection({ graph }: { graph: GraphData }) {
  return (
    <section className="m-section" id="tape" aria-labelledby="tape-title">
      <div className="m-wrap tape-grid">
        <SectionHead titleId="tape-title" eyebrow="OPTRA TAPE" title="Every decision has a reason, even when the agent does nothing." className="tape-head">
          <p>Each tick the agent records what it did and why, in plain words first and rule by rule on demand. Pick a tick to see why entry was allowed or blocked.</p>
          <ul className="forge-points">
            <li><strong>Append-only.</strong> Decisions and paper orders persist per agent.</li>
            <li><strong>Private to your wallet.</strong> There is no public Tape yet, so none is shown here.</li>
          </ul>
          <div className="m-actions">
            <Link className={buttonVariants()} href="/agents">Launch a paper agent</Link>
          </div>
        </SectionHead>
        <TapeTimeline ticks={graph.ticks} stages={[...graph.stages, graph.breaker]} />
      </div>
    </section>
  );
}

/* ─────────────────────────── Sessions and risk ─────────────────────────── */

/** Paper and Live are execution modes. They are not Agent mode and Manual mode, which are about who decides. Live is shown as planned and has no control. */
function ExecutionModes() {
  const paper = ["Virtual capital", "Supported rule configuration", "Backtesting", "Paper agent launch", "Automated paper evaluation", "Explainable decisions in Optra Tape"];
  return (
    <div className="xm reveal-stagger" role="group" aria-label="Execution modes">
      <article className="xm-card" data-mode="paper" style={at(0)}>
        <header><h3>Paper Trading</h3><Chip tone="azure">Working today</Chip></header>
        <p>Run an agent against virtual capital with modeled premiums. The full path works end to end.</p>
        <ul>{paper.map((item) => <li key={item}>{item}</li>)}</ul>
        <Link className={cn(buttonVariants())} href="/agents">Launch a paper agent</Link>
      </article>
      <article className="xm-card" data-mode="live" style={at(1)}>
        <header><h3>Live Trading</h3><Chip>Planned</Chip></header>
        <p>The same agents with real wallet capital. It is a separate mode and it is not built. Nothing in Optra can place a real-money order today.</p>
        <ul>{LIVE_REQUIREMENTS.map((item) => <li key={item.title}>{item.title}</li>)}</ul>
        <Link className="xm-link" href="/verify">What Live still needs, on Verify</Link>
      </article>
    </div>
  );
}

export function Sessions({ rails, health }: { rails: RiskRail[]; health: HealthGuard }) {
  return (
    <section className="m-section" id="sessions" aria-labelledby="sessions-title">
      <div className="m-wrap">
        <SectionHead titleId="sessions-title" eyebrow="SESSIONS" title="Sessions, risk and modes.">
          <p>The Sessia hook lets an agent open new positions only during regular US equity hours on open market days. Exits are not gated by it. Five Breakers watch every tick.</p>
        </SectionHead>
        <SessionsTimeline />

        <div className="risk">
          <div className="risk-head reveal-lead">
            <p className="m-eyebrow">RISK</p>
            <h3>Breakers stop new entries. Exits keep running.</h3>
            <p>Five guards watch every tick: four numeric limits and one data-health check. Pick one to see its limit and try a value.</p>
          </div>
          <BreakerPanel rails={rails} health={health} />
        </div>

        <ExecutionModes />

        <div className="modes reveal" role="group" aria-label="Agent mode and Manual mode">
          <p><Chip tone="azure">Working on paper</Chip><b>Agent mode.</b> Rules decide, you backtest first, and every decision is written to the Tape.</p>
          <p><Chip>Planned</Chip><b>Manual mode.</b> No route or service exists yet, so nothing here lets you place an order.</p>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Developers ─────────────────────────── */

export function Developers({ docs }: { docs: ApiDoc[] }) {
  return (
    <section className="m-section" id="developers" aria-labelledby="developers-title">
      <div className="m-wrap">
        <SectionHead titleId="developers-title" eyebrow="DEVELOPERS" title="A public, read-only API you can call today.">
          <p>Five endpoints, no key, real responses below. Trading routes are private to the wallet that owns the agent. An MCP server and pay-per-call endpoints are planned and not built yet.</p>
        </SectionHead>
        <DevDocs docs={docs} />
      </div>
    </section>
  );
}

/* ─────────────────────────── Verify ─────────────────────────── */

export function Status({ verification }: { verification: PublicVerification }) {
  return (
    <section className="m-section m-section-raised" id="verify" aria-labelledby="verify-title">
      <div className="m-wrap">
        <SectionHead titleId="verify-title" eyebrow="VERIFY" title="Built, not promised.">
          <p>Every claim below comes from the server&apos;s own verification response, with the path that proves it. Rows without evidence are labeled as roadmap.</p>
          <Link className={buttonVariants({ variant: "outline" })} href="/verify">Open the Verify page</Link>
        </SectionHead>
        <EvidenceCenter verification={verification} />
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
            <p className="m-eyebrow">PAPER FIRST</p>
            <h2 id="final-title">Your first agent runs on paper.</h2>
            <p>Pick Protective Put, backtest it on past prices, launch it with virtual money, and read why it acted on the Tape. Nothing here needs a deposit or touches real money.</p>
            <div className="m-actions">
              <Link className={buttonVariants({ size: "lg" })} href="/agents">Launch a paper agent</Link>
              <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/verify">See what is verified</Link>
            </div>
            <p className="fin-note">Virtual USDG. Modeled premiums. Not investment advice.</p>
          </div>
          <span className="fin-curtain fin-curtain-l" aria-hidden="true" />
          <span className="fin-curtain fin-curtain-r" aria-hidden="true" />
          <span className="fin-valance" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
