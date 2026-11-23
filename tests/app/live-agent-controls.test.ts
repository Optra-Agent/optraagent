// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "signed_in" as "signed_in" | "signed_out" }));
vi.mock("../../components/app/AuthSessionProvider", () => ({ useAuthSession: () => ({ status: auth.status, setWalletMenuOpen: vi.fn() }) }));

import { LiveAgentControls } from "../../components/app/tape/LiveAgentControls";

const GRANT = { id: "123e4567-e89b-42d3-a456-426614174000", agentId: "agent-1", tradingAddress: "0x000000000000000000000000000000000000dEaD", route: "direct-wallet", status: "proposed", expiresAt: "2026-11-22T00:00:00.000Z", missingEvidence: ["a", "b", "c", "d", "e"] };
const status = (over: object = {}) => ({ liveTradingEnabled: false, submissionRoute: "not-configured", control: { stopped: true, reason: "No control record: stopped by default." }, grants: [GRANT], requests: [], ...over });

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

  it("stops and revokes through the owner endpoints and refreshes", async () => {
    const running = status({ control: { stopped: false, reason: null }, grants: [{ ...GRANT, status: "active", missingEvidence: [] }] });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ ok: true });
      return Response.json(running);
    });
    const user = userEvent.setup();
    render(createElement(LiveAgentControls));
    expect(await screen.findByText("Armed")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Emergency stop" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/venue/callput/live-agent/stop", expect.objectContaining({ method: "POST" })));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/venue/callput/live-agent/grants/${GRANT.id}/revoke`, expect.objectContaining({ method: "POST" })));
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
