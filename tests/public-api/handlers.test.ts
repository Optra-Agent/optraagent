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
    expect(bodies[2]).toMatchObject({ decisions: [], orders: [], executionMode: "PAPER" });
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
      expect.objectContaining({ id: "wallet_signed_trading" }),
      expect.objectContaining({ id: "autonomous_agent_engine", label: "Engine built · Live activation required" }),
      expect.objectContaining({ id: "live_execution_acceptance", label: "Acceptance required" }),
    ]));
    // The old single "live_execution: disabled" claim conflated three different capabilities.
    expect(body.claims.map((claim: { id: string }) => claim.id)).not.toContain("live_execution");
  });

  it("reports_wallet_signed_trading_from_the_shipped_signing_flags_and_not_from_the_autonomous_switch", async () => {
    const claim = async (options: Parameters<typeof createPublicHandlers>[0], id: string) => ((await (await createPublicHandlers(options).verify()).json()) as { claims: Array<{ id: string; label?: string; status: string }> }).claims.find((entry) => entry.id === id);
    const allOn = { open: true, close: true, settle: true };

    expect(await claim({ signing: allOn, env: {} }, "wallet_signed_trading")).toMatchObject({ label: "Available", status: "limited" });
    expect(await claim({ signing: { open: true, close: false, settle: false }, env: {} }, "wallet_signed_trading")).toMatchObject({ label: "Partly available: Open" });
    expect(await claim({ signing: { open: false, close: false, settle: false }, env: {} }, "wallet_signed_trading")).toMatchObject({ label: "Signing not enabled", status: "preview" });
    // Autonomous semantics are untouched by manual signing availability.
    const manualOnly = await (await createPublicHandlers({ signing: allOn, env: {} }).verify()).json();
    expect(manualOnly.liveTradingEnabled).toBe(false);
    const switchedOn = await (await createPublicHandlers({ signing: allOn, env: { LIVE_TRADING_ENABLED: "true" } }).verify()).json();
    expect(switchedOn.liveTradingEnabled).toBe(true);
    expect(switchedOn.claims.find((entry: { id: string }) => entry.id === "autonomous_agent_engine")).toMatchObject({ label: "Engine built · Live activation required", status: "preview" });
    const killed = await (await createPublicHandlers({ env: { LIVE_TRADING_ENABLED: "true", LIVE_AGENT_KILL_SWITCH: "true" } }).verify()).json();
    expect(killed.liveTradingEnabled).toBe(false);
  });

  it("never_reports_mainnet_execution_as_verified_without_venue_backed_records", async () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    const record = (kind: "open" | "close" | "settle") => ({ kind, transactionHash: hash, requestKey: null, verifiedAt: "2026-11-23T00:00:00.000Z", evidence: "test" });
    const claim = async (acceptance: Array<ReturnType<typeof record>>) => ((await (await createPublicHandlers({ acceptance, env: {} }).verify()).json()) as { claims: Array<{ id: string; label?: string; status: string; statement: string }> }).claims.find((entry) => entry.id === "live_execution_acceptance");

    expect(await claim([])).toMatchObject({ label: "Acceptance required", status: "preview" });
    expect(await claim([record("open")])).toMatchObject({ label: "Partly verified: open", status: "limited" });
    expect((await claim([record("open")]))?.statement).toContain("Still required: close, settle");
    expect(await claim([record("open"), record("close"), record("settle")])).toMatchObject({ label: "Verified on Mainnet", status: "verified" });
  });
});
