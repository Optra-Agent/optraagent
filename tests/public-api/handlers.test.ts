import { describe, expect, it } from "vitest";
import { createPublicHandlers } from "../../lib/public/handlers";

describe("versioned public proof API", () => {
  it("public_api_never_exposes_private_owner_or_session_data", async () => {
    const handlers = createPublicHandlers();
    const [hooks, agents, tape, verification] = await Promise.all([
      handlers.hooks(), handlers.agents(), handlers.tape(), handlers.verify(),
    ]);
    const bodies = await Promise.all([hooks.json(), agents.json(), tape.json(), verification.json()]);
    const serialized = JSON.stringify(bodies);

    expect(agents.status).toBe(200);
    expect(bodies[1]).toEqual({ agents: [], executionMode: "PAPER" });
    expect(bodies[2]).toEqual({ decisions: [], orders: [], executionMode: "PAPER" });
    expect(serialized).not.toContain("ownerId");
    expect(serialized).not.toContain('"session":');
    expect(serialized).not.toContain("tokenHash");
  });

  it("publishes_a_server_verified_l0_paper_only_claim_manifest", async () => {
    const response = await createPublicHandlers().verify();
    const body = await response.json();

    expect(body).toMatchObject({ v4ClaimLevel: "L0", liveTradingEnabled: false });
    expect(body.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hook_catalog", status: "limited", statement: "36 PM hook entries are cataloged; 26 have deterministic evaluators and 10 remain catalog-only." }),
      expect.objectContaining({ id: "house_agents", status: "verified", statement: "4 of 4 House Agent templates are paper ready." }),
      expect.objectContaining({ id: "historical_backtest", status: "limited" }),
      expect.objectContaining({ id: "live_execution", status: "disabled" }),
    ]));
  });
});
