import { describe, expect, it } from "vitest";
import { getForgeDemo } from "../../components/marketing/section-data";

describe("Protective Put Forge walkthrough source", () => {
  const data = getForgeDemo();
  const hooks = data.stages.flatMap((stage) => stage.hooks);
  const implemented = new Set(hooks.filter(({ live }) => live).map(({ id }) => id));

  it("uses the supported template and exposes only implemented hook choices as runnable", () => {
    expect(data.agents.filter(({ ready }) => ready).map(({ id }) => id)).toEqual(["protective_put"]);
    expect(data.stages.map(({ stage }) => stage)).toEqual(["gate", "strike", "size", "pulse", "expiry", "breaker"]);
    expect(implemented.size).toBe(15);
    expect(hooks.filter(({ live }) => !live)).toHaveLength(21);
    expect(data.required).toHaveLength(15);
    expect(data.required.every((id) => implemented.has(id))).toBe(true);
  });

  it("provides validator feedback for each removed required rule and a canonical default hash", () => {
    expect(Object.keys(data.issuesIfRemoved).sort()).toEqual([...data.required].sort());
    expect(Object.values(data.issuesIfRemoved).every((issues) => issues.length > 0)).toBe(true);
    expect(data.validHash).toMatch(/^sha256:[0-9a-f]{64}$/i);
  });
});
