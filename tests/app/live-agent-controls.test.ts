// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "signed_in" as "signed_in" | "signed_out" }));
vi.mock("../../components/app/AuthSessionProvider", () => ({ useAuthSession: () => ({ status: auth.status, setWalletMenuOpen: vi.fn() }) }));

import { LiveAgentControls } from "../../components/app/tape/LiveAgentControls";

const GRANT = { id: "123e4567-e89b-42d3-a456-426614174000", agentId: "agent-1", tradingAddress: "0x000000000000000000000000000000000000dEaD", route: "direct-wallet", status: "proposed", expiresAt: "2026-11-22T00:00:00.000Z", missingEvidence: ["a", "b", "c", "d", "e"] };
const status = (over: object = {}) => ({ liveTradingEnabled: false, liveTradingSwitchOn: false, killSwitchActive: false, submissionRoute: "not-configured", control: { stopped: true, reason: "No control record: stopped by default." }, grants: [GRANT], requests: [], ...over });

describe("Live Agent controls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { auth.status = "signed_in"; vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows a stopped agent with execution off and no submission route, and never claims armed", async () => {
    fetchMock.mockResolvedValue(Response.json(status()));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Off on this deployment")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.queryByText("Armed")).toBeNull();
    expect(screen.getByText(/missing 5 evidence items/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Emergency stop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not label an active grant Armed while the deployment switch is off", async () => {
    fetchMock.mockResolvedValue(Response.json(status({ control: { stopped: false, reason: null }, grants: [{ ...GRANT, status: "active", missingEvidence: [] }] })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Switch off")).toBeTruthy();
    expect(screen.queryByText("Armed")).toBeNull();
    expect(screen.getByText("Off on this deployment")).toBeTruthy();
  });

  it("requires a current G1-G7 report before calling a configured active grant Armed", async () => {
    fetchMock.mockResolvedValue(Response.json(status({ liveTradingEnabled: true, liveTradingSwitchOn: true, submissionRoute: "callput-account", control: { stopped: false, reason: null }, grants: [{ ...GRANT, status: "active", missingEvidence: [] }] })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Gate report unavailable")).toBeTruthy();
    expect(screen.queryByText("Armed")).toBeNull();
  });

  it("shows the exact failing gate ids from the current execution report", async () => {
    const gateReport = {
      allPass: false,
      evaluatedAt: "2026-11-24T00:00:00.000Z",
      gates: [
        { id: "G1", title: "Venue verified", pass: false, detail: "Venue evidence is incomplete.", remediation: "Complete V1-V12.", evidence: [] },
        { id: "G5", title: "Jurisdiction", pass: false, detail: "The scheduled worker has no fresh trusted owner-location evidence.", remediation: "Provide an owner-bound proof.", evidence: [] },
      ],
    };
    fetchMock.mockResolvedValue(Response.json(status({
      liveTradingEnabled: true,
      liveTradingSwitchOn: true,
      submissionRoute: "callput-account",
      control: { stopped: false, reason: null },
      grants: [{ ...GRANT, status: "active", missingEvidence: [] }],
      activationGatesPass: false,
      gateReport,
    })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Gates blocked")).toBeTruthy();
    expect(screen.getByText("Blocked: G1, G5")).toBeTruthy();
    expect(screen.queryByText("Armed")).toBeNull();
  });

  it("says autonomy is unavailable and lists what CallPut itself enforces, without implying an OPTRA permission", async () => {
    const findings = [
      { id: "account-route", ok: true, detail: "execution route callput_account on robinhood, configured=true." },
      { id: "distinct-device-signer", ok: true, detail: "the session signer must differ from the owner." },
    ];
    fetchMock.mockResolvedValue(Response.json(status({ venueDelegation: { status: "ok", fetchedAt: "2026-11-22T06:00:00.000Z", findings } })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText(/autonomous execution engine is built and inactive/)).toBeTruthy();
    expect(screen.getByText(/What CallPut says it enforces for delegated sessions/)).toBeTruthy();
    expect(screen.getByText(/execution route callput_account on robinhood/)).toBeTruthy();
    expect(screen.getByText(/not an OPTRA permission/)).toBeTruthy();
    expect(screen.queryByText("Armed")).toBeNull();
  });

  it("shows a neutral note, not an error, when CallPut's session details cannot be read", async () => {
    fetchMock.mockResolvedValue(Response.json(status({ venueDelegation: { status: "unavailable" } })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText(/session details could not be read/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("labels account-factory getters as configured observations, not proof of OPTRA permission", async () => {
    const accountGates = {
      status: "ok", openToAll: true, safeMode: false, account: "0x000000000000000000000000000000000000dEaD",
      accountCreated: true, accountRegistered: true, accountAllowed: true, accountCanOpen: true, resolverMatchVerified: false, factorySourceVerified: false, accountSourceVerified: false, openPathEnforcementVerified: false, ownerAccountCount: 1, accountUsable: false,
    };
    fetchMock.mockResolvedValue(Response.json(status({ accountGates })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText(/Configured factory reports .* canOpen yes/i)).toBeTruthy();
    expect(screen.getByText(/resolver match not verified.*factory source not verified.*Account source not verified.*per-open enforcement not verified/i)).toBeTruthy();
    expect(screen.queryByText(/would let your Account open today/i)).toBeNull();
  });

  it("refreshes owner-bound jurisdiction proof through the authenticated endpoint without arming execution", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ country: "ID", expiresAt: "2026-12-01T00:15:00.000Z" })
      : Response.json(status()));
    const user = userEvent.setup();
    render(createElement(LiveAgentControls));

    await user.click(await screen.findByRole("button", { name: "Refresh jurisdiction proof" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/venue/callput/live-agent/jurisdiction",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grantId: GRANT.id }),
      }),
    ));
    expect(await screen.findByText(/Owner-bound ID location proof recorded until 2026-12-01T00:15:00.000Z/)).toBeTruthy();
    expect(screen.queryByText("Armed")).toBeNull();
  });

  it("stops and revokes through the owner endpoints and refreshes", async () => {
    const running = status({ liveTradingEnabled: true, liveTradingSwitchOn: true, control: { stopped: false, reason: null }, grants: [{ ...GRANT, status: "active", missingEvidence: [] }] });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ ok: true });
      return Response.json(running);
    });
    const user = userEvent.setup();
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("No submission route")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Emergency stop" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/venue/callput/live-agent/stop", expect.objectContaining({ method: "POST" })));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/venue/callput/live-agent/grants/${GRANT.id}/revoke`, expect.objectContaining({ method: "POST" })));
  });

  it("keeps emergency stop actionable and explains when a worker lease has not drained", async () => {
    const active = status({ control: { stopped: false, reason: null, leasePresent: true }, grants: [{ ...GRANT, status: "active", missingEvidence: [] }] });
    const stopping = status({ control: { stopped: true, reason: "Stopped by the owner.", leasePresent: true }, grants: [{ ...GRANT, status: "active", missingEvidence: [] }] });
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ stopped: true, quiesced: false, leasePresent: true }, { status: 202 })
      : Response.json(fetchMock.mock.calls.some(([, options]) => options?.method === "POST") ? stopping : active));
    const user = userEvent.setup();
    render(createElement(LiveAgentControls));
    const stop = await screen.findByRole("button", { name: "Emergency stop" });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    await user.click(stop);
    const notice = await screen.findByText(/Stop\/revocation is recorded/);
    expect(notice.textContent).toMatch(/worker lease remains.*in-flight outcome is unconfirmed/i);
    expect((screen.getByRole("button", { name: "Emergency stop" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains each request state and offers a recovery action with the explorer link for a halted one", async () => {
    const hash = `0x${"cd".repeat(32)}`;
    fetchMock.mockResolvedValue(Response.json(status({ requests: [
      { id: "r1", state: "unknown", collateralRaw: "5000000", transactionHash: hash, requestKey: null, createdAt: "2026-11-23T08:00:00.000Z" },
      { id: "r2", state: "pending", collateralRaw: "5000000", transactionHash: null, requestKey: `0x${"ab".repeat(32)}`, createdAt: "2026-11-23T07:00:00.000Z" },
    ] })));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Unknown: agent halted")).toBeTruthy();
    expect(screen.getByText(/never retried blindly/)).toBeTruthy();
    expect((screen.getByRole("link", { name: "Open the transaction" }) as HTMLAnchorElement).href).toContain(`/tx/${hash}`);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open the transaction" })).toHaveLength(1);
  });

  it("asks a signed-out visitor to connect and makes no request", () => {
    auth.status = "signed_out";
    render(createElement(LiveAgentControls));
    expect(screen.getByText(/Connect a wallet to see and control/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable status instead of an empty panel", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Live Agent status is unavailable.")).toBeTruthy();
  });
});
