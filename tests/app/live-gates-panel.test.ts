// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "signed_in" as "signed_in" | "signed_out" }));
vi.mock("../../components/app/AuthSessionProvider", () => ({ useAuthSession: () => ({ status: auth.status, setWalletMenuOpen: vi.fn() }) }));

import { LiveGatesPanel } from "../../components/app/tape/LiveGatesPanel";

const gate = (id: string, title: string, pass: boolean, detail: string, remediation: string | null = pass ? null : `fix ${id}`) => ({ id, title, pass, detail, remediation });
const STATEMENTS = [{ id: "total-loss", text: "A long option can lose 100% of the premium paid." }, { id: "covered-call-cap", text: "A covered call gives up the upside above its strike." }, { id: "not-the-stock", text: "A synthetic option is not the stock." }];
const body = (over: Record<string, unknown> = {}) => ({
  allPass: false, canEnableLive: false,
  gates: [gate("G1", "Venue verified", false, "5 of 12 verified"), gate("G2", "Custody ready", false, "No active scoped grant."), gate("G3", "Global kill switch", false, "Live trading is not open yet. Your agent keeps running on paper."), gate("G4", "Wallet allowlist", false, "x"), gate("G5", "Jurisdiction", false, "Your country could not be determined"), gate("G6", "Paper history", false, "2 of 7 paper days"), gate("G7", "Risk acknowledgement", false, "not acknowledged")],
  venue: { checkedAt: "2026-11-22", summary: { total: 12, verified: 2, partial: 5, open: 3, blocked: 1 }, rows: [{ id: "V11", item: "Positions owned by the user's wallet", status: "blocked", finding: "openToAll=false" }] },
  caps: { capitalPerLiveAgentUsd: 100, newExposurePerUserPerDayUsd: 300, liveAgentsPerUser: 1, maxPremiumPerPositionUsd: 25, openPositionsPerAgent: 3, maxSlippagePercent: 1 },
  acknowledgement: { version: "v1", statements: STATEMENTS },
  ...over,
});

describe("Enable live panel", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { auth.status = "signed_in"; vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows all seven gates with their status and a remediation, and a disabled Enable button", async () => {
    fetchMock.mockResolvedValue(Response.json(body()));
    render(createElement(LiveGatesPanel));
    expect(await screen.findByText("0 of 7 gates pass")).toBeTruthy();
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6", "G7"]) expect(screen.getByText(new RegExp(`^${id} ·`))).toBeTruthy();
    expect(screen.getByText(/To fix: fix G6/)).toBeTruthy();
    expect(screen.getByText("Live trading is not open yet. Your agent keeps running on paper.", { selector: "p" })).toBeTruthy();
    expect((screen.getByRole("button", { name: /Enable live \(every gate must pass\)/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/V1–V12: 2 verified, 5 partial, 3 open, 1 blocked/)).toBeTruthy();
  });

  it("only offers the acknowledgement once every statement is ticked, and posts the exact statements and version", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === "POST" ? Response.json({ acknowledged: true }) : Response.json(body())));
    const user = userEvent.setup();
    render(createElement(LiveGatesPanel));
    const record = await screen.findByRole("button", { name: "Record acknowledgement" });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    await user.click(boxes[0]!); await user.click(boxes[1]!);
    expect((record as HTMLButtonElement).disabled).toBe(true);
    await user.click(boxes[2]!);
    expect((record as HTMLButtonElement).disabled).toBe(false);
    await user.click(record);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/live/gates/acknowledge");
    expect(JSON.parse(post[1].body as string)).toEqual({ version: "v1", statementIds: ["total-loss", "covered-call-cap", "not-the-stock"] });
  });

  it("surfaces a jurisdiction refusal from the server instead of pretending it was recorded", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === "POST" ? Response.json({ error: { code: "JURISDICTION_BLOCKED", message: "Live trading is not available in US." } }, { status: 403 }) : Response.json(body())));
    const user = userEvent.setup();
    render(createElement(LiveGatesPanel));
    await screen.findByRole("button", { name: "Record acknowledgement" });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Record acknowledgement" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not available in US");
  });

  it("hides the acknowledgement once G7 passes, and never enables the button from the panel alone", async () => {
    const gates = body().gates.map((g) => (g.id === "G7" ? { ...g, pass: true, remediation: null } : g));
    fetchMock.mockResolvedValue(Response.json(body({ gates })));
    render(createElement(LiveGatesPanel));
    expect(await screen.findByText("1 of 7 gates pass")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record acknowledgement" })).toBeNull();
    expect((screen.getByRole("button", { name: /Enable live/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks a signed-out visitor to connect and makes no request", () => {
    auth.status = "signed_out";
    render(createElement(LiveGatesPanel));
    expect(screen.getByText(/Connect a wallet to see which live-trading gates/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
