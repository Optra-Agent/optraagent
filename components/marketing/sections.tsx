import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { PublicVerification } from "../../lib/domain/contracts";
import { AgentGraph } from "./AgentGraph";
import { ForgeDemo } from "./ForgeDemo";
import { HookExplorer } from "./HookExplorer";
import { BreakerPanel, DevDocs, EvidenceCenter, LabShowcase, SessionsTimeline } from "./story";
import { Bot, Check, Circle, Hand, Lock } from "lucide-react";
import { HowWalkthrough } from "./HowWalkthrough";
import { TapeTimeline } from "./TapeTimeline";
import type { ApiDoc, ExplorerStage, ForgeDemoData, HealthGuard, RiskRail } from "./section-data";
import { ProductPreview } from "./ProductPreview";
import type { GraphData } from "./graph-data";
import type { FlowScenario } from "./graph-flow";
import { HeroStage } from "./HeroStage";
import { getLandingFacts } from "./data";

type Facts = ReturnType<typeof getLandingFacts>;

/** Stagger index for `.reveal-stagger` children. */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

function SectionHead({ eyebrow, title, children, className }: { eyebrow: string; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("section-head reveal-lead", className)}>
      <p className="m-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/* ───────────────────────────── Hero ───────────────────────────── */

export function Hero({ facts }: { facts: Facts }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="m-eyebrow">AI OPTIONS AGENTS · ROBINHOOD CHAIN</p>
        <h1 id="hero-title">Let agents trade the strike.</h1>
        <p className="hero-sub">
          Rule-driven agents trade synthetic calls and puts on Robinhood Chain. Pick a House Agent or build your own rules, backtest the strategy, run it on paper, and inspect every decision on Optra Tape.
        </p>
        <p className="hero-gloss">The strike is the price an option is struck at. Rules pick it, size it, and explain it.</p>
        <div className="hero-actions">
          <Link className={cn(buttonVariants({ size: "lg" }))} href="/agents">Launch a paper agent</Link>
          <a className={cn(buttonVariants({ variant: "outline", size: "lg" }))} href="#tape">Read the Tape</a>
        </div>
        <p className="hero-micro">Paper first. Synthetic options on stock prices. Not shares. Not investment advice.</p>
        <ul className="hero-proof" aria-label="Current scope">
          <li>Paper only. Live trading disabled</li>
          <li>{facts.paperReadyTemplates.length} of {facts.templates.length} House Agents paper ready</li>
          <li>{facts.hookLive} of {facts.hookTotal} hooks implemented</li>
          <li>Modeled premiums. Venue fees not modeled</li>
        </ul>
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
        <SectionHead eyebrow="HOUSE AGENTS" title="One House Agent runs on paper today. Three are next.">
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

/* ─────────────────────────── Forge ─────────────────────────── */

export function Forge({ facts, forge }: { facts: Facts; forge: ForgeDemoData }) {
  return (
    <section className="m-section m-section-raised" id="forge" aria-labelledby="forge-title">
      <div className="m-wrap">
        <SectionHead eyebrow="OPTRA FORGE" title="Click rules together. The server checks every recipe.">
          <p>An agent is a recipe of rules. Forge validates it, gives it a canonical hash, and blocks anything it cannot run, before it can reach a backtest. Try removing a hook below to see what the validator says.</p>
        </SectionHead>
        <ForgeDemo data={forge} />
        <ul className="forge-points reveal-stagger">
          <li style={at(0)}><strong>{facts.hookLive} of {facts.hookTotal} hooks run today.</strong> The other {facts.hookCatalogOnly} are documented in the library and locked in Forge.</li>
          <li style={at(1)}><strong>AI composition: Coming soon.</strong> Rules decide. No AI provider is configured, so recipes are built by clicking.</li>
          <li style={at(2)}><strong>Inspired by Uniswap v4 hooks.</strong> Every hook runs in the offchain paper engine. None is deployed onchain.</li>
        </ul>
        <div className="m-actions">
          <Link className={buttonVariants()} href="/forge">Open Forge</Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/hooks">Browse the hook library</Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 36 Hooks ─────────────────────────── */

export function Hooks({ facts, explorer }: { facts: Facts; explorer: ExplorerStage[] }) {
  return (
    <section className="m-section" id="hooks" aria-labelledby="hooks-title">
      <div className="m-wrap">
        <SectionHead eyebrow="THE HOOK LIBRARY" title={`${facts.hookTotal} hooks. Six stages. One agent.`}>
          <p>Every tick runs the same path: Gate, Strike, Size, Pulse, Expiry. A Breaker guards the whole path and can stop new entries at any point. Open a stage to read every hook in it, including the ones that are still locked.</p>
        </SectionHead>
        <HookExplorer stages={explorer} />
        <p className="stage-legend"><i className="cell-key is-live" /> Implemented evaluator <i className="cell-key" /> Catalog only, locked ({facts.hookCatalogOnly} hooks)</p>
        <div className="m-actions">
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
        <SectionHead eyebrow="HOW IT WORKS" title="From idea to paper position, in four steps.">
          <p>Each step unlocks the next. Nothing reaches a paper run without a complete backtest, and there is no real-money path.</p>
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
        <SectionHead eyebrow="OPTRA TAPE" title="Every decision has a reason, even when the agent does nothing." className="tape-head">
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

/* ─────────────────────────── Optra Lab ─────────────────────────── */

export function LabSection() {
  return (
    <section className="m-section m-section-raised" id="lab" aria-labelledby="lab-title">
      <div className="m-wrap">
        <SectionHead eyebrow="OPTRA LAB" title="Test the strategy before you run it.">
          <p>The Lab replays verified hourly candles through the same engine that runs paper ticks, prices synthetic options with a disclosed model, and compares the result with simply holding. If history is short or no entry happens, it shows no metrics instead of a guess.</p>
        </SectionHead>
        <LabShowcase />
      </div>
    </section>
  );
}

/* ─────────────────────────── Sessions and risk ─────────────────────────── */

export function Sessions({ rails, health }: { rails: RiskRail[]; health: HealthGuard }) {
  return (
    <section className="m-section" id="sessions" aria-labelledby="sessions-title">
      <div className="m-wrap">
        <SectionHead eyebrow="SESSIONS" title="Entries follow the market session.">
          <p>The Sessia hook lets an agent open new positions only during regular US equity hours on open market days. Exits are not gated by it. Choosing other sessions is Planned.</p>
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
      </div>
    </section>
  );
}

/* ─────────────────────────── Dual Mode ─────────────────────────── */

export function DualMode() {
  const agentPoints = ["Rules decide: a strategy of hooks, validated by the server", "Backtest first, then launch on paper", "Every decision is written to the Tape", "Pause, resume, stop or fork"];
  const manualPoints = ["Place calls and puts yourself", "Hand exits to hooks", "Agents never touch positions you opened"];
  return (
    <section className="m-section m-section-raised" id="dual" aria-labelledby="dual-title">
      <div className="m-wrap">
        <SectionHead eyebrow="DUAL MODE" title="Agent mode works today. Manual mode is next.">
          <p>One book, two ways to run it. Only Agent mode exists: there is no Floor route yet, so nothing on this page lets you place a manual order.</p>
        </SectionHead>
        <div className="dm reveal-stagger">
          <article className="dm-card dm-on" style={at(0)}>
            <div className="dm-top"><span className="dm-icon"><Bot aria-hidden /></span><Chip tone="azure">Working on paper</Chip></div>
            <h3>Agent mode</h3>
            <p className="dm-lead">A rule-driven agent does the work and explains every decision.</p>
            <ul>{agentPoints.map((point) => <li key={point}><Check aria-hidden />{point}</li>)}</ul>
            <Link className={buttonVariants({ size: "sm" })} href="/agents">Launch a paper agent</Link>
          </article>
          <article className="dm-card dm-off" style={at(1)} aria-label="Manual mode, planned">
            <div className="dm-top"><span className="dm-icon"><Hand aria-hidden /></span><Chip>Planned</Chip></div>
            <h3>Manual mode</h3>
            <p className="dm-lead">You place the order. Hooks could manage the exit.</p>
            <ul>{manualPoints.map((point) => <li key={point}><Circle aria-hidden />{point}</li>)}</ul>
            <p className="dm-none"><Lock aria-hidden />Not available. No route or service exists yet.</p>
          </article>
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
        <SectionHead eyebrow="DEVELOPERS" title="A public, read-only API you can call today.">
          <p>Five endpoints, no key, real responses below. Trading routes are private to the wallet that owns the agent. An MCP server and pay-per-call endpoints are Planned and not available.</p>
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
        <SectionHead eyebrow="VERIFY" title="Built, not promised.">
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
  ["What does the AI do?", "Nothing yet. Rules decide, and AI composition is Coming soon. Today you pick rules by clicking in Forge."],
] as const;

export function Faq({ facts }: { facts: Facts }) {
  const faq = [
    ...faqStatic,
    ["Which hooks work today?", `${facts.hookLive} of ${facts.hookTotal}, all used by Protective Put. The other ${facts.hookCatalogOnly} are documented but locked until they have verified evaluators.`],
  ];
  return (
    <section className="m-section" id="faq" aria-labelledby="faq-title">
      <div className="m-wrap faq-split">
        <SectionHead eyebrow="BEFORE YOU LAUNCH" title="Questions worth asking first." />
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
      <span className="m-final-curtain m-final-curtain-l" aria-hidden="true" />
      <span className="m-final-curtain m-final-curtain-r" aria-hidden="true" />
      <span className="m-final-edge" aria-hidden="true" />
      <div className="m-wrap m-final-inner">
        <p className="m-eyebrow">PAPER FIRST</p>
        <h2 id="final-title">Your first agent runs on paper.</h2>
        <p>Create the draft, backtest it, launch it, and read the first tick on the Tape. No deposit, no real money.</p>
        <div className="m-actions">
          <Link className={buttonVariants({ size: "lg" })} href="/agents">Launch app</Link>
          <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/verify">Inspect what is verified</Link>
        </div>
      </div>
    </section>
  );
}
