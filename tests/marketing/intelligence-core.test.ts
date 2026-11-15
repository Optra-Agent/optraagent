import { describe, expect, it } from "vitest";
import { getForgeDemo } from "../../components/marketing/section-data";
import { buildIntelligenceCoreModel, sampleIntelligenceCore } from "../../components/marketing/intelligence-core-model";

describe("OPTRA Intelligence Core model", () => {
  const model = buildIntelligenceCoreModel(getForgeDemo());

  it("derives the supported strategy, hook coverage, and Breakers from the Forge catalog", () => {
    expect(model.strategyStages.map(({ id }) => id)).toEqual(["gate", "strike", "size", "pulse", "expiry"]);
    expect(model.hooks).toHaveLength(36);
    expect(model.hooks.filter(({ live }) => live)).toHaveLength(15);
    expect(model.hooks.filter(({ live }) => !live)).toHaveLength(21);
    expect(model.breakers).toHaveLength(5);
    expect(model.hooks.filter(({ stage }) => stage === "breaker")).toHaveLength(5);
  });

  it("keeps one stable point identity while its five spatial keyframes change", () => {
    expect(model.keyframes).toHaveLength(5);
    expect(model.keyframes.map(({ name }) => name)).toEqual(["core", "strategy", "hooks", "risk", "evidence"]);
    const first = sampleIntelligenceCore(model, 0);
    const middle = sampleIntelligenceCore(model, 0.5);
    const last = sampleIntelligenceCore(model, 1);
    expect(first.map(({ id }) => id)).toEqual(last.map(({ id }) => id));
    expect(first.map(({ x, y, z }) => [x, y, z])).not.toEqual(middle.map(({ x, y, z }) => [x, y, z]));
    expect(middle.map(({ x, y, z }) => [x, y, z])).not.toEqual(last.map(({ x, y, z }) => [x, y, z]));
    expect(middle.every(({ x, y, z }) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))).toBe(true);
    for (let index = 0; index < model.keyframes.length; index++) {
      const stateCenter = (index + 0.5) / model.keyframes.length;
      const samplePositions = sampleIntelligenceCore(model, stateCenter).map(({ id, x, y, z }) => [id, x, y, z]);
      const framePositions = model.keyframes[index]?.points.map(({ id, x, y, z }) => [id, Math.round(x * 10_000) / 10_000, Math.round(y * 10_000) / 10_000, Math.round(z * 10_000) / 10_000]);
      expect(samplePositions).toEqual(framePositions);
    }
  });

  it("does not mark catalog-only hooks as active and samples progress in either direction", () => {
    const forward = sampleIntelligenceCore(model, 0.73);
    const reverse = sampleIntelligenceCore(model, 0.73);
    expect(forward).toEqual(reverse);
    expect(forward.filter(({ kind, live }) => kind === "hook" && !live).every(({ active }) => !active)).toBe(true);
    expect(sampleIntelligenceCore(model, -1)).toEqual(sampleIntelligenceCore(model, 0));
    expect(sampleIntelligenceCore(model, 2)).toEqual(sampleIntelligenceCore(model, 1));
  });
});
