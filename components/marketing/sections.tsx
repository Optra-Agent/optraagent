import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import type { PublicVerification } from "../../lib/domain/contracts";
import { AgentGraph } from "./AgentGraph";
import { AppPreview } from "./AppPreview";
import type { GraphData } from "./graph-data";
import type { FlowScenario } from "./graph-flow";
import { HeroStage } from "./HeroStage";
import { getLandingFacts, STAGE_QUESTION, stageLabel } from "./data";

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

function Cells({ live, total }: { live: number; total: number }) {
  return (
    <span className="cells" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => <i key={index} className={index < live ? "is-live" : ""} />)}
    </span>
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
        <AppPreview facts={facts} />
      </HeroStage>
      <p className="hero-caption">Read-only preview of the Agents screen inside the app. Availability and counts come from the live hook and template catalog.</p>
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

export function Forge({ facts }: { facts: Facts }) {
  return (
    <section className="m-section m-section-raised" id="forge" aria-labelledby="forge-title">
      <div className="m-wrap">
        <SectionHead eyebrow="OPTRA FORGE" title="Click rules together. The server checks every recipe.">
          <p>An agent is a recipe of rules. Forge validates it, gives it a canonical hash, and blocks anything it cannot run, before it can reach a backtest.</p>
        </SectionHead>
        <ol className="flow flow-4 reveal-stagger" aria-label="Forge workflow">
          <li className="flow-node" style={at(0)}>
            <div className="flow-head"><span className="flow-step mono">1</span><h3>Describe or click</h3></div>
            <div className="flow-body">
              <div className="flow-option flow-option-off"><span>Describe a strategy in words</span><Chip>Coming soon</Chip></div>
              <div className="flow-option flow-option-on"><span>Click rules together</span><Chip tone="azure">Working</Chip></div>
            </div>
          </li>
          <li className="flow-node" style={at(1)}>
            <div className="flow-head"><span className="flow-step mono">2</span><h3>Pick hooks</h3></div>
            <div className="flow-body">
              <ul className="flow-chips">
                {facts.byStage.map((row) => <li key={row.stage}>{stageLabel(row.stage)} <span className="mono">{row.live}</span></li>)}
              </ul>
              <p className="flow-note">{facts.hookLive} of {facts.hookTotal} hooks are selectable. The rest are locked.</p>
            </div>
          </li>
          <li className="flow-node" style={at(2)}>
            <div className="flow-head"><span className="flow-step mono">3</span><h3>Validated recipe</h3></div>
            <div className="flow-body">
              <div className="flow-hash mono">sha256:<i /></div>
              <p className="flow-note">The canonical hash appears once the server validates. Unsupported recipes are blocked with a reason.</p>
            </div>
          </li>
          <li className="flow-node" style={at(3)}>
            <div className="flow-head"><span className="flow-step mono">4</span><h3>Backtest</h3></div>
            <div className="flow-body">
              <div className="flow-option flow-option-on"><span>Replay in Lab</span><Chip tone="ember">Modeled premiums</Chip></div>
              <p className="flow-note">Needs 1,441 consecutive closed hourly candles.</p>
            </div>
          </li>
        </ol>
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

export function Hooks({ facts }: { facts: Facts }) {
  const main = facts.byStage.filter((row) => row.stage !== "breaker");
  const breaker = facts.byStage.find((row) => row.stage === "breaker");
  return (
    <section className="m-section" id="hooks" aria-labelledby="hooks-title">
      <div className="m-wrap">
        <SectionHead eyebrow="THE HOOK LIBRARY" title={`${facts.hookTotal} hooks. Six stages. One agent.`}>
          <p>Every tick runs the same path: Gate, Strike, Size, Pulse, Expiry. A Breaker guards the whole path and can stop new entries at any point.</p>
        </SectionHead>
        <div className="stages" role="group" aria-label="Hook stages and coverage">
          <ol className="stage-row reveal-stagger">
            {main.map((row, index) => (
              <li className="stage-node lift" style={at(index)} key={row.stage}>
                <p className="stage-name mono">{stageLabel(row.stage)}</p>
                <p className="stage-q">{STAGE_QUESTION[row.stage]}</p>
                <Cells live={row.live} total={row.total} />
                <p className="stage-count mono">{row.live} of {row.total} implemented</p>
                <ul className="stage-hooks">{row.liveNames.map((name) => <li key={name}>{name}</li>)}</ul>
              </li>
            ))}
          </ol>
          {breaker ? (
            <div className="breaker-guard reveal">
              <div className="breaker-head">
                <span className="stage-name mono">{stageLabel(breaker.stage)}</span>
                <Chip tone="azure">Always on</Chip>
                <span className="stage-count mono">{breaker.live} of {breaker.total} implemented</span>
              </div>
              <p>{STAGE_QUESTION.breaker} {breaker.liveNames.join(", ")} watch data health, daily loss, drawdown and exposure on every tick. Exits keep running when entries are blocked.</p>
              <Cells live={breaker.live} total={breaker.total} />
            </div>
          ) : null}
        </div>
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

export function TapeSection() {
  return (
    <section className="m-section" id="tape" aria-labelledby="tape-title">
      <div className="m-wrap tape-grid">
        <SectionHead eyebrow="OPTRA TAPE" title="Every decision is written down, including the ones to wait." className="tape-head">
          <p>Each tick the agent records what it did and why: which rule passed or blocked, on what data, under which recipe hash. Holds and skips are entries, not gaps.</p>
          <ul className="forge-points">
            <li><strong>Append-only.</strong> Decisions and paper orders persist per agent.</li>
            <li><strong>Private to your wallet.</strong> There is no public Tape yet, so none is shown here.</li>
          </ul>
          <div className="m-actions">
            <Link className={buttonVariants()} href="/agents">Launch a paper agent</Link>
          </div>
        </SectionHead>
        <figure className="tape-figure reveal">
          <figcaption>Illustrative paper example. Not a recorded trade.</figcaption>
          <div className="tape-flow">
            <ol className="ts-trace">
              <li className="is-pass"><span className="ts-stage">Gate</span><b>Sessia</b><span className="ts-verdict">pass</span>Regular US session</li>
              <li className="is-pass"><span className="ts-stage">Gate</span><b>Corpax</b><span className="ts-verdict">pass</span>No corporate action in window</li>
              <li className="is-block"><span className="ts-stage">Gate</span><b>Calmo</b><span className="ts-verdict">block</span>Volatility ratio above the 1.2 limit</li>
              <li className="is-pass"><span className="ts-stage">Breaker</span><b>Haltr</b><span className="ts-verdict">pass</span>Hourly move within the limit</li>
            </ol>
            <div className="tape-join draw" aria-hidden="true" />
            <div className="tape-decision">
              <Chip>hold</Chip>
              <p className="ts-reason">Entry blocked: volatility is not calm.</p>
              <p className="ts-foot mono">Protective Put · PAPER<br />Source robinhood_stock_token_api<br />Recipe sha256:…</p>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}

/* ─────────────────────────── Optra Lab ─────────────────────────── */

export function LabSection() {
  return (
    <section className="m-section m-section-raised" id="lab" aria-labelledby="lab-title">
      <div className="m-wrap lab-grid">
        <SectionHead eyebrow="OPTRA LAB" title="Backtests that show only what the data supports." className="lab-head">
          <p>The Lab replays real hourly candles. If history is short, gapped, or produces no entry, it shows no metrics at all instead of a guess.</p>
          <Link className={buttonVariants({ variant: "outline" })} href="/lab">Open the Lab</Link>
        </SectionHead>
        <div className="lab-visual reveal-stagger">
          <div className="lab-row" style={at(0)}>
            <div className="lab-row-head"><h3>Verified historical candles</h3><Chip tone="azure">Source-backed</Chip></div>
            <div className="mini-bar"><i style={{ flexGrow: 721 }} /><i className="is-decisions" style={{ flexGrow: 720 }} /></div>
            <div className="mini-bar-labels mono"><span>721 warmup</span><span>720 decisions</span><span>1,441 consecutive closed candles</span></div>
          </div>
          <div className="lab-row" style={at(1)}>
            <div className="lab-row-head"><h3>Option premiums</h3><Chip tone="ember">Modeled</Chip></div>
            <p>Black–Scholes put, volatility = 30-day realized × 1.1, 50 bp slippage. Venue fees are not modeled and no option quote is recorded.</p>
          </div>
          <div className="lab-row" style={at(2)}>
            <div className="lab-row-head"><h3>Results</h3><Chip>Appear after a complete run</Chip></div>
            <div className="lab-slots">
              <div><span>Total return</span><i /></div>
              <div><span>Maximum drawdown</span><i /></div>
              <div><span>Ending cash</span><i /></div>
            </div>
          </div>
          <div className="lab-row lab-row-off" style={at(3)}>
            <div className="lab-row-head"><h3>Comparison with holding the stock</h3><Chip>Not yet available</Chip></div>
          </div>
        </div>
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

export function Sessions() {
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

export function Developers() {
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
