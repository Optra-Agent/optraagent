import { describe, expect, it } from "vitest";
import { getGraphData } from "../../components/marketing/graph-data";
import { FLOW_STEPS, scenarioFromDecision } from "../../components/marketing/graph-flow";
import { getExplorerData, getForgeDemo, getRiskRails } from "../../components/marketing/section-data";
import { getHookCatalog, PAPER_PROTECTIVE_PUT_HOOK_IDS } from "../../lib/hooks/catalog";
import { HOUSE_STRATEGY_HOOK_IDS } from "../../lib/hooks/house-specs";
import type { AgentDecision } from "../../lib/domain/contracts";

describe("agent graph data", () => {
  const data = getGraphData();
  const catalog = getHookCatalog();

  it("marks every House Agent paper ready, matching the template catalog", () => {
    expect(data.agents.map((agent) => [agent.id, agent.ready])).toEqual([
      ["protective_put", true], ["covered_call", true], ["cash_secured_put", true], ["earnings_straddle", true],
    ]);
  });

  it("builds a graph per agent from that agent's own recipe hooks", () => {
    for (const [id, expected] of Object.entries({ covered_call: HOUSE_STRATEGY_HOOK_IDS.covered_call, cash_secured_put: HOUSE_STRATEGY_HOOK_IDS.cash_secured_put, earnings_straddle: HOUSE_STRATEGY_HOOK_IDS.earnings_straddle })) {
      const view = data.byAgent[id as keyof typeof data.byAgent];
      const shown = [...view.stages.flatMap((stage) => stage.hooks), ...view.breaker.hooks].map((hook) => hook.id);
      expect([...shown].sort(), id).toEqual([...expected].sort());
      expect(view.hookCount).toBe(expected.length);
      expect(view.scenarios.map((scenario) => scenario.action)).toEqual(["skip", "open"]);
      expect(view.ticks).toHaveLength(3);
      for (const hookId of shown) expect(catalog.definitions.find((row) => row.id === hookId)?.availability, `${id}:${hookId}`).toBe("implemented");
      const blocked = view.scenarios[0]!;
      expect(Object.values(blocked.verdicts).filter((verdict) => verdict.status === "block")).toHaveLength(1);
    }
    expect(data.byAgent.protective_put.stages).toBe(data.stages);
  });

  it("shows each agent's thresholds from its own recipe", () => {
    const hook = (agent: keyof typeof data.byAgent, id: string) => [...data.byAgent[agent].stages.flatMap((stage) => stage.hooks)].find((row) => row.id === id)!;
    expect(hook("covered_call", "percy").example.threshold).toBe("5");
    expect(hook("cash_secured_put", "deltra").example.threshold).toBe("0.25");
    expect(hook("earnings_straddle", "capra").example.threshold).toBeUndefined();
    expect(hook("earnings_straddle", "earnex").example.threshold).toBe("3");
  });

  it("uses only implemented hooks from the real recipe, with the true stage counts", () => {
    const shown = [...data.stages.flatMap((stage) => stage.hooks), ...data.breaker.hooks];
    expect(shown.map((hook) => hook.id).sort()).toEqual([...PAPER_PROTECTIVE_PUT_HOOK_IDS].sort());
    for (const hook of shown) expect(catalog.definitions.find((row) => row.id === hook.id)?.availability).toBe("implemented");
    expect(data.stages.map((stage) => `${stage.stage}:${stage.live}/${stage.total}`)).toEqual(["gate:6/10", "strike:5/7", "size:3/4", "pulse:4/7", "expiry:3/3"]);
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
    expect(gate.hooks.slice(0, gate.live).every((hook) => hook.live)).toBe(true);
    expect(gate.hooks.slice(gate.live).every((hook) => !hook.live && hook.note)).toBe(true);
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
