import { describe, expect, it } from "vitest";
import { getHouseAgentTemplates } from "../../lib/hooks/catalog";

describe("House Agent template capability", () => {
  it("marks_only_the_modelled_Protective_Put_paper_path_available", () => {
    const catalog = getHouseAgentTemplates();

    expect(catalog.templates.map((template) => [template.id, template.name])).toEqual([
      ["covered_call", "Covered Call"],
      ["cash_secured_put", "Cash-Secured Put"],
      ["protective_put", "Protective Put"],
      ["earnings_straddle", "Earnings Straddle"],
    ]);
    expect(catalog.templates).toHaveLength(4);
    expect(catalog.templates.find((template) => template.id === "protective_put")?.availability).toBe("paper_ready");
    expect(catalog.templates.filter((template) => template.id !== "protective_put").every((template) => template.availability === "preview")).toBe(true);
    expect(catalog.templates.every((template) => template.reason.length > 0)).toBe(true);
  });
});
