import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import type { PublicVerification } from "../../lib/domain/contracts";
import { AgentGraph } from "./AgentGraph";
import { ForgeDemo } from "./ForgeDemo";
import { HookExplorer } from "./HookExplorer";
import { TapeTimeline } from "./TapeTimeline";
import type { ExplorerStage, ForgeDemoData, RiskRail } from "./section-data";
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
        <ol className="how-flow reveal-stagger">
          <li style={at(0)}>
            <span className="how-num mono">1</span>
            <h3>Configure a strategy</h3>
            <p>Pick Protective Put and set the underlying, virtual reference shares and paper capital.</p>
            <div className="mini mini-form" aria-hidden="true">
              <span>Underlying</span><i />
              <span>Virtual reference shares</span><i />
              <span>Paper capital (USD)</span><i />
            </div>
          </li>
          <li style={at(1)}>
            <span className="how-num mono">2</span>
            <h3>Backtest its rules</h3>
            <p>Replay closed hourly candles through the same engine. Premiums are modeled, not recorded.</p>
            <div className="mini" aria-hidden="true">
              <div className="mini-bar"><i style={{ flexGrow: 721 }} /><i className="is-decisions" style={{ flexGrow: 720 }} /></div>
              <div className="mini-bar-labels mono"><span>721 warmup</span><span>720 decisions</span></div>
            </div>
          </li>
          <li style={at(2)}>
            <span className="how-num mono">3</span>
            <h3>Run on paper</h3>
            <p>Launch attaches the exact backtest. A paper tick evaluates every rule on the latest closed candle.</p>
            <div className="mini mini-run" aria-hidden="true">
              <Chip tone="ember">PAPER</Chip>
              <span className="mini-btn">Run paper tick</span>
            </div>
          </li>
          <li style={at(3)}>
            <span className="how-num mono">4</span>
            <h3>Inspect every decision</h3>
            <p>The Tape records each rule&apos;s verdict, the data it used, and the decision, including holds.</p>
            <div className="mini mini-trace mono" aria-hidden="true">
              <span><b className="v-pass">pass</b> Sessia</span>
              <span><b className="v-block">block</b> Calmo</span>
              <span><b className="v-hold">hold</b> decision</span>
            </div>
          </li>
        </ol>
        <p className="how-note">Illustrative interface fragments. Live trading is disabled: every run is paper.</p>
        <div className="m-actions">
          <Link className={buttonVariants()} href="/agents">Launch a paper agent</Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Optra Tape ─────────────────────────── */

export function TapeSection({ graph }: { graph: GraphData }) {
  return (
    <section className="m-section" id="tape" aria-labelledby="tape-title">
      <div className="m-wrap tape-grid">
        <SectionHead eyebrow="OPTRA TAPE" title="Every decision is written down, including the ones to wait." className="tape-head">
          <p>Each tick the agent records what it did and why: which rule passed or blocked, on what data, under which recipe hash. Skips and holds are entries, not gaps.</p>
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

export function LabSection({ facts }: { facts: Facts }) {
  const recipeHooks = facts.recipeStages.flatMap((entry) => entry.hooks);
  const line = (id: string) => recipeHooks.find((hook) => hook.id === id)?.line ?? "";
  return (
    <section className="m-section m-section-raised" id="lab" aria-labelledby="lab-title">
      <div className="m-wrap">
        <SectionHead eyebrow="OPTRA LAB" title="Backtests that show only what the data supports.">
          <p>The Lab replays real hourly candles through the same engine. If history is short, gapped, or produces no entry, it shows no metrics at all instead of a guess.</p>
          <Link className={buttonVariants({ variant: "outline" })} href="/lab">Open the Lab</Link>
        </SectionHead>
        <ol className="lp reveal-stagger" aria-label="How a backtest runs">
          <li className="lp-col lp-in" style={at(0)}>
            <p className="lp-n mono">1 · Inputs</p>
            <h3>Verified historical candles</h3>
            <div className="lp-strip" aria-hidden="true">
              <i className="lp-warm" style={{ flexGrow: 721 }} />
              <i className="lp-dec" style={{ flexGrow: 720 }} />
              <b className="lp-fill" />
            </div>
            <div className="lp-labels mono"><span>721 warmup</span><span>720 decisions</span></div>
            <p className="lp-copy">1,441 consecutive closed hourly candles. Gaps or a missing corporate-action check block the run.</p>
            <Chip tone="azure">Source-backed</Chip>
          </li>
          <li className="lp-col lp-in" style={at(1)}>
            <p className="lp-n mono">2 · Premiums</p>
            <h3>Modeled option premium</h3>
            <dl className="lp-model">
              <div><dt>Strike</dt><dd>{line("percy")}</dd></div>
              <div><dt>Expiry</dt><dd>{line("tenora")}</dd></div>
              <div><dt>Volatility</dt><dd>30-day realized × 1.1</dd></div>
              <div><dt>Slippage</dt><dd className="mono">50 bp</dd></div>
              <div><dt>Venue fees</dt><dd>Not modeled</dd></div>
            </dl>
            <Chip tone="ember">Modeled, not quoted</Chip>
          </li>
          <li className="lp-col lp-in" style={at(2)}>
            <p className="lp-n mono">3 · Rules</p>
            <h3>Every hook on every candle</h3>
            <div className="lp-cells" aria-hidden="true">
              {Array.from({ length: recipeHooks.length }, (_, index) => <i key={index} style={at(index)} />)}
            </div>
            <p className="lp-copy">{recipeHooks.length} hooks evaluate each of the 720 decision candles. The result is open, hold, close or skip, as on a paper tick.</p>
            <Chip>Same engine as paper</Chip>
          </li>
          <li className="lp-col lp-out" style={at(3)}>
            <p className="lp-n mono">4 · Results</p>
            <h3>Appear after a complete run</h3>
            <div className="lab-slots">
              <div><span>Total return</span><i /></div>
              <div><span>Maximum drawdown</span><i /></div>
              <div><span>Ending cash</span><i /></div>
            </div>
            <p className="lp-copy">Comparison with holding the stock</p>
            <Chip>Not yet available</Chip>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ─────────────────────────── Sessions ─────────────────────────── */

const sessionBands = [
  { name: "Overnight", hours: 4, on: false },
  { name: "Pre-market", hours: 5.5, on: false },
  { name: "Regular hours", hours: 6.5, on: true },
  { name: "After-hours", hours: 4, on: false },
  { name: "Overnight", hours: 4, on: false },
] as const;

export function Sessions({ rails }: { rails: RiskRail[] }) {
  return (
    <section className="m-section" id="sessions" aria-labelledby="sessions-title">
      <div className="m-wrap">
        <SectionHead eyebrow="SESSIONS" title="Entries follow the market session.">
          <p>The Sessia hook allows entries only during regular US equity hours on open market days, in the America/New_York time zone, with holidays and early closes. Exits are not gated by it. Choosing Opening Bell or Closing Bell sessions is Planned.</p>
        </SectionHead>
        <div className="session-line reveal" role="img" aria-label="A 24 hour US trading day in Eastern Time. Entries are allowed only from 09:30 to 16:00, regular hours.">
          <div className="session-bands">
            {sessionBands.map((band, index) => (
              <div key={`${band.name}-${index}`} className={band.on ? "session-band is-on" : "session-band"} style={{ flexGrow: band.hours }}>
                <span>{band.name}</span>
                <b className="mono">{band.on ? "Entries allowed" : "Entries blocked"}</b>
              </div>
            ))}
          </div>
          <div className="session-axis mono" aria-hidden="true">
            {([["00:00", 0], ["04:00", 4], ["09:30", 9.5], ["16:00", 16], ["20:00", 20], ["24:00 ET", 24]] as const).map(([label, hour]) => <span key={label} style={{ "--at": `${(hour / 24) * 100}%` } as CSSProperties}>{label}</span>)}
          </div>
        </div>
        <p className="how-note">Standard US session hours in Eastern Time. Sessia is implemented; other session choices are not selectable yet.</p>

        <div className="risk">
          <div className="risk-head reveal-lead">
            <p className="m-eyebrow">RISK</p>
            <h3>Breakers stop new entries. Exits keep running.</h3>
            <p>Four of the five Breakers watch a number. Each rail runs from zero to the largest value Forge allows, and the marker is the Protective Put default. Venux, the fifth, checks that data and the premium model are healthy.</p>
          </div>
          <ul className="risk-rails reveal-stagger">
            {rails.map((rail, index) => (
              <li key={rail.id} style={at(index)} className="risk-rail">
                <div className="risk-rail-top"><span className="risk-hook mono">{rail.name}</span><span className="risk-label">{rail.label}</span><b className="mono">Stops entries at {rail.value}{rail.unit}</b></div>
                <div className="risk-track" role="img" aria-label={`${rail.label}: new entries stop at ${rail.value}${rail.unit}. Scale 0 to ${rail.max}${rail.unit}.`}>
                  <i className="risk-ok" style={{ width: `${(rail.value / rail.max) * 100}%` }} />
                  <i className="risk-stop" />
                  <b className="risk-mark mono" style={{ left: `${(rail.value / rail.max) * 100}%` }}>{rail.value}{rail.unit}</b>
                </div>
                <div className="risk-scale mono" aria-hidden="true"><span>0</span><span>{rail.max}{rail.unit}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Dual Mode ─────────────────────────── */

export function DualMode() {
  return (
    <section className="m-section m-section-raised" id="dual" aria-labelledby="dual-title">
      <div className="m-wrap">
        <SectionHead eyebrow="DUAL MODE" title="Two modes. One book. One is live on paper.">
          <p>Agent mode is built. Manual control is Planned: there is no Floor route yet, so nothing on this page implies you can place a manual order today.</p>
        </SectionHead>
        <div className="control-switch reveal" role="group" aria-label="Who controls a position">
          <span className="control-seg" aria-disabled="true">You <small>Planned</small></span>
          <span className="control-seg" aria-disabled="true">You + Hook <small>Planned</small></span>
          <span className="control-seg is-on" aria-current="true">Agent <small>Working on paper</small></span>
        </div>
        <div className="dual-grid reveal-stagger">
          <article className="dual-card lift is-on" style={at(0)}>
            <div className="lab-row-head"><h3>Agent mode</h3><Chip tone="azure">Working on paper</Chip></div>
            <ul>
              <li>Rules decide. Each decision is written to the Tape.</li>
              <li>Backtest first, then launch on paper.</li>
              <li>Pause, resume, stop or fork from the agent page.</li>
            </ul>
          </article>
          <article className="dual-card dual-card-off lift" style={at(1)}>
            <div className="lab-row-head"><h3>Manual Floor</h3><Chip>Planned</Chip></div>
            <ul>
              <li>You would place calls and puts yourself.</li>
              <li>You could hand exits to hooks.</li>
              <li>Agents would never touch positions you opened.</li>
            </ul>
            <p className="dual-note">No route or service exists yet.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Developers ─────────────────────────── */

const endpoints = [
  { path: "/api/public/v1/hooks", detail: "All hook definitions with implemented or catalog-only status", status: "Working", tone: "azure" },
  { path: "/api/public/v1/templates", detail: "House Agent templates and paper-ready status", status: "Working", tone: "azure" },
  { path: "/api/public/v1/verify", detail: "Capability claims with evidence paths", status: "Working", tone: "azure" },
  { path: "/api/public/v1/agents", detail: "Public agents. Empty: there is no public visibility model yet", status: "Empty", tone: "neutral" },
  { path: "/api/public/v1/tape", detail: "Public decisions. Empty for the same reason", status: "Empty", tone: "neutral" },
] as const;

export function Developers({ sample }: { sample: string }) {
  return (
    <section className="m-section" id="developers" aria-labelledby="developers-title">
      <div className="m-wrap dev-grid">
        <SectionHead eyebrow="DEVELOPERS" title="Read-only public API today." className="dev-head">
          <p>Capability data is open to any client. Trading routes are private to the wallet that owns the agent. An MCP server and pay-per-call endpoints are Planned and not available.</p>
        </SectionHead>
        <div className="dev-panel reveal">
          <ul className="endpoint-list">
            {endpoints.map((endpoint) => (
              <li key={endpoint.path}>
                <span className="method mono">GET</span>
                <a className="endpoint-path mono" href={endpoint.path} target="_blank" rel="noreferrer">{endpoint.path}</a>
                <span className="endpoint-detail">{endpoint.detail}</span>
                <Chip tone={endpoint.tone as Tone}>{endpoint.status}</Chip>
              </li>
            ))}
            <li className="is-off"><span className="method mono">MCP</span><span className="endpoint-path mono">MCP server</span><span className="endpoint-detail">Agent tools over the Model Context Protocol</span><Chip>Planned</Chip></li>
            <li className="is-off"><span className="method mono">x402</span><span className="endpoint-path mono">Pay-per-call endpoints</span><span className="endpoint-detail">Metered access in USDG</span><Chip>Planned</Chip></li>
          </ul>
          <div className="api-sample">
            <p className="api-sample-head mono"><span>GET /api/public/v1/hooks</span><span>Response excerpt</span></p>
            <pre tabIndex={0} aria-label="Response excerpt from the hooks endpoint"><code>{sample}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Verify ledger ─────────────────────────── */

const claimTitle: Record<string, string> = {
  market_data: "Market data",
  hook_catalog: "Hook catalog",
  house_agents: "House Agents",
  historical_backtest: "Historical backtest",
  live_execution: "Live execution",
  v4_claim_level: "Uniswap v4 claim level",
};
const claimStatus: Record<string, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "azure" },
  limited: { label: "Limited", tone: "neutral" },
  preview: { label: "Preview", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "ember" },
  disabled: { label: "Disabled", tone: "ember" },
};

export function Status({ verification }: { verification: PublicVerification }) {
  const planned: { name: string; label: string; tone: Tone; note: string }[] = [
    { name: "Other House Agents", label: "Preview", tone: "neutral", note: "Covered Call, Cash-Secured Put and Earnings Straddle cannot be created yet." },
    { name: "AI composition", label: "Coming soon", tone: "neutral", note: "No AI provider is configured." },
    { name: "Session choices, Listing, Floor, MCP, x402", label: "Planned", tone: "neutral", note: "Roadmap only. No route or service yet." },
  ];
  return (
    <section className="m-section m-section-raised" id="verify" aria-labelledby="verify-title">
      <div className="m-wrap verify-grid">
        <SectionHead eyebrow="VERIFY" title="Built, not promised." className="verify-head">
          <p>Each row below is a claim the server makes about itself, with the path that proves it. Rows without evidence are labeled as roadmap.</p>
          <Link className={buttonVariants({ variant: "outline" })} href="/verify">Open the Verify page</Link>
        </SectionHead>
        <div className="ledger reveal">
          <table className="status-table">
            <caption className="sr-only">Capability status</caption>
            <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">What the server says</th></tr></thead>
            <tbody>
              {verification.claims.map((claim) => {
                const meta = claimStatus[claim.status] ?? { label: claim.status, tone: "neutral" as Tone };
                return (
                  <tr key={claim.id}>
                    <th scope="row">{claimTitle[claim.id] ?? claim.id.replaceAll("_", " ")}</th>
                    <td><Chip tone={meta.tone}>{meta.label}</Chip></td>
                    <td>{claim.statement} <a className="evidence mono" href={claim.evidencePath} target="_blank" rel="noreferrer">{claim.evidencePath}</a></td>
                  </tr>
                );
              })}
              {planned.map((row) => (
                <tr key={row.name} className="is-roadmap">
                  <th scope="row">{row.name}</th>
                  <td><Chip tone={row.tone}>{row.label}</Chip></td>
                  <td>{row.note} <span className="evidence mono">No evidence yet</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ledger-foot mono">Live trading {verification.liveTradingEnabled ? "enabled" : "disabled"} · Uniswap v4 claim level {verification.v4ClaimLevel}</p>
        </div>
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
      <div className="m-wrap reveal">
        <h2 id="final-title">Your first agent runs on paper.</h2>
        <p>Create the draft, backtest it, launch it, and read the first tick on the Tape. No deposit, no real money.</p>
        <div className="m-actions">
          <Link className={buttonVariants({ size: "lg" })} href="/agents">Launch a paper agent</Link>
          <Link className={buttonVariants({ variant: "outline", size: "lg" })} href="/hooks">Read the rules first</Link>
        </div>
      </div>
    </section>
  );
}
