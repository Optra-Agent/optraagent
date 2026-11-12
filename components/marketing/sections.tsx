import Link from "next/link";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import { HeroStage } from "./HeroStage";
import { getLandingFacts, stageLabel } from "./data";

type Facts = ReturnType<typeof getLandingFacts>;

export function Hero({ facts }: { facts: Facts }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="m-eyebrow">AI OPTIONS AGENTS · ROBINHOOD CHAIN</p>
        <h1 id="hero-title">Let agents trade the strike.</h1>
        <p className="hero-sub">
          Choose a House Agent or build your own rules for synthetic calls and puts on Robinhood Chain. Backtest the strategy, run it on paper, and read every decision on Optra Tape.
        </p>
        <p className="hero-gloss">The strike is the price an option is struck at. Rules pick it, size it, and explain it.</p>
        <div className="hero-actions">
          <Link className="button button-primary" href="/agents">Launch a paper agent</Link>
          <a className="button button-secondary" href="#tape">Read the Tape</a>
        </div>
        <p className="hero-micro">Paper first. Synthetic options on stock prices. Not shares. Not investment advice.</p>
        <dl className="hero-facts">
          <div><dt>Agents</dt><dd>House Agent or your own rules</dd></div>
          <div><dt>Rules</dt><dd>Six stages of validated hooks</dd></div>
          <div><dt>Testing</dt><dd>Backtest first, then paper</dd></div>
          <div><dt>Proof</dt><dd>Every decision on the Tape</dd></div>
        </dl>
      </div>

      <HeroStage>
        <div className="hc-head">
          <div>
            <p className="hc-kicker">HOUSE AGENT · BY OPTRA</p>
            <h2 className="hc-title">Protective Put</h2>
          </div>
          <div className="hc-tags">
            <Chip tone="azure">Paper ready</Chip>
            <Chip tone="ember">Modeled premiums</Chip>
          </div>
        </div>
        <ol className="hc-stages">
          {facts.recipeStages.map((entry) => (
            <li key={entry.stage}>
              <span className="hc-stage-name">{stageLabel(entry.stage)}</span>
              <ul>
                {entry.hooks.map((hook) => (
                  <li key={hook.id}><b>{hook.name}</b><span>{hook.line}</span></li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="hc-foot">
          <span>Recipe preview built from the live hook catalog. This is not a trade.</span>
          <Link href="/agents#configure">Configure this agent</Link>
        </div>
      </HeroStage>
    </section>
  );
}

export function HouseAgents({ facts }: { facts: Facts }) {
  const ready = facts.paperReadyTemplates[0];
  return (
    <section className="m-section" id="agents" aria-labelledby="agents-title">
      <div className="m-wrap agents-split">
        <div className="agents-lead">
          <p className="m-eyebrow">HOUSE AGENTS</p>
          <h2 id="agents-title">One House Agent runs on paper today. Three are next.</h2>
          <p>
            Protective Put works end to end: wallet sign-in, backtest, paper launch, paper ticks and Tape. Covered Call, Cash-Secured Put and Earnings Straddle stay in Preview until their venue and data requirements are verified.
          </p>
          {ready ? (
            <div className="agent-feature">
              <div className="agent-feature-head">
                <h3>{ready.name}</h3>
                <Chip tone="azure">Paper ready</Chip>
              </div>
              <p>A put bought about 7% out of the money, 30 calendar days out, when realized volatility is calm. It is portfolio insurance: the premium is the cost, and it is lost if the stock does not fall.</p>
              <dl className="agent-feature-facts">
                <div><dt>Hooks used</dt><dd className="mono">{facts.hookLive} of {facts.hookTotal}</dd></div>
                <div><dt>Backtest needs</dt><dd className="mono">1,441 candles</dd></div>
                <div><dt>Premiums</dt><dd>Modeled</dd></div>
              </dl>
              <Link className="button button-primary" href="/agents#configure">Create a Protective Put draft</Link>
            </div>
          ) : null}
        </div>
        <ul className="agent-previews" aria-label="House Agents in Preview">
          {facts.previewTemplates.map((template) => (
            <li key={template.id}>
              <div className="preview-head">
                <h3>{template.name}</h3>
                <Chip>Preview</Chip>
              </div>
              <p>{template.reason}</p>
              <p className="preview-state">Not yet available</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Forge({ facts }: { facts: Facts }) {
  return (
    <section className="m-section m-section-raised" id="forge" aria-labelledby="forge-title">
      <div className="m-wrap forge-split">
        <div className="forge-ladder" role="img" aria-label={`Hook coverage by stage: ${facts.byStage.map((row) => `${stageLabel(row.stage)} ${row.live} of ${row.total} implemented`).join(", ")}`}>
          {facts.byStage.map((row) => (
            <div className="ladder-row" key={row.stage}>
              <span className="ladder-name">{stageLabel(row.stage)}</span>
              <span className="ladder-cells" aria-hidden="true">
                {Array.from({ length: row.total }, (_, index) => <i key={index} className={index < row.live ? "is-live" : ""} />)}
              </span>
              <span className="ladder-count mono">{row.live}/{row.total}</span>
            </div>
          ))}
          <p className="ladder-legend"><i className="is-live" /> Implemented evaluator <i /> Catalog only</p>
        </div>
        <div className="forge-copy">
          <p className="m-eyebrow">FORGE AND HOOKS</p>
          <h2 id="forge-title">Click rules together. The server checks every recipe.</h2>
          <p>
            An agent is a recipe of rules across six stages: Gate, Strike, Size, Pulse, Expiry and Breaker. Forge validates the recipe, gives it a canonical hash, and blocks anything it cannot run.
          </p>
          <ul className="forge-points">
            <li><strong>{facts.hookLive} of {facts.hookTotal} hooks run today.</strong> The other {facts.hookCatalogOnly} are documented in the library and locked in Forge.</li>
            <li><strong>AI composition: Coming soon.</strong> Rules decide. No AI provider is configured, so recipes are built by clicking.</li>
            <li><strong>Inspired by Uniswap v4 hooks.</strong> Every hook runs in the offchain paper engine. None is deployed onchain.</li>
          </ul>
          <div className="m-actions">
            <Link className="button button-primary" href="/forge">Open Forge</Link>
            <Link className="button button-secondary" href="/hooks">Browse the hook library</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const steps = [
  ["Connect wallet", "Sign one message with MetaMask or Phantom EVM on Robinhood Chain. No transaction is sent.", "/agents"],
  ["Choose and configure", "Pick Protective Put, then set the underlying, virtual reference shares and paper capital.", "/agents#configure"],
  ["Backtest", "Replay 720 decisions over 1,441 closed hourly candles. Premiums are modeled with Black–Scholes, not recorded.", "/lab"],
  ["Launch paper", "Launching attaches that exact backtest to the recipe hash. No deposit, no real money.", "/lab"],
  ["Run a paper tick", "Every rule runs on the latest closed candle. A modeled order appears only if all rules pass.", "/agents"],
  ["Inspect the Tape", "Read the decision, each rule's verdict, the data used, and the paper position.", "/tape"],
] as const;

export function HowItWorks() {
  return (
    <section className="m-section" id="how" aria-labelledby="how-title">
      <div className="m-wrap how-split">
        <div className="how-lead">
          <p className="m-eyebrow">HOW IT WORKS AND THE LAB</p>
          <h2 id="how-title">From idea to paper position, in order.</h2>
          <p>The Lab only reports results it can support. If history is short, gapped or produces no entry, it shows no metrics at all.</p>
          <dl className="how-limits">
            <div><dt>Data</dt><dd>Real hourly candles from Robinhood Chain token prices</dd></div>
            <div><dt>Premiums</dt><dd>Black–Scholes, volatility = 30-day realized × 1.1</dd></div>
            <div><dt>Costs</dt><dd>50 bp slippage. Options venue fees are not modeled</dd></div>
            <div><dt>Not available</dt><dd>Comparison with holding the stock</dd></div>
          </dl>
        </div>
        <ol className="how-steps">
          {steps.map(([title, text, href], index) => (
            <li key={title}>
              <span className="how-index mono">{index + 1}</span>
              <div>
                <h3><Link href={href}>{title}</Link></h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function TapeSection() {
  return (
    <section className="m-section m-section-raised" id="tape" aria-labelledby="tape-title">
      <div className="m-wrap tape-split">
        <div className="tape-copy">
          <p className="m-eyebrow">OPTRA TAPE</p>
          <h2 id="tape-title">Every decision is written down, including the ones to wait.</h2>
          <p>Each tick the agent records what it did and why: which rule passed or blocked, on what data, under which recipe hash. Holds and skips are entries, not gaps.</p>
          <ul className="forge-points">
            <li><strong>Append-only.</strong> Decisions and paper orders persist per agent.</li>
            <li><strong>Private to your wallet.</strong> There is no public Tape yet, so none is shown here.</li>
          </ul>
          <div className="m-actions">
            <Link className="button button-primary" href="/agents">Launch a paper agent</Link>
          </div>
        </div>
        <figure className="tape-sample">
          <figcaption>Illustrative paper example. Not a recorded trade.</figcaption>
          <div className="tape-sample-card">
            <div className="ts-head">
              <Chip>hold</Chip>
              <span className="mono">Protective Put · PAPER</span>
            </div>
            <p className="ts-reason">Entry blocked: volatility is not calm.</p>
            <ol className="ts-trace">
              <li className="is-pass"><span className="ts-stage">Gate</span><b>Sessia</b><span className="ts-verdict">pass</span>Regular US session</li>
              <li className="is-pass"><span className="ts-stage">Gate</span><b>Corpax</b><span className="ts-verdict">pass</span>No corporate action in window</li>
              <li className="is-block"><span className="ts-stage">Gate</span><b>Calmo</b><span className="ts-verdict">block</span>Volatility ratio above the 1.2 limit</li>
              <li className="is-pass"><span className="ts-stage">Breaker</span><b>Haltr</b><span className="ts-verdict">pass</span>Hourly move within the limit</li>
            </ol>
            <p className="ts-foot mono">Source robinhood_stock_token_api · Recipe sha256:…</p>
          </div>
        </figure>
      </div>
    </section>
  );
}

type StatusRow = { name: string; tone: Tone; label: string; note: string };

export function Status({ facts }: { facts: Facts }) {
  const rows: StatusRow[] = [
    { name: "Wallet sign-in", tone: "azure", label: "Working", note: "MetaMask and Phantom EVM, Robinhood Chain 4663. Login signature only." },
    { name: "Protective Put on paper", tone: "azure", label: "Working", note: "Backtest, launch, paper tick, Tape and positions." },
    { name: "Backtests", tone: "neutral", label: "Limited", note: "Real candles, modeled premiums, venue fees not modeled. Needs 1,441 consecutive candles." },
    { name: "Hook evaluators", tone: "neutral", label: "Limited", note: `${facts.hookLive} of ${facts.hookTotal} hooks run. ${facts.hookCatalogOnly} are catalog only.` },
    { name: "Other House Agents", tone: "neutral", label: "Preview", note: "Covered Call, Cash-Secured Put and Earnings Straddle cannot be created yet." },
    { name: "AI composition", tone: "neutral", label: "Coming soon", note: "No AI provider is configured." },
    { name: "Live execution", tone: "ember", label: "Disabled", note: "No real-money path exists in this build." },
    { name: "Listing, Floor, Sessions, MCP, x402", tone: "neutral", label: "Planned", note: "Roadmap only. No route or service yet." },
  ];
  return (
    <section className="m-section" id="status" aria-labelledby="status-title">
      <div className="m-wrap status-split">
        <div className="status-lead">
          <p className="m-eyebrow">VERIFY</p>
          <h2 id="status-title">Built, not promised.</h2>
          <p>This table is the product today. The Verify page reads the same claims from the server, each with a link to its evidence.</p>
          <Link className="button button-secondary" href="/verify">Read the live claims</Link>
        </div>
        <table className="status-table">
          <caption className="sr-only">Capability status</caption>
          <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td><Chip tone={row.tone}>{row.label}</Chip></td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
    <section className="m-section m-section-raised" id="faq" aria-labelledby="faq-title">
      <div className="m-wrap faq-split">
        <div>
          <p className="m-eyebrow">BEFORE YOU LAUNCH</p>
          <h2 id="faq-title">Questions worth asking first.</h2>
        </div>
        <div className="faq-list">
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
      <div className="m-wrap">
        <h2 id="final-title">Your first agent runs on paper.</h2>
        <p>Create the draft, backtest it, launch it, and read the first tick on the Tape. No deposit, no real money.</p>
        <div className="m-actions">
          <Link className="button button-primary" href="/agents">Launch a paper agent</Link>
          <Link className="button button-secondary" href="/hooks">Read the rules first</Link>
        </div>
      </div>
    </section>
  );
}
