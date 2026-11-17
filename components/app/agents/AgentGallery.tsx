"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { HouseAgentTemplateCatalogResponseSchema } from "../../../lib/domain/contracts";
import type { Agent, HouseAgentTemplate } from "../../../lib/domain/contracts";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatUtc, shortHash, titleCase } from "../format";
import { Skeleton, StateBlock } from "../ui";
import { featuredFacts, templateSummaries } from "./TemplateCard";
import { AgentCharacter, CHARACTERS, type CharacterId } from "../../marketing/characters";

type Filter = "all" | "ready" | "preview" | "yours";
type Load = "loading" | "ready" | "error";

const nextAction: Record<Agent["status"], string> = {
  draft: "Backtest it in Lab, then launch on paper.",
  running: "Run a paper tick or read its Tape.",
  paused: "Resume it from the agent page.",
  stopped: "Stopped. Fork it to start a new draft.",
};

const strategyLine: Record<HouseAgentTemplate["id"], string> = {
  protective_put: "Long put · protects shares you hold",
  covered_call: "Short call · against shares you hold",
  cash_secured_put: "Short put · backed by cash",
  earnings_straddle: "Long call and put · around earnings",
};

/**
 * The agent gallery: House Agents and the agents you saved, as one grid of cards.
 * A card never shows a return or a decision that was not recorded. Until an agent has run, it says what it needs next.
 */
export function AgentGallery({ owned, ownedStatus, ownedError, signedIn, onRetry }: { owned: Agent[]; ownedStatus: Load; ownedError: string; signedIn: boolean; onRetry: () => void }) {
  const [templates, setTemplates] = useState<HouseAgentTemplate[]>([]);
  const [status, setStatus] = useState<Load>("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agents/templates", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Template capability is temporarily unavailable.");
        return HouseAgentTemplateCatalogResponseSchema.parse(await response.json());
      })
      .then((result) => {
        setTemplates([...result.templates].sort((a, b) => Number(b.availability === "paper_ready") - Number(a.availability === "paper_ready")));
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const shownTemplates = useMemo(() => templates.filter((template) => {
    if (filter === "yours") return false;
    if (filter === "ready" && template.availability !== "paper_ready") return false;
    if (filter === "preview" && template.availability === "paper_ready") return false;
    return matches(`${template.name} ${strategyLine[template.id]}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [templates, filter, needle]);
  const shownOwned = owned.filter((agent) => (filter === "all" || filter === "yours") && matches(`${agent.name} ${titleCase(agent.templateId)}`));
  const readyCount = templates.filter((template) => template.availability === "paper_ready").length;

  const tabs: [Filter, string][] = [
    ["all", "All"],
    ["ready", `Paper ready ${status === "ready" ? readyCount : ""}`.trim()],
    ["preview", `Preview ${status === "ready" ? templates.length - readyCount : ""}`.trim()],
    ...(signedIn ? [["yours", `Yours ${ownedStatus === "ready" ? owned.length : ""}`.trim()] as [Filter, string]] : []),
  ];

  return (
    <section className="ag-gallery" aria-label="Your agents and House Agent templates">
      <div className="ag-bar">
        <div className="ag-tabs" role="group" aria-label="Filter agents">
          {tabs.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <div className="ag-search">
          <Label htmlFor="agent-search" className="sr-only">Search agents</Label>
          <Search aria-hidden />
          <Input id="agent-search" type="search" placeholder="Name or strategy" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      {status === "loading" ? <div className="ag-grid" role="status" aria-label="Loading agents">{[0, 1, 2].map((key) => <div className="ag-card ag-skel" key={key}><Skeleton lines={5} /></div>)}</div> : null}
      {status === "error" ? <p className="form-error" role="alert">Template capability is temporarily unavailable. Reload to try again.</p> : null}
      {signedIn && ownedStatus === "error" ? <StateBlock kind="error" title="Agents could not be loaded" action={<button type="button" className={buttonVariants({ variant: "outline" })} onClick={onRetry}>Retry</button>}>{ownedError}</StateBlock> : null}

      {status === "ready" && filter === "all" && !needle && signedIn && ownedStatus === "ready" && owned.length === 0 ? (
        <StateBlock kind="empty" title="No saved agents">Configure the paper-ready Protective Put below, then run its verified backtest in Lab before launch.</StateBlock>
      ) : null}

      {status === "ready" ? (
        <div className="ag-grid" data-n={shownOwned.length + shownTemplates.length}>
          {shownOwned.map((agent) => (
            <article className="ag-card agent-card" key={agent.id} data-kind="owned">
              <header className="ag-head">
                <div>
                  <h2>{agent.name}</h2>
                  <p className="ag-sub">{titleCase(agent.templateId)} · your agent</p>
                </div>
                <div className="ag-head-side">
                  {agent.templateId in CHARACTERS ? <AgentCharacter id={agent.templateId as CharacterId} size={44} /> : null}
                  <span className={`agent-status agent-status-${agent.status}`}>{agent.status}</span>
                </div>
              </header>
              <dl className="ag-metrics">
                <div><dt>Recipe</dt><dd className="mono" title={agent.recipeHash}>{shortHash(agent.recipeHash, 10, 4)}</dd></div>
                <div><dt>Updated</dt><dd className="mono"><time dateTime={agent.updatedAt}>{formatUtc(agent.updatedAt)}</time></dd></div>
              </dl>
              <p className="ag-decision"><span className="ag-tag">NEXT</span>{nextAction[agent.status]}</p>
              <footer className="ag-foot">
                <Link className={cn(buttonVariants({ variant: "outline" }), "ag-pill")} href={`/agents/${encodeURIComponent(agent.id)}`}>Open agent</Link>
                {agent.status === "draft" ? <Link className={cn(buttonVariants(), "ag-pill")} href={`/lab?agent=${encodeURIComponent(agent.id)}`}>Backtest in Lab</Link> : null}
              </footer>
            </article>
          ))}

          {shownTemplates.map((template) => {
            const ready = template.availability === "paper_ready";
            return (
              <article className="ag-card" key={template.id} data-ready={ready ? "1" : "0"} data-kind="house">
                <header className="ag-head">
                  <div>
                    <h3>{template.name}</h3>
                    <p className="ag-sub">{strategyLine[template.id]}</p>
                  </div>
                  <AgentCharacter id={template.id} size={56} />
                </header>
                <div className="ag-tags">
                  <span className="ag-chip" data-tone={ready ? "azure" : "neutral"}>{ready ? "Paper ready" : "Preview"}</span>
                  <span className="ag-chip">House Agent</span>
                  {ready ? null : <span className="ag-chip">Strategy overview</span>}
                </div>
                {ready ? (
                  <dl className="ag-metrics ag-metrics-3">
                    {featuredFacts().map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd className="mono">{fact.value}</dd></div>)}
                  </dl>
                ) : null}
                <p className="ag-decision">
                  <span className="ag-tag">{ready ? "HOW IT DECIDES" : "STATUS"}</span>
                  {ready ? templateSummaries[template.id] : template.reason}
                </p>
                <footer className="ag-foot">
                  {ready
                    ? <a className={cn(buttonVariants(), "ag-pill")} href="#configure">Configure this agent below<ArrowRight aria-hidden /></a>
                    : <Link className={cn(buttonVariants({ variant: "outline" }), "ag-pill")} href="/#agents">Review the rules<ArrowRight aria-hidden /></Link>}
                </footer>
              </article>
            );
          })}
        </div>
      ) : null}

      {status === "ready" && shownTemplates.length === 0 && shownOwned.length === 0 ? (
        <StateBlock kind="empty" title={filter === "yours" && ownedStatus === "ready" && owned.length === 0 ? "No saved agents" : "No agents match"}>
          {filter === "yours" && owned.length === 0 ? "Configure the paper-ready Protective Put below, then run its verified backtest in Lab before launch." : "Try another search or filter."}
        </StateBlock>
      ) : null}
    </section>
  );
}
