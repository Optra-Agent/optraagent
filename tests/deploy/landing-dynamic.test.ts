import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_ENGINE_BUILT, LIVE_ENGINE_STATUS, LIVE_REQUIREMENTS } from "../../components/app/live-requirements";

describe("landing page freshness", () => {
  it("renders per request so its House Agent count and Decision Tape claim come from the database, not from the build", () => {
    // A prerendered landing page baked "0 OPTRA House Agents are running" at image build time (no database) and the CDN
    // kept it for a year, while Verify, reading the same handlers in the browser, showed the live count.
    const source = readFileSync("app/(marketing)/page.tsx", "utf8");
    expect(source).toMatch(/export const dynamic = "force-dynamic";/);
  });
});

describe("autonomous engine messaging", () => {
  it("presents the built engine as built and never as live, active or operational", () => {
    expect(LIVE_ENGINE_STATUS).toBe("Engine built · Live activation required");
    expect(LIVE_ENGINE_STATUS).not.toMatch(/unavailable|operational|\blive\b(?! activation)|active\b/i);
    expect(LIVE_ENGINE_BUILT.length).toBeGreaterThanOrEqual(6);
  });

  it("does not list a built component as a missing requirement", () => {
    const built = LIVE_ENGINE_BUILT.join(" ").toLowerCase();
    expect(built).toContain("emergency stop");
    for (const item of LIVE_REQUIREMENTS) expect(item.title.toLowerCase()).not.toContain("emergency stop");
  });
});
