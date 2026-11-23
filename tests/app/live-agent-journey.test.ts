// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveAgentJourney, liveAgentJourney, nextLiveAgentRequirement, type JourneyInput } from "../../components/app/tape/LiveAgentJourney";
import { TradingCapabilityStrip } from "../../components/app/tape/TradingCapabilityStrip";
import { buildTradingCapabilityClaims } from "../../lib/public/trading-capabilities";

const base: JourneyInput = { liveTradingEnabled: false, control: { stopped: true }, accountUsable: true, grants: [], requests: [] };
const state = (input: JourneyInput, title: string) => liveAgentJourney(input).find((step) => step.title === title)?.state;

describe("Live Agent journey", () => {
  it("lists the seven owner steps in order and starts at choosing an agent", () => {
    const steps = liveAgentJourney(base);
    expect(steps.map((step) => step.title)).toEqual(["Choose agent", "Configure risk", "Review permissions", "Authorize scoped session", "Activate when eligible", "Monitor", "Emergency stop"]);
    expect(nextLiveAgentRequirement(steps)?.title).toBe("Choose agent");
  });

  it("never reports activation as done without an active grant, the operator switch and a running agent", () => {
    const proposed = { ...base, grants: [{ agentId: "a1", status: "proposed" as const, missingEvidence: ["x", "y"] }] };
    expect(state(proposed, "Authorize scoped session")).toBe("next");
    expect(state(proposed, "Activate when eligible")).toBe("waiting");
    const active = { ...base, grants: [{ agentId: "a1", status: "active" as const, missingEvidence: [] }] };
    expect(state(active, "Authorize scoped session")).toBe("done");
    expect(state(active, "Activate when eligible")).toBe("waiting"); // switch off and stopped
    expect(state({ ...active, liveTradingEnabled: true }, "Activate when eligible")).toBe("waiting"); // still stopped
    expect(state({ ...active, liveTradingEnabled: true, control: { stopped: false } }, "Activate when eligible")).toBe("done");
  });

  it("says exactly what is missing when CallPut's factory would refuse the account, and ignores revoked grants", () => {
    const blocked = { ...base, accountUsable: false, grants: [{ agentId: "a1", status: "proposed" as const, missingEvidence: ["x"] }] };
    expect(state(blocked, "Authorize scoped session")).toBe("blocked");
    expect(nextLiveAgentRequirement(liveAgentJourney(blocked))?.title).toBe("Authorize scoped session");
    expect(state({ ...base, grants: [{ agentId: "a1", status: "revoked" as const, missingEvidence: [] }] }, "Choose agent")).toBe("next");
  });

  it("renders the next requirement and a link to the seven gates", () => {
    render(createElement(LiveAgentJourney, base));
    expect(screen.getByRole("list", { name: "Live Agent journey" })).toBeTruthy();
    expect(screen.getByText(/Next: Choose agent\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all seven live gates" }).getAttribute("href")).toBe("#enable-live");
    cleanup();
  });
});

describe("Live Agent journey: account position and stop reason", () => {
  const ADDRESS = "0xC1B9970A69Ec2d630997A29fD54dD8E28C4dAA5c";
  const detail = (input: JourneyInput, title: string) => liveAgentJourney(input).find((step) => step.title === title)?.detail ?? "";

  it("states the owner's real Account position and never offers to sign for the owner", () => {
    const proposed = { ...base, grants: [{ agentId: "a1", status: "proposed" as const, missingEvidence: ["x"] }] };
    expect(detail({ ...proposed, account: { address: ADDRESS, created: false, registered: false } }, "Authorize scoped session")).toContain(`${ADDRESS} does not exist yet`);
    expect(detail({ ...proposed, account: { address: ADDRESS, created: true, registered: false } }, "Authorize scoped session")).toContain("is not registered");
    expect(detail({ ...proposed, account: { address: ADDRESS, created: true, registered: true } }, "Authorize scoped session")).toContain("is created and registered");
    expect(detail({ ...proposed, account: null }, "Authorize scoped session")).toContain("could not be read");
    expect(detail(proposed, "Authorize scoped session")).toContain("OPTRA never holds your wallet key");
  });

  it("shows why the agent is stopped", () => {
    expect(detail({ ...base, control: { stopped: true, reason: "A tracked request is stale or unknown; reconcile on-chain before resuming." } }, "Emergency stop")).toContain("stale or unknown");
    expect(detail({ ...base, control: { stopped: false } }, "Emergency stop")).toContain("Available at any time");
  });
});

describe("Tape trading capability strip", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders the three capability labels exactly as the verification response states them", async () => {
    const claims = buildTradingCapabilityClaims({ signing: { open: true, close: true, settle: true }, autonomousSwitchOn: false });
    fetchMock.mockResolvedValue(Response.json({ v4ClaimLevel: "L0", liveTradingEnabled: false, claims }));
    render(createElement(TradingCapabilityStrip));
    expect(await screen.findByText("Available")).toBeTruthy();
    expect(screen.getByText("Engine built · Live activation required")).toBeTruthy();
    expect(screen.getByText("Acceptance required")).toBeTruthy();
    expect(screen.queryByText("Disabled")).toBeNull();
  });

  it("says plainly when the status cannot be loaded instead of staying silent", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    render(createElement(TradingCapabilityStrip));
    expect(await screen.findByText(/Capability status is temporarily unavailable/)).toBeTruthy();
  });
});
