import { describe, expect, it } from "vitest";
import { getGraphData } from "../../components/marketing/graph-data";
import { FLOW_STEPS, scenarioFromDecision } from "../../components/marketing/graph-flow";
import { getExplorerData, getForgeDemo, getRiskRails } from "../../components/marketing/section-data";
import { getHookCatalog, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import type { AgentDecision } from "../../lib/domain/contracts";

describe("agent graph data", () => {
  const data = getGraphData();
  const catalog = getHookCatalog();

  it("marks only Protective Put paper ready, matching the template catalog", () => {
    expect(data.agents.map((agent) => [agent.id, agent.ready])).toEqual([
      ["protective_put", true], ["covered_call", false], ["cash_secured_put", false], ["earnings_straddle", false],
    ]);
  });

  it("uses only implemented hooks from the real recipe, with the true stage counts", () => {
    const shown = [...data.stages.flatMap((stage) => stage.hooks), ...data.breaker.hooks];
    expect(shown.map((hook) => hook.id).sort()).toEqual([...PAPER_PROTECTIVE_PUT_HOOK_IDS].sort());
    for (const hook of shown) expect(catalog.definitions.find((row) => row.id === hook.id)?.availability).toBe("implemented");
    expect(data.stages.map((stage) => `${stage.stage}:${stage.live}/${stage.total}`)).toEqual(["gate:3/10", "strike:2/7", "size:2/4", "pulse:1/7", "expiry:2/3"]);
    expect(`${data.breaker.live}/${data.breaker.total}`).toBe("5/5");
    expect(data.hookTotal).toBe(36);
  });

  it("reads thresholds from the recipe so they cannot drift", () => {
    const calmo = data.stages[0]!.hooks.find((hook) => hook.id === "calmo")!;
    expect(calmo.example.threshold).toBe("1.2");
    expect(calmo.params).toContainEqual({ key: "rvRatioMax", value: "1.2" });
  });

  it("illustrative scenarios end in the engine's own wording and the Tape ticks are three", () => {
    expect(data.scenarios.map((scenario) => [scenario.id, scenario.action, scenario.source])).toEqual([["blocked", "skip", "illustrative"], ["open", "open", "illustrative"]]);
    expect(data.scenarios[0]!.reason).toBe("Entry blocked by calmo.");
    expect(data.ticks).toHaveLength(3);
    expect(FLOW_STEPS).toHaveLength(8);
  });
});

describe("recorded decisions", () => {
  it("map a Tape decision into a replayable scenario", () => {
    const decision: AgentDecision = {
      id: "d1", agentId: "a1", tickId: "t1", action: "skip", reason: "Entry blocked by haltr.", snapshotSource: "robinhood_stock_token_api", recipeHash: "sha256:x", createdAt: "2026-01-01T00:00:00.000Z",
      hookResults: [
        { hookId: "haltr", status: "block", reason: "The prior-hour underlying move exceeded the Haltr bound.", stage: "breaker" },
        { hookId: "calmo", status: "pass", reason: "calm", stage: "gate" },
        { hookId: "trailo", status: "skip", reason: "none", stage: "pulse" },
      ],
    };
    const scenario = scenarioFromDecision(decision);
    expect(scenario.source).toBe("recorded");
    expect(scenario.verdicts.haltr?.status).toBe("block");
    expect(scenario.verdicts.trailo?.status).toBe("noop");
    expect(scenario.action).toBe("skip");
  });
});

describe("section data", () => {
  it("lists all 36 hooks, implemented first, and keeps locked reasons", () => {
    const explorer = getExplorerData();
    expect(explorer.flatMap((stage) => stage.hooks)).toHaveLength(36);
    const gate = explorer[0]!;
    expect(gate.hooks.slice(0, 3).every((hook) => hook.live)).toBe(true);
    expect(gate.hooks.slice(3).every((hook) => !hook.live && hook.note)).toBe(true);
  });

  it("forge messages come from the real validator", () => {
    const forge = getForgeDemo();
    expect(forge.validHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(forge.issuesIfRemoved.calmo).toContain("Protective Put requires calmo.");
    expect(forge.issuesIfRemoved.haltr).toContain("Recipe exceeds a PM stage limit or omits a mandatory Breaker.");
  });

  it("risk rails use the recipe defaults inside the catalog's allowed range", () => {
    const rails = getRiskRails();
    expect(rails.map((rail) => [rail.id, rail.value])).toEqual([["haltr", 7], ["daylo", 3], ["drawra", 20], ["exposa", 25]]);
    for (const rail of rails) expect(rail.value).toBeLessThanOrEqual(rail.max);
  });
});
