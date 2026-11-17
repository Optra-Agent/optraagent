"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, Lock, ShieldCheck } from "lucide-react";
import { PinnedStory } from "./PinnedStory";
import { buttonVariants } from "@/components/ui/button";
import { Chip } from "../app/ui";
import type { Tone } from "../app/ui";
import type { PublicVerification } from "../../lib/domain/contracts";
import type { ApiDoc, HealthGuard, RiskRail } from "./section-data";

/** True while the element is on screen. Used to pause every ambient animation that is off screen. */
function useVisible<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

/* ───────────────────────── Lab ───────────────────────── */

const LAB_STEPS = [
  { id: "prices", title: "Historical prices", text: "A run needs at least 1,441 consecutive closed hourly candles from verified Robinhood Chain history. The first 721 warm up the volatility estimate; the next 720 are decisions. Gaps block the run." },
  { id: "premium", title: "Premium modeling", text: "No option quotes exist for these synthetic options, so each put is priced with Black–Scholes: 30-day realized volatility × 1.1, 50 bp slippage, venue fees not modeled." },
  { id: "replay", title: "Strategy replay", text: "The same rule engine that runs paper ticks evaluates all 15 hooks on each of the 720 decision candles. It opens, holds, closes or skips, exactly as a paper tick would." },
  { id: "compare", title: "Benchmark comparison", text: "The server returns the strategy result next to buy and hold (price only) and flat USD cash, over the same 720 candles. Numbers appear only after a complete run." },
] as const;

export function LabShowcase() {
  const [step, setStep] = useState(0);
  const current = LAB_STEPS[step] ?? LAB_STEPS[0];
  return (
    <PinnedStory id="lab" count={LAB_STEPS.length} step={step} onStep={setStep} beat="34vh" className="lab">
      {({ go }) => (
        <>
          <nav className="ps-nav" aria-label="How a backtest runs">
            <ol>
              {LAB_STEPS.map((item, index) => (
                <li key={item.id} data-state={index === step ? "active" : index < step ? "done" : "next"}>
                  <button type="button" aria-current={index === step ? "step" : undefined} onClick={() => go(index)}>
                    <span className="ps-num mono">{index + 1}</span>
                    <span className="ps-title">{item.title}</span>
                  </button>
                  <p className="ps-text">{item.text}</p>
                </li>
              ))}
            </ol>
            <div className="ps-progress" aria-hidden="true"><i style={{ transform: `scaleY(${(step + 1) / LAB_STEPS.length})` }} /></div>
          </nav>

          <div className="lab-stage" data-step={step}>
            <div className="lab-chart" role="group" aria-label="Historical replay process illustration">
              <p className="lab-chart-kicker mono">REPLAY WINDOW · CLOSED HOURLY CANDLES</p>
              <div className="lab-windows">
                <div className="lab-window lab-warm" data-state={step === 0 ? "active" : "done"}>
                  <span className="lab-window-label mono">VOLATILITY WARMUP</span>
                  <b>721</b>
                  <span>historical candles</span>
                </div>
                <span className="lab-window-link" aria-hidden="true"><i /></span>
                <div className="lab-window lab-dec" data-state={step === 2 ? "active" : step > 2 ? "done" : "upcoming"}>
                  <span className="lab-window-label mono">STRATEGY DECISIONS</span>
                  <b>720</b>
                  <span>historical candles</span>
                </div>
              </div>
              <div className="lab-range" aria-hidden="true">
                <span className="lab-range-label mono">REPLAY POSITION</span>
                <i className="lab-range-track"><b className="lab-range-cursor" /></i>
                <span className="lab-range-end mono">1,441 candles</span>
              </div>
              <div className="lab-premium" data-on={step >= 1 ? "1" : "0"}>
                <div className="lab-model-input">
                  <span className="lab-layer-label mono">OBSERVED INPUT</span>
                  <b>Underlying prices</b>
                  <small>Verified historical candle data</small>
                </div>
                <span className="lab-model-link" aria-hidden="true"><i /></span>
                <div className="lab-model-output">
                  <span className="lab-layer-label mono">MODELED OUTPUT</span>
                  <b>Put premium</b>
                  <small>Black–Scholes · RV30 × 1.1 · 30 days</small>
                  <em>Not an option quote</em>
                </div>
              </div>
              <div className="lab-replay" data-on={step >= 2 ? "1" : "0"}>
                <span>Same paper engine evaluates every decision candle</span>
                <span className="lab-replay-count mono">720 decisions</span>
              </div>
              <p className="lab-ill">Process illustration · no market prices are plotted.</p>
            </div>
            <div className="lab-side">
              <h3 key={current.id}>{current.title}</h3>
              <ul className="lab-slots" aria-label="Benchmark availability" data-on={step >= 3 ? "1" : "0"}>
                {[["Strategy", "Modeled premiums"], ["Buy and hold", "Price only, no dividends"], ["Flat USD cash", "Zero yield, not USDG"]].map(([label, note]) => (
                  <li key={label}><span><b>{label}</b><small>{note}</small></span><em>No value before a complete run</em></li>
                ))}
              </ul>
              <p className="lab-note">No result is shown here because none was run. Flat USD is an accounting baseline, not a measured USDG return.</p>
              <Link className={buttonVariants({ size: "sm" })} href="/lab">Test a strategy in the Lab<ArrowUpRight aria-hidden /></Link>
            </div>
          </div>
        </>
      )}
    </PinnedStory>
  );
}

/* ───────────────────────── Sessions ───────────────────────── */

type Band = { id: string; name: string; hours: string; from: number; to: number; allowed: boolean; text: string };
const BANDS: Band[] = [
  { id: "night-a", name: "Overnight", hours: "20:00 to 04:00 ET", from: 0, to: 4, allowed: false, text: "US stock tokens still trade onchain, but Sessia does not allow a new entry. The agent waits and writes the reason to the Tape." },
  { id: "pre", name: "Pre-market", hours: "04:00 to 09:30 ET", from: 4, to: 9.5, allowed: false, text: "Extended hours are not selectable yet. A paper entry is blocked until the regular session opens." },
  { id: "regular", name: "Regular hours", hours: "09:30 to 16:00 ET", from: 9.5, to: 16, allowed: true, text: "The only session Sessia allows today: new entries may be evaluated here, on open market days. Holidays and early closes are handled by the engine, not by this picture." },
  { id: "after", name: "After-hours", hours: "16:00 to 20:00 ET", from: 16, to: 20, allowed: false, text: "Extended hours are not selectable yet. A paper entry is blocked until the next regular session." },
  { id: "night-b", name: "Overnight", hours: "20:00 to 04:00 ET", from: 20, to: 24, allowed: false, text: "US stock tokens still trade onchain, but Sessia does not allow a new entry. The agent waits and writes the reason to the Tape." },
];

export function SessionsTimeline() {
  const [ref, visible] = useVisible<HTMLDivElement>(0.4);
  const [id, setId] = useState("regular");
  const band = BANDS.find((row) => row.id === id) ?? BANDS[2]!;
  return (
    <div className="st" ref={ref} data-visible={visible ? "1" : "0"}>
      <div className="st-bar" role="group" aria-label="A 24 hour US trading day in Eastern Time">
        {BANDS.map((row) => (
          <button type="button" key={row.id} className="st-band" style={{ flexGrow: row.to - row.from }} aria-pressed={row.id === band.id} data-allowed={row.allowed ? "1" : "0"} onClick={() => setId(row.id)}>
            <span className="st-name">{row.name}</span>
            <span className="st-state mono">{row.allowed ? "Entries allowed" : "Entries blocked"}</span>
          </button>
        ))}
        <span className="st-marker" aria-hidden="true" />
      </div>
      <div className="st-axis mono" aria-hidden="true">
        {([["00:00", 0], ["04:00", 4], ["09:30", 9.5], ["16:00", 16], ["20:00", 20], ["24:00", 24]] as const).map(([label, hour]) => <span key={label} style={{ left: `${(hour / 24) * 100}%` }}>{label}</span>)}
      </div>
      <div className="st-detail" data-allowed={band.allowed ? "1" : "0"} aria-live="polite">
        <div className="st-detail-main" key={band.id}>
          <div className="st-detail-head"><h3>{band.name}</h3><span className="mono">{band.hours}</span><Chip tone={band.allowed ? "azure" : "ember"}>{band.allowed ? "New entries allowed" : "New entries blocked"}</Chip></div>
          <p>{band.text}</p>
        </div>
        <aside className="st-sessia" aria-label="How Sessia decides">
          <p className="st-sessia-title mono">SESSIA, THE ENTRY RULE</p>
          <ul>
            <li><Check aria-hidden />Allows new entries in regular US hours, 09:30 to 16:00 ET, on open market days.</li>
            <li><Check aria-hidden />Exits are not gated by it.</li>
            <li><Check aria-hidden />Holidays and early closes come from the engine, not from this picture.</li>
            <li><Lock aria-hidden />Opening Bell and Closing Bell choices are Planned.</li>
          </ul>
        </aside>
      </div>
      <p className="st-note">An illustration of a US trading day. It does not show whether the market is open right now: that decision belongs to the engine&apos;s session rules, with holidays and early closes.</p>
    </div>
  );
}

/* ───────────────────────── Risk ───────────────────────── */

const BLOCK_WHEN: Record<string, "gt" | "gte"> = { haltr: "gt", daylo: "gte", drawra: "gte", exposa: "gt" };

export function BreakerPanel({ rails, health }: { rails: RiskRail[]; health: HealthGuard }) {
  const [id, setId] = useState(rails[0]?.id ?? "haltr");
  const rail = rails.find((row) => row.id === id);
  const [trial, setTrial] = useState<Record<string, number>>(() => Object.fromEntries(rails.map((row) => [row.id, row.value])));
  const value = rail ? (trial[rail.id] ?? rail.value) : 0;
  const blocked = rail ? (BLOCK_WHEN[rail.id] === "gte" ? value >= rail.value : value > rail.value) : false;
  const guards = [...rails.map((row) => ({ id: row.id, name: row.name })), { id: health.id, name: health.name }];
  return (
    <div className="bp">
      <div className="bp-guards" role="group" aria-label="Breaker rules">
        {guards.map((guard) => (
          <button type="button" key={guard.id} aria-pressed={guard.id === id} onClick={() => setId(guard.id)}><ShieldCheck aria-hidden />{guard.name}</button>
        ))}
      </div>
      <div className="bp-body" key={id}>
        {rail ? (
          <>
            <div className="bp-head"><h3>{rail.label}</h3><Chip tone="ember">Stops new entries at {rail.value}{rail.unit}</Chip></div>
            <p className="bp-text">{rail.summary}</p>
            <div className="bp-demo">
              <p className="bp-demo-label mono">TRY A VALUE · ILLUSTRATION ONLY</p>
              <div className="bp-track" aria-hidden="true">
                <i className="bp-ok" style={{ width: `${(rail.value / rail.max) * 100}%` }} />
                <i className="bp-stop" />
                <b className="bp-limit mono" style={{ left: `${(rail.value / rail.max) * 100}%` }}>limit {rail.value}{rail.unit}</b>
                <span className="bp-thumb" data-blocked={blocked ? "1" : "0"} style={{ left: `${(value / rail.max) * 100}%` }} />
              </div>
              <label className="bp-range">
                <span className="sr-only">{rail.label}, demonstration value</span>
                <input type="range" min={rail.min} max={rail.max} step={rail.step} value={value} onChange={(event) => setTrial((current) => ({ ...current, [rail.id]: Number(event.target.value) }))} />
              </label>
              <p className="bp-verdict" data-blocked={blocked ? "1" : "0"} role="status">At {value}{rail.unit}: new entries would be <b>{blocked ? "blocked" : "allowed"}</b>. Exits keep running either way.</p>
            </div>
            <p className="bp-foot">Default shown is the Protective Put recipe. This slider changes nothing in any strategy.</p>
          </>
        ) : (
          <>
            <div className="bp-head"><h3>Data and model health</h3><Chip tone="ember">Checks every tick</Chip></div>
            <p className="bp-text">{health.summary}</p>
            <ul className="bp-checks">
              <li><Check aria-hidden />Underlying price data is available and fresh.</li>
              <li><Check aria-hidden />A valid modeled premium can be computed.</li>
              <li><Lock aria-hidden />Venue spread and error-rate checks are unavailable: there is no option venue quote.</li>
            </ul>
            <p className="bp-foot">{health.note}</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Developers ───────────────────────── */

const PLANNED = [{ id: "mcp", label: "MCP server", note: "Agent tools over the Model Context Protocol" }, { id: "x402", label: "Pay-per-call (x402)", note: "Metered access in USDG" }];

function highlight(json: string) {
  const parts: React.ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|(…\d+ more)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(json))) {
    if (match.index > last) parts.push(json.slice(last, match.index));
    if (match[1] !== undefined) parts.push(match[2] ? <span key={key++} className="tk-key">{match[1]}</span> : <span key={key++} className="tk-str">{match[1]}</span>);
    else if (match[3]) parts.push(<span key={key++} className="tk-lit">{match[3]}</span>);
    else if (match[4]) parts.push(<span key={key++} className="tk-num">{match[4]}</span>);
    else parts.push(<span key={key++} className="tk-more">{match[5]}</span>);
    if (match[2]) parts.push(match[2]);
    last = re.lastIndex;
  }
  parts.push(json.slice(last));
  return parts;
}

function Copy_({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="dd-copy" aria-label={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1600); } catch { setDone(false); } }}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}<span>{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function DevDocs({ docs }: { docs: ApiDoc[] }) {
  const [id, setId] = useState(docs[0]?.id ?? "");
  const doc = docs.find((row) => row.id === id) ?? docs[0];
  const highlighted = useMemo(() => (doc ? highlight(doc.response) : null), [doc]);
  if (!doc) return null;
  const request = `curl -s "$OPTRA_URL${doc.path}"`;
  return (
    <div className="dd">
      <nav className="dd-nav" aria-label="Public API endpoints">
        <p className="dd-nav-label mono">PUBLIC API · V1</p>
        <ul>
          {docs.map((row) => (
            <li key={row.id}>
              <button type="button" aria-current={row.id === doc.id ? "true" : undefined} onClick={() => setId(row.id)}>
                <span className="dd-get mono">GET</span><span>{row.title}</span>
                {row.status === "Empty" ? <small>Empty</small> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="dd-nav-label mono">PLANNED</p>
        <ul>
          {PLANNED.map((row) => <li key={row.id}><span className="dd-planned" aria-disabled="true"><span>{row.label}</span><small>Planned</small></span></li>)}
        </ul>
      </nav>
      <article className="dd-main" key={doc.id} aria-label={doc.title}>
        <div className="dd-head">
          <span className="dd-get mono">GET</span><code className="dd-path">{doc.path}</code>
          <Chip tone={doc.status === "Working" ? "azure" : "neutral"}>{doc.status}</Chip>
        </div>
        <p className="dd-summary">{doc.summary}</p>
        <dl className="dd-meta">
          <div><dt>Auth</dt><dd>{doc.auth}</dd></div>
          <div><dt>Format</dt><dd>JSON, no-store</dd></div>
        </dl>
        <div className="dd-code">
          <div className="dd-code-bar"><span className="mono">Request</span><Copy_ text={request} label="request" /></div>
          <pre tabIndex={0} aria-label="Request example"><code>{request}</code></pre>
        </div>
        <div className="dd-code">
          <div className="dd-code-bar"><span className="mono">Response · 200</span><Copy_ text={doc.response} label="response" /></div>
          <pre tabIndex={0} aria-label="Response example"><code>{highlighted}</code></pre>
        </div>
        <p className="dd-foot">Set <code>OPTRA_URL</code> to your deployment. Trading routes are private to the wallet that owns the agent and are not listed here.</p>
      </article>
    </div>
  );
}

/* ───────────────────────── Verify ───────────────────────── */

const CLAIM_TITLE: Record<string, string> = { market_data: "Market data", hook_catalog: "Hook catalog", house_agents: "House Agents", historical_backtest: "Historical backtest", live_execution: "Live execution", v4_claim_level: "Uniswap v4 claim level" };
const CLAIM_GROUP: Record<string, string> = { market_data: "works", hook_catalog: "works", house_agents: "works", historical_backtest: "works", live_execution: "limits", v4_claim_level: "limits" };
const CLAIM_STATUS: Record<string, { label: string; tone: Tone }> = { verified: { label: "Verified", tone: "azure" }, limited: { label: "Limited", tone: "neutral" }, preview: { label: "Preview", tone: "neutral" }, unavailable: { label: "Unavailable", tone: "ember" }, disabled: { label: "Disabled", tone: "ember" } };
const ROADMAP = [
  { id: "agents", title: "Other House Agents", label: "Preview", note: "Covered Call, Cash-Secured Put and Earnings Straddle cannot be created yet." },
  { id: "ai", title: "AI composition", label: "Next", note: "No AI provider is configured." },
  { id: "later", title: "Session choices, Listing, Floor, MCP, x402", label: "Planned", note: "Roadmap only. No route or service yet." },
];
const gist = (statement: string) => (statement.split(/[.;]\s/)[0] ?? statement).replace(/\.$/, "") + ".";

export function EvidenceCenter({ verification }: { verification: PublicVerification }) {
  const groups = [
    { id: "works", title: "What works, and its limits", claims: verification.claims.filter((claim) => (CLAIM_GROUP[claim.id] ?? "works") === "works") },
    { id: "limits", title: "Safety boundaries", claims: verification.claims.filter((claim) => CLAIM_GROUP[claim.id] === "limits") },
  ];
  const counts = verification.claims.reduce<Record<string, number>>((acc, claim) => ({ ...acc, [claim.status]: (acc[claim.status] ?? 0) + 1 }), {});
  return (
    <div className="ev">
      <div className="ev-summary" role="group" aria-label="Claim summary">
        <div><b className="mono">{verification.claims.length}</b><span>claims from the server</span></div>
        {Object.entries(counts).map(([status, count]) => <div key={status}><b className="mono">{count}</b><span>{CLAIM_STATUS[status]?.label ?? status}</span></div>)}
        <div><b className="mono">{verification.liveTradingEnabled ? "On" : "Off"}</b><span>Live trading</span></div>
      </div>
      {groups.map((group) => (
        <section className="ev-group" key={group.id} aria-label={group.title}>
          <h3>{group.title}</h3>
          <ul className="reveal-stagger">
            {group.claims.map((claim, index) => {
              const meta = CLAIM_STATUS[claim.status] ?? { label: claim.status, tone: "neutral" as Tone };
              return (
                <li key={claim.id} style={{ "--i": index } as React.CSSProperties}>
                  <details className="ev-row">
                    <summary>
                      <span className="ev-title">{CLAIM_TITLE[claim.id] ?? claim.id.replaceAll("_", " ")}</span>
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                      <span className="ev-gist">{gist(claim.statement)}</span>
                      <ChevronDown aria-hidden />
                    </summary>
                    <div className="ev-body">
                      <p>{claim.statement}</p>
                      <a className="evidence mono" href={claim.evidencePath} target="_blank" rel="noreferrer">Evidence: {claim.evidencePath}<ArrowUpRight aria-hidden /></a>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section className="ev-group" aria-label="Roadmap">
        <h3>Roadmap, no evidence yet</h3>
        <ul>
          {ROADMAP.map((row) => (
            <li key={row.id}>
              <div className="ev-row ev-roadmap"><span className="ev-title">{row.title}</span><Chip>{row.label}</Chip><span className="ev-gist">{row.note}</span></div>
            </li>
          ))}
        </ul>
      </section>
      <p className="ev-foot mono">Live trading {verification.liveTradingEnabled ? "enabled" : "disabled"} · Uniswap v4 claim level {verification.v4ClaimLevel}</p>
    </div>
  );
}
