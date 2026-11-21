import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AgentCharacter } from "./characters";
import type { getLandingFacts } from "./data";
import type { FlowScenario } from "./graph-flow";

type Facts = ReturnType<typeof getLandingFacts>;

/** A phone frame. Presentational only: it carries a title, a short status line and whatever the screen renders. */
function Phone({ title, badge, tone = "azure", featured = false, children, label }: { title: string; badge: string; tone?: "azure" | "ember" | "neutral"; featured?: boolean; children: React.ReactNode; label: string }) {
  return (
    <figure className="ph" data-featured={featured ? "1" : "0"} aria-label={label}>
      <div className="ph-body">
        <div className="ph-notch" aria-hidden="true" />
        <header className="ph-head">
          <h3>{title}</h3>
          <span className="ph-badge" data-tone={tone}>{badge}</span>
        </header>
        {children}
      </div>
    </figure>
  );
}

const actionLabel: Record<FlowScenario["action"], string> = { open: "OPEN", close: "CLOSE", hold: "HOLD", skip: "SKIP" };

/**
 * The agent, in three screens. Everything here is read from the same catalog and illustrative ticks the rest of the page
 * uses, so no return, balance or trade is invented. Screens that would need a real run say so instead of showing numbers.
 */
export function AgentPhones({ facts, ticks }: { facts: Facts; ticks: FlowScenario[] }) {
  const stages = facts.recipeStages;
  return (
    <div className="ph-stage">
      <div className="ph-row" role="group" aria-label="Agent screens" tabIndex={0}>
        <Phone title="Recipe" badge="Validated" label="Recipe screen: the Protective Put rules grouped by stage">
          <div className="ph-pills" aria-hidden="true">
            <span data-on="1">Protective Put</span>
            <span><Lock />Covered Call</span>
          </div>
          <ul className="ph-stages">
            {stages.map((entry) => (
              <li key={entry.stage} data-risk={entry.stage === "breaker" ? "1" : "0"}>
                <span className="ph-stage-name mono">{entry.stage}</span>
                <span className="ph-stage-hooks">{entry.hooks.map((hook) => hook.name).join(" · ")}</span>
              </li>
            ))}
          </ul>
          <p className="ph-foot">{facts.hookLive} of {facts.hookTotal} hooks run today. The server checks every recipe.</p>
        </Phone>

        <Phone title="Protective Put" badge="Paper ready" featured label="Agent screen: Protective Put with its put strike, tenor and backtest requirement">
          <div className="ph-hero">
            <AgentCharacter id="protective_put" size={116} title="Protective Put agent" />
            <p>Buys a put about 7% out of the money, 30 days out, when volatility is calm.</p>
          </div>
          <dl className="ph-facts">
            <div><dt>Hooks</dt><dd className="mono">15</dd></div>
            <div><dt>Put strike</dt><dd className="mono">7% OTM</dd></div>
            <div><dt>Tenor</dt><dd className="mono">30 days</dd></div>
          </dl>
          <div className="ph-empty">
            <b>Backtest</b>
            <span>Needs 1,441 hourly candles. No return is shown until a complete run exists.</span>
          </div>
          <Link className={buttonVariants({ size: "sm" }) + " ph-cta"} href="/agents">Launch an agent</Link>
        </Phone>

        <Phone title="Decision log" badge="Illustrative" tone="ember" label="Decision log screen: three example ticks with the reason for each">
          <ol className="ph-log">
            {ticks.map((tick) => (
              <li key={tick.id} data-action={tick.action}>
                <span className="ph-act mono">{actionLabel[tick.action]}</span>
                <span className="ph-reason">{tick.reason}</span>
              </li>
            ))}
          </ol>
          <p className="ph-foot">Example ticks. Not recorded trades. Your own decisions appear on Optra Tape.</p>
        </Phone>
      </div>

      <dl className="ph-stats" aria-label="What is built today">
        <div><dt>Hooks in the catalog</dt><dd className="mono">{facts.hookTotal}</dd></div>
        <div><dt>Hooks that run today</dt><dd className="mono">{facts.hookLive}</dd></div>
        <div><dt>House Agents paper ready</dt><dd className="mono">{facts.paperReadyTemplates.length} of {facts.templates.length}</dd></div>
        <div><dt>Candles per backtest</dt><dd className="mono">1,441</dd></div>
      </dl>
    </div>
  );
}
