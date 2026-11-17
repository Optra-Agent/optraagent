"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TemplateCard } from "../app/agents/TemplateCard";
import { SidebarView } from "../app/Sidebar";
import { TopbarView } from "../app/Topbar";
import { Chip, JourneyRail, Panel } from "../app/ui";
import type { getLandingFacts } from "./data";

type Facts = ReturnType<typeof getLandingFacts>;
type Screen = "/agents" | "/forge" | "/lab" | "/tape";
const SCREENS: readonly Screen[] = ["/agents", "/forge", "/lab", "/tape"];
const TITLE: Record<Screen, string> = { "/agents": "Agents", "/forge": "Forge", "/lab": "Lab", "/tape": "Tape" };
const EYEBROW: Record<Screen, string> = { "/agents": "PAPER ONLY", "/forge": "CLICK-TO-CONFIGURE · PAPER ONLY", "/lab": "HISTORICAL REPLAY · PAPER", "/tape": "APPEND-ONLY · PAPER" };
/** The preview never claims progress: every screen starts at "Connect wallet". */

/** Engine wording, labeled illustrative. No price, no time, no result. */
const SAMPLE_TRACE = [
  ["Gate", "Sessia", "pass"], ["Gate", "Corpax", "pass"], ["Gate", "Calmo", "block"], ["Breaker", "Haltr", "pass"],
] as const;

function AgentsScreen({ facts }: { facts: Facts }) {
  const featured = facts.paperReadyTemplates[0];
  const [picked, setPicked] = useState<string>(featured?.id ?? "");
  const pickedPreview = facts.previewTemplates.find((template) => template.id === picked);
  return (
    <div className="preview-grid">
      <div className="preview-left">
        <p className="eyebrow">HOUSE AGENTS</p>
        {featured ? (
          <button type="button" className="pv-pick" aria-pressed={picked === featured.id} onClick={() => setPicked(featured.id)}>
            <TemplateCard template={featured} interactive={false} headingAs="p" />
          </button>
        ) : null}
        <div className="preview-minis">
          {facts.previewTemplates.map((template) => (
            <button type="button" key={template.id} className="pv-pick" aria-pressed={picked === template.id} onClick={() => setPicked(template.id)}>
              <TemplateCard template={template} interactive={false} compact headingAs="p" />
            </button>
          ))}
        </div>
      </div>
      {pickedPreview ? (
        <Panel className="creator preview-creator" key={pickedPreview.id}>
          <div className="panel-head"><div><p className="eyebrow">HOUSE AGENT</p><p className="preview-sub">{pickedPreview.name}</p></div><Chip>Preview</Chip></div>
          <p className="pv-note">{pickedPreview.reason}</p>
          <p className="pv-note pv-note-strong"><Lock aria-hidden />Strategy overview. Paper drafts are created for Protective Put only.</p>
        </Panel>
      ) : (
        <Panel className="creator preview-creator" key="ready">
          <div className="panel-head"><div><p className="eyebrow">STEP 2 · CONFIGURE</p><p className="preview-sub">Protective Put draft</p></div><Chip tone="azure">Paper ready</Chip></div>
          <div className="pv-fields">
            <div><span>Underlying</span><b>Choose a market</b></div>
            <div><span>Virtual reference shares</span><b className="mono">10</b></div>
            <div><span>Paper capital (USD)</span><b className="mono">100000</b></div>
          </div>
          <p className="pv-note">Protect 10 shares with a put 7% out of the money, about 30 days out. Premiums are modeled.</p>
          <Link className={cn(buttonVariants({ size: "lg" }), "w-full")} href="/agents#configure">Configure in the app<ArrowUpRight aria-hidden /></Link>
        </Panel>
      )}
    </div>
  );
}

function ForgeScreen({ facts }: { facts: Facts }) {
  const defaults = facts.byStage.flatMap((row) => row.liveNames);
  const [on, setOn] = useState<string[]>(defaults);
  const toggle = (name: string) => setOn((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
  return (
    <div className="preview-forge">
      <Panel>
        <div className="panel-head"><div><p className="eyebrow">HOOK RULES</p><p className="preview-sub">Choose the rules</p></div><Chip tone="azure">{on.length} of {defaults.length} selected</Chip></div>
        <div className="pv-stages">
          {facts.byStage.map((row) => (
            <div className="pv-stage" key={row.stage} data-risk={row.stage === "breaker" ? "1" : "0"}>
              <span className="pv-stage-name mono">{row.stage}</span>
              <div className="pv-chips">
                {row.liveNames.map((name) => <button type="button" key={name} aria-pressed={on.includes(name)} onClick={() => toggle(name)}>{name}</button>)}
                {row.total - row.live > 0 ? <span className="pv-locked">{row.total - row.live} locked</span> : null}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <div className="panel-head"><div><p className="eyebrow">VALIDATION</p><p className="preview-sub">Runs on the server</p></div><Chip>Not run in preview</Chip></div>
        <p className="pv-note">Validation and the canonical recipe hash come from the server. This preview never runs them, so it shows no result. Open Forge to validate for real.</p>
        <Link className={cn(buttonVariants(), "w-full")} href="/forge">Open Forge<ArrowUpRight aria-hidden /></Link>
      </Panel>
    </div>
  );
}

function LabScreen() {
  return (
    <div className="preview-forge">
      <Panel>
        <div className="panel-head"><div><p className="eyebrow">1 · DATA COVERAGE</p><p className="preview-sub">Source-backed history</p></div><Chip tone="azure">Closed hourly candles</Chip></div>
        <div className="pv-strip" aria-hidden="true"><i style={{ flexGrow: 721 }} /><i className="is-dec" style={{ flexGrow: 720 }} /></div>
        <div className="pv-strip-labels mono"><span>721 warmup</span><span>720 decisions</span></div>
        <p className="pv-note">A backtest needs 1,441 consecutive closed candles. Premiums are modeled, not recorded.</p>
      </Panel>
      <Panel>
        <div className="panel-head"><div><p className="eyebrow">2 · BACKTEST</p><p className="preview-sub">Results and benchmarks</p></div><Chip tone="ember">Modeled premiums</Chip></div>
        <ul className="pv-slots">
          {["Strategy return", "Buy and hold", "Flat USD cash"].map((label) => <li key={label}><span>{label}</span><i /></li>)}
        </ul>
        <p className="pv-note">Numbers appear only after a complete run in the app. None are shown here.</p>
        <Link className={cn(buttonVariants({ variant: "outline" }), "w-full")} href="/lab">Open Lab<ArrowUpRight aria-hidden /></Link>
      </Panel>
    </div>
  );
}

function TapeScreen() {
  const [open, setOpen] = useState(true);
  return (
    <div className="preview-forge">
      <Panel>
        <div className="panel-head"><div><p className="eyebrow">DECISION TAPE</p><p className="preview-sub">Every tick, written down</p></div><Chip tone="ember">Illustrative only</Chip></div>
        <div className="pv-tick">
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Chip>skip</Chip><span>Entry blocked by calmo.</span></button>
          {open ? (
            <ul className="pv-trace">
              {SAMPLE_TRACE.map(([stage, hook, verdict]) => <li key={hook} data-v={verdict}><span className="mono">{stage}</span><b>{hook}</b><span className="mono">{verdict}</span></li>)}
            </ul>
          ) : null}
        </div>
        <p className="pv-note">An example of the shape, not a recorded trade. Your agents write real entries here once they run.</p>
      </Panel>
      <Panel>
        <div className="panel-head"><div><p className="eyebrow">YOUR TAPE</p><p className="preview-sub">Private to your wallet</p></div></div>
        <p className="pv-note">Connect a wallet in the app to open the Tape of an agent you own. The public Tape has no records yet.</p>
        <Link className={cn(buttonVariants({ variant: "outline" }), "w-full")} href="/tape">Open Tape<ArrowUpRight aria-hidden /></Link>
      </Panel>
    </div>
  );
}

/**
 * An interactive, read-only miniature of the real app. It renders the app's own sidebar, topbar, journey rail, template
 * cards and panels. Switching screens, picking a House Agent and toggling hooks only change what is shown. Nothing here
 * connects a wallet, validates a recipe, runs a backtest or places an order, and every screen links to its real route.
 */
export function ProductPreview({ facts }: { facts: Facts }) {
  const [screen, setScreen] = useState<Screen>("/agents");
  const [switched, setSwitched] = useState(false);
  const choose = (next: Screen) => { setSwitched(true); setScreen(next); };
  return (
    <div className="preview-shell" role="group" aria-label="Interactive preview of the Optra app. Read only.">
      <aside className="sidebar"><SidebarView active={screen} interactive preview={{ screens: SCREENS, onSelect: (href) => choose(href as Screen) }} /></aside>
      <div className="shell-main">
        <div className="topbar">
          <TopbarView
            title={TITLE[screen]}
            session={<Link className={buttonVariants({ size: "sm" })} href={screen}>Open app<ArrowUpRight aria-hidden /></Link>}
          />
        </div>
        <div className="pv-tabs" role="group" aria-label="Preview screens">
          {SCREENS.map((item) => <button type="button" key={item} aria-pressed={screen === item} onClick={() => choose(item)}>{TITLE[item]}</button>)}
        </div>
        <div className="preview-page" key={screen} data-switched={switched ? "1" : "0"}>
          <p className="eyebrow">{EYEBROW[screen]}</p>
          <p className="preview-title">{TITLE[screen]}</p>
          <JourneyRail step={1} interactive={false} />
          {screen === "/agents" ? <AgentsScreen facts={facts} /> : null}
          {screen === "/forge" ? <ForgeScreen facts={facts} /> : null}
          {screen === "/lab" ? <LabScreen /> : null}
          {screen === "/tape" ? <TapeScreen /> : null}
        </div>
      </div>
    </div>
  );
}
