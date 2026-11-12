import { describe, expect, it } from "vitest";
import { getHookCatalog } from "../../lib/hooks/catalog";

describe("PM hook catalog coverage", () => {
  it("registers_all_PM_definitions_and_marks_only_supported_recipe_hooks_implemented", () => {
    const catalog = getHookCatalog();

    expect(catalog.coverage).toMatchObject({
      sourceStatus: "available",
      expectedCount: 36,
      registeredCount: 36,
      expectedByStage: { gate: 10, strike: 7, size: 4, pulse: 7, expiry: 3, breaker: 5 },
    });
    expect(catalog.definitions).toHaveLength(36);
    expect(catalog.definitions.filter((hook) => hook.availability === "implemented")).toHaveLength(15);
    expect(catalog.definitions.filter((hook) => hook.availability === "catalog_only")).toHaveLength(21);
  });
});
