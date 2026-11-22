// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveAgentConfigure } from "../../components/app/tape/LiveAgentConfigure";

const ACCOUNT = "0x6b565373726fAA9217B07E067A28Ca81952fB9b3";
const AGENT = { id: "123e4567-e89b-42d3-a456-426614174000", name: "Protective Put NVDA", underlyingSymbol: "NVDA" };

describe("Live agent grant configuration", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ grant: { missingEvidence: ["a", "b", "c", "d", "e"] } }, { status: 201 });
      return Response.json(url.includes("/public/") ? { agents: [AGENT] } : { agents: [] });
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const open = async () => { const user = userEvent.setup(); const onProposed = vi.fn(); render(createElement(LiveAgentConfigure, { tradingAddress: ACCOUNT, accountUsable: false, onProposed })); await user.click(screen.getByText("Configure a live agent grant")); return { user, onProposed }; };

  it("shows the real launch path and that Authorize session is blocked by the factory", async () => {
    await open();
    expect(screen.getByText(/Authorize session: blocked, CallPut's account factory would refuse an open for this Account today/)).toBeTruthy();
    expect(screen.getByText(/Launch, evaluate, execute: closed until all seven gates pass/)).toBeTruthy();
  });

  it("cannot propose until an agent is chosen, and rejects values above the engine's hard caps", async () => {
    const { user } = await open();
    const button = screen.getByRole("button", { name: "Propose grant" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByLabelText("Validation").textContent).toContain("Choose the Paper agent");
    await user.selectOptions(await screen.findByLabelText("Paper agent"), AGENT.id);
    expect(button.disabled).toBe(false);
    const perOrder = screen.getByLabelText("Max collateral per order (USDG)");
    await user.clear(perOrder); await user.type(perOrder, "50");
    expect(button.disabled).toBe(true);
    expect(screen.getByLabelText("Validation").textContent).toContain("between 0 and 10 USDG");
    await user.clear(perOrder); await user.type(perOrder, "11");
    expect(button.disabled).toBe(true);
    await user.clear(perOrder); await user.type(perOrder, "10");
    expect(button.disabled).toBe(false); // exactly the hard cap, and not above the 10 USDG open cap
    const openCap = screen.getByLabelText("Max open collateral (USDG)");
    await user.clear(openCap); await user.type(openCap, "5");
    expect(button.disabled).toBe(true);
    expect(screen.getByLabelText("Validation").textContent).toContain("cannot exceed the open-collateral cap");
  });

  it("proposes a grant scoped to the account address with raw USDG amounts, and says it cannot trade yet", async () => {
    const { user, onProposed } = await open();
    await user.selectOptions(await screen.findByLabelText("Paper agent"), AGENT.id);
    await user.click(screen.getByRole("button", { name: "Propose grant" }));
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/venue/callput/live-agent/grants");
    const body = JSON.parse(post[1].body as string);
    expect(body).toMatchObject({ agentId: AGENT.id, route: "callput-account", tradingAddress: ACCOUNT });
    expect(body.policy).toMatchObject({ allowedUnderlyings: ["NVDA"], allowedStrategies: ["BuyPutSpread"], maxCollateralPerOrderRaw: "5000000", maxOpenCollateralRaw: "10000000", maxDailyCollateralRaw: "10000000", maxOrdersPerDay: 1, maxPendingRequests: 1, maxExecutionFeeWei: "300000000000000" });
    expect(screen.getByText(/It cannot trade yet: 5 evidence items are missing/)).toBeTruthy();
  });

  it("will not propose without a readable account address", async () => {
    const user = userEvent.setup();
    render(createElement(LiveAgentConfigure, { tradingAddress: null, accountUsable: null, onProposed: vi.fn() }));
    await user.click(screen.getByText("Configure a live agent grant"));
    await user.selectOptions(await screen.findByLabelText("Paper agent"), AGENT.id);
    expect((screen.getByRole("button", { name: "Propose grant" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Validation").textContent).toContain("could not be read");
  });
});
