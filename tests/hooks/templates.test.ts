import { describe, expect, it } from "vitest";
import { getHouseAgentTemplates } from "../../lib/hooks/catalog";

describe("House Agent template capability", () => {
  it("marks_every_House_Agent_paper_ready_with_an_honest_paper_only_reason", () => {
    const catalog = getHouseAgentTemplates();

    expect(catalog.templates.map((template) => [template.id, template.name])).toEqual([
      ["protective_put", "Protective Put"],
      ["covered_call", "Covered Call"],
      ["cash_secured_put", "Cash-Secured Put"],
      ["earnings_straddle", "Earnings Straddle"],
    ]);
    expect(catalog.templates).toHaveLength(4);
    expect(catalog.templates.every((template) => template.availability === "paper_ready")).toBe(true);
    expect(catalog.templates.every((template) => /paper|modeled|Paper/.test(template.reason))).toBe(true);
    expect(catalog.templates.every((template) => /no (venue|live)|No venue/i.test(template.reason))).toBe(true);
  });
});
